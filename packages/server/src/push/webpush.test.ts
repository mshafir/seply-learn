import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  verify,
} from "node:crypto"
import { schema } from "@seply/domain"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { signUp, testApp, testDb, TEST_ENV } from "../test-harness.ts"
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  notifyUser,
  sendPush,
  vapidAuthorization,
  type PushSubscriptionJson,
  type VapidKeys,
} from "./index.ts"

/** A browser's side: a P-256 key pair and auth secret, and decryption (RFC 8291). */
function browser() {
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  const auth = randomBytes(16)
  const sub = (endpoint: string): PushSubscriptionJson => ({
    endpoint,
    keys: {
      p256dh: b64urlEncode(ecdh.getPublicKey()),
      auth: b64urlEncode(auth),
    },
  })
  const decrypt = (body: Uint8Array) => {
    const buf = Buffer.from(body)
    const salt = buf.subarray(0, 16)
    const idlen = buf[20]!
    const senderPublic = buf.subarray(21, 21 + idlen)
    const ciphertext = buf.subarray(21 + idlen)
    const hmac = (k: Buffer, d: Buffer) =>
      createHmac("sha256", k).update(d).digest()
    const expand = (prk: Buffer, info: string | Buffer, n: number) =>
      hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(
        0,
        n
      )
    const secret = ecdh.computeSecret(senderPublic)
    const ikm = expand(
      hmac(auth, secret),
      Buffer.concat([
        Buffer.from("WebPush: info\0"),
        ecdh.getPublicKey(),
        senderPublic,
      ]),
      32
    )
    const prk = hmac(salt, ikm)
    const cek = expand(prk, "Content-Encoding: aes128gcm\0", 16)
    const nonce = expand(prk, "Content-Encoding: nonce\0", 12)
    const d = createDecipheriv("aes-128-gcm", cek, nonce)
    d.setAuthTag(ciphertext.subarray(-16))
    const plain = Buffer.concat([
      d.update(ciphertext.subarray(0, -16)),
      d.final(),
    ])
    expect(plain.at(-1)).toBe(2) // the last record's delimiter
    return JSON.parse(plain.subarray(0, -1).toString("utf8"))
  }
  return { sub, decrypt }
}

function vapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  })
  const pub = publicKey.export({ format: "jwk" })
  const priv = privateKey.export({ format: "jwk" })
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(b64urlDecode(pub.x!)),
    Buffer.from(b64urlDecode(pub.y!)),
  ])
  return {
    publicKey: b64urlEncode(point),
    privateKey: priv.d!,
    subject: "mailto:ops@example.com",
  }
}

describe("web push encryption (RFC 8291)", () => {
  it("matches the RFC's worked example", async () => {
    // RFC 8291, Appendix A.
    const asPublic = b64urlDecode(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
    )
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: b64urlEncode(asPublic.slice(1, 33)),
        y: b64urlEncode(asPublic.slice(33)),
        d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"]
    )
    const body = await encryptPayload(
      {
        endpoint:
          "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
        keys: {
          p256dh:
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
          auth: "BTBZMqHH6r4Tts7J_aSIgg",
        },
      },
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      {
        salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"),
        senderKeys: { privateKey, publicKey: asPublic },
      }
    )
    expect(b64urlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    )
  })

  it("round-trips a JSON payload to a browser's keys", async () => {
    const b = browser()
    const body = await encryptPayload(
      b.sub("https://push.example.com/x"),
      new TextEncoder().encode(JSON.stringify({ title: "Ready" }))
    )
    expect(b.decrypt(body)).toEqual({ title: "Ready" })
  })
})

describe("VAPID (RFC 8292)", () => {
  it("signs an ES256 JWT for the push service's origin", async () => {
    const keys = vapidKeys()
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      keys,
      1_000_000_000_000
    )
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!
    expect(m).not.toBeNull()
    expect(m[4]).toBe(keys.publicKey)
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]!)))
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_000_000_000 + 12 * 3600,
      sub: "mailto:ops@example.com",
    })
    const point = b64urlDecode(keys.publicKey)
    const pub = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: b64urlEncode(point.slice(1, 33)),
        y: b64urlEncode(point.slice(33)),
      },
      format: "jwk",
    })
    const ok = verify(
      "sha256",
      Buffer.from(`${m[1]}.${m[2]}`),
      { key: pub, dsaEncoding: "ieee-p1363" },
      Buffer.from(b64urlDecode(m[3]!))
    )
    expect(ok).toBe(true)
  })
})

