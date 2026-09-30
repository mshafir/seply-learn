// Web push delivery with WebCrypto only, so it runs on Workers and Node:
// the payload is encrypted for one browser (RFC 8291, `aes128gcm` content
// encoding, RFC 8188), and the request is signed with our VAPID key
// (RFC 8292, an ES256 JWT).

/** A browser's subscription, as `PushSubscription.toJSON()` gives it. */
export type PushSubscriptionJson = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Our VAPID key pair (base64url: the 65-byte public point, the 32-byte private scalar). */
export type VapidKeys = {
  publicKey: string
  privateKey: string
  /** A `mailto:` or `https:` contact for push services. */
  subject: string
}

const enc = new TextEncoder()
/** Bytes backed by a plain ArrayBuffer, as WebCrypto takes them on every runtime. */
const utf8 = (s: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(enc.encode(s))

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

/** ECDH with the peer's key. Workers' types spell `public` as `$public`. */
const ecdhWith = (peer: CryptoKey) =>
  ({ name: "ECDH", public: peer }) as unknown as Parameters<
    typeof crypto.subtle.deriveBits
  >[0]

export function b64urlEncode(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

async function hmac(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data))
}

/** HKDF with one output block (every length here is at most 32 bytes). */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number
) {
  const prk = await hmac(salt, ikm)
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length)
}

/** A P-256 public key from its uncompressed point. */
function pointToJwk(point: Uint8Array): JsonWebKey {
  if (point.length !== 65 || point[0] !== 4)
    throw new Error("not an uncompressed P-256 point")
  return {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(point.slice(1, 33)),
    y: b64urlEncode(point.slice(33, 65)),
    ext: true,
  }
}

export type EncryptOptions = {
  /** Fixed salt and sender key pair: for the RFC's test vector only. */
  salt?: Uint8Array<ArrayBuffer>
  senderKeys?: { privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer> }
  /** Record size (default 4096). */
  rs?: number
}

/** Encrypts `payload` for one subscription: the whole `aes128gcm` body. */
export async function encryptPayload(
  sub: PushSubscriptionJson,
  payload: Uint8Array<ArrayBuffer>,
  opts: EncryptOptions = {}
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(sub.keys.p256dh)
  const authSecret = b64urlDecode(sub.keys.auth)
  const rs = opts.rs ?? 4096
  if (payload.length + 17 > rs) throw new Error("payload too large")

  let sender = opts.senderKeys
  if (!sender) {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    )) as CryptoKeyPair
    sender = {
      privateKey: pair.privateKey,
      publicKey: new Uint8Array(
        (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer
      ),
    }
  }
  const uaKey = await crypto.subtle.importKey(
    "jwk",
    pointToJwk(uaPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  )
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhWith(uaKey), sender.privateKey, 256)
  )
  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, sender.publicKey)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const salt = opts.salt ?? randomBytes(16)
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12)

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ])
  // One record: the payload, then the last-record delimiter (no padding).
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      concat(payload, new Uint8Array([2]))
    )
  )
  const header = new Uint8Array(21 + sender.publicKey.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs)
  header[20] = sender.publicKey.length
  header.set(sender.publicKey, 21)
  return concat(header, record)
}

/** Imports our VAPID private key for signing. */
async function vapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const jwk = {
    ...pointToJwk(b64urlDecode(keys.publicKey)),
    d: keys.privateKey,
  }
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  )
}

/** The `Authorization` header for a push service (RFC 8292). */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  nowMs = Date.now()
): Promise<string> {
  const header = b64urlEncode(
    utf8(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  )
  const claims = b64urlEncode(
    utf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(nowMs / 1000) + 12 * 60 * 60,
        sub: keys.subject,
      })
    )
  )
  const unsigned = `${header}.${claims}`
  // WebCrypto's ECDSA signature is r || s, which is what JWS wants.
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      await vapidSigningKey(keys),
      utf8(unsigned)
    )
  )
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`
}

export type PushResult =
  | { ok: true; status: number }
  /** `gone`: the subscription has expired or was removed; forget it. */
  | { ok: false; status: number; gone: boolean }

/** Sends one notification (a JSON payload) to one subscription. */
export async function sendPush(
  sub: PushSubscriptionJson,
  payload: unknown,
  keys: VapidKeys,
  opts: { ttl?: number; fetch?: typeof fetch; topic?: string } = {}
): Promise<PushResult> {
  const body = await encryptPayload(sub, utf8(JSON.stringify(payload)))
  const headers: Record<string, string> = {
    authorization: await vapidAuthorization(sub.endpoint, keys),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(opts.ttl ?? 24 * 60 * 60),
    urgency: "normal",
  }
  // A Topic replaces an undelivered message with the same one (≤ 32 base64url chars).
  if (opts.topic)
    headers.topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)
  const res = await (opts.fetch ?? fetch)(sub.endpoint, {
    method: "POST",
    headers,
    body,
  })
  await res.body?.cancel().catch(() => {})
  if (res.ok) return { ok: true, status: res.status }
  return {
    ok: false,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
  }
}
