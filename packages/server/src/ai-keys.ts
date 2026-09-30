// Bring-your-own-key storage (spec §2.6): readers' API keys, AES-GCM encrypted
// under the instance master key (AI_KEYS_MASTER_KEY) with Web Crypto, which
// Workers and Node both have. A key is decrypted only inside the request or
// job that uses it, and nothing here ever returns it to a caller other than
// `loadKey`, whose result must never leave the server.
//
// Each row is bound to its user and provider: they are the AES-GCM additional
// data, so a ciphertext copied to another row fails to decrypt.
import type { ByokProvider } from "@seply/ai"
import { last4 } from "@seply/ai"
import { schema } from "@seply/domain"
import { and, asc, eq } from "drizzle-orm"
import { ConfigError } from "./config.ts"
import type { Db } from "./db.ts"

const { aiKeys } = schema

/** Bumped if the scheme changes; part of the additional data. */
const SCHEME = "seply-ai-key:v1"

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = ""
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  },
  decode(text: string): Uint8Array<ArrayBuffer> {
    const s = atob(text)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  },
}

/** Imports the master key: 32 bytes, base64 (`openssl rand -base64 32`). */
export async function importMasterKey(base64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = b64.decode(base64.trim())
  } catch {
    throw new ConfigError("AI_KEYS_MASTER_KEY is not base64")
  }
  if (raw.length !== 32)
    throw new ConfigError("AI_KEYS_MASTER_KEY must be 32 bytes (base64)")
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}

export type Sealed = { ciphertext: string; iv: string }
type Binding = { userId: string; provider: string }

const aad = ({ userId, provider }: Binding) =>
  new TextEncoder().encode(`${SCHEME}:${userId}:${provider}`)

export async function sealKey(
  master: CryptoKey,
  apiKey: string,
  binding: Binding
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(binding) },
    master,
    new TextEncoder().encode(apiKey)
  )
  return { ciphertext: b64.encode(new Uint8Array(ct)), iv: b64.encode(iv) }
}

/** Throws when the master key, the row's binding or the ciphertext is wrong. */
export async function openKey(
  master: CryptoKey,
  sealed: Sealed,
  binding: Binding
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64.decode(sealed.iv), additionalData: aad(binding) },
    master,
    b64.decode(sealed.ciphertext)
  )
  return new TextDecoder().decode(pt)
}

/** What the browser may see of a stored key. */
export type KeySummary = {
  provider: ByokProvider
  last4: string
  createdAt: string
}

export async function listKeys(db: Db, userId: string): Promise<KeySummary[]> {
  const rows = await db
    .select({
      provider: aiKeys.provider,
      last4: aiKeys.last4,
      createdAt: aiKeys.createdAt,
    })
    .from(aiKeys)
    .where(eq(aiKeys.userId, userId))
    .orderBy(asc(aiKeys.provider))
  return rows.map((r) => ({
    provider: r.provider as ByokProvider,
    last4: r.last4,
    createdAt: r.createdAt.toISOString(),
  }))
}

/** Stores (or replaces) the user's key for a provider. */
export async function saveKey(
  db: Db,
  master: CryptoKey,
  { userId, provider, apiKey }: Binding & { provider: ByokProvider; apiKey: string }
): Promise<KeySummary> {
  const sealed = await sealKey(master, apiKey, { userId, provider })
  const values = { ...sealed, last4: last4(apiKey), createdAt: new Date() }
  const [row] = await db
    .insert(aiKeys)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [aiKeys.userId, aiKeys.provider], set: values })
    .returning({ createdAt: aiKeys.createdAt, last4: aiKeys.last4 })
  return { provider, last4: row!.last4, createdAt: row!.createdAt.toISOString() }
}

/** Deletes the user's key for a provider; false if there was none. */
export async function deleteKey(
  db: Db,
  userId: string,
  provider: ByokProvider
): Promise<boolean> {
  const gone = await db
    .delete(aiKeys)
    .where(and(eq(aiKeys.userId, userId), eq(aiKeys.provider, provider)))
    .returning({ provider: aiKeys.provider })
  return gone.length > 0
}

/**
 * The user's key for a provider, decrypted, or null. Server-side only: the
 * result goes into a provider for this request or job and nowhere else.
 */
export async function loadKey(
  db: Db,
  master: CryptoKey,
  userId: string,
  provider: ByokProvider
): Promise<string | null> {
  const [row] = await db
    .select({ ciphertext: aiKeys.ciphertext, iv: aiKeys.iv })
    .from(aiKeys)
    .where(and(eq(aiKeys.userId, userId), eq(aiKeys.provider, provider)))
  return row ? openKey(master, row, { userId, provider }) : null
}