describe("delivery", () => {
  it("posts an encrypted, signed message a browser can read", async () => {
    const b = browser()
    const keys = vapidKeys()
    const seen: Request[] = []
    const r = await sendPush(
      b.sub("https://push.example.com/abc"),
      { title: "Ready", url: "/e/1" },
      keys,
      {
        topic: "job-01J!",
        fetch: async (input, init) => {
          seen.push(new Request(input, init))
          return new Response(null, { status: 201 })
        },
      }
    )
    expect(r).toEqual({ ok: true, status: 201 })
    const req = seen[0]!
    expect(req.headers.get("content-encoding")).toBe("aes128gcm")
    expect(req.headers.get("ttl")).toBe("86400")
    expect(req.headers.get("topic")).toBe("job-01J")
    expect(req.headers.get("authorization")).toMatch(/^vapid t=.+, k=/)
    expect(b.decrypt(new Uint8Array(await req.arrayBuffer()))).toEqual({
      title: "Ready",
      url: "/e/1",
    })
  })

  it("notifies each of a user's browsers and forgets gone subscriptions", async () => {
    const db = await testDb()
    const app = testApp(TEST_ENV, db)
    const ada = await signUp(app, "ada")
    const one = browser()
    const two = browser()
    await db.insert(schema.pushSubscriptions).values(
      [
        one.sub("https://push.example.com/1"),
        two.sub("https://push.example.com/2"),
      ].map((s) => ({
        endpoint: s.endpoint,
        userId: ada.id,
        p256dh: s.keys.p256dh,
        auth: s.keys.auth,
      }))
    )
    const got: unknown[] = []
    const n = await notifyUser(
      db,
      ada.id,
      { title: "Ready", body: "Done", url: "/e/x", tag: "job-1" },
      {
        vapid: vapidKeys(),
        fetch: async (input, init) => {
          const url = String(input)
          if (url.endsWith("/2")) return new Response(null, { status: 410 })
          got.push(one.decrypt(new Uint8Array(init!.body as ArrayBuffer)))
          return new Response(null, { status: 201 })
        },
      }
    )
    expect(n).toBe(1)
    expect(got).toEqual([
      { title: "Ready", body: "Done", url: "/e/x", tag: "job-1" },
    ])
    const left = await db
      .select({ endpoint: schema.pushSubscriptions.endpoint })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, ada.id))
    expect(left).toEqual([{ endpoint: "https://push.example.com/1" }])

    // Off without VAPID keys.
    expect(
      await notifyUser(
        db,
        ada.id,
        { title: "", body: "", url: "", tag: "" },
        { vapid: null }
      )
    ).toBe(0)
  })
})

describe("web push routes", () => {
  it("serves the public key only when configured", async () => {
    const db = await testDb()
    const off = testApp(TEST_ENV, db)
    expect((await off.request("/api/web-push/key")).status).toBe(404)
    const keys = vapidKeys()
    const on = testApp(
      {
        ...TEST_ENV,
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
      },
      db
    )
    const res = await on.request("/api/web-push/key")
    expect(await res.json()).toEqual({ publicKey: keys.publicKey })
  })

  it("saves and deletes a signed-in user's subscriptions", async () => {
    const db = await testDb()
    const app = testApp(TEST_ENV, db)
    const ada = await signUp(app, "ada")
    const eve = await signUp(app, "eve")
    const sub = browser().sub("https://push.example.com/ada")
    const post = (body: unknown, who = ada) =>
      app.request("/api/web-push/subscriptions", {
        method: "POST",
        headers: who.headers,
        body: JSON.stringify(body),
      })
    expect((await post(sub)).status).toBe(201)
    expect((await post(sub)).status).toBe(201) // idempotent
    expect((await post({ ...sub, endpoint: "ftp://x" })).status).toBe(400)
    expect(
      (await post({ ...sub, keys: { p256dh: "x", auth: "y" } })).status
    ).toBe(400)
    // A local fake push service only with test credentials on (as here).
    expect(
      (await post({ ...sub, endpoint: "http://localhost:9/p" })).status
    ).toBe(201)
    expect(
      (
        await app.request("/api/web-push/subscriptions", {
          method: "POST",
          body: JSON.stringify(sub),
          headers: { "content-type": "application/json" },
        })
      ).status
    ).toBe(401)

    const rows = () =>
      db
        .select({ endpoint: schema.pushSubscriptions.endpoint })
        .from(schema.pushSubscriptions)
        .orderBy(schema.pushSubscriptions.endpoint)
    expect(await rows()).toHaveLength(2)
    const del = (who = ada) =>
      app.request("/api/web-push/subscriptions", {
        method: "DELETE",
        headers: who.headers,
        body: JSON.stringify({ endpoint: sub.endpoint }),
      })
    await del(eve) // not hers: nothing happens
    expect(await rows()).toHaveLength(2)
    expect((await del()).status).toBe(200)
    expect(await rows()).toEqual([{ endpoint: "http://localhost:9/p" }])
  })
})
