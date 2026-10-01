// AI plumbing: key storage (AES-GCM under the master key), key modes, the
// reader's settings and /api/ai. The WP-3.3 bar: keys are never returned by
// any API, and encryption round-trips.
import { DEFAULT_ASK_CAP_USD, DEFAULT_MODELS } from "@seply/ai"
import { schema } from "@seply/domain"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import type { AiOverview } from "./ai.ts"
import { resolveAi } from "./ai.ts"
import { importMasterKey, loadKey, openKey, sealKey } from "./ai-keys.ts"
import { memoryBlobStore } from "./blobs.ts"
import type { ServerEnv } from "./config.ts"
import { signUp, TEST_ENV, testApp, testDb } from "./test-harness.ts"

// Test-only master keys: 32 bytes, base64.
const MASTER = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)))
const OTHER_MASTER = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 100 + i)))

const ANTHROPIC_KEY = "sk-ant-api03-SECRETSECRETSECRET-wxyz"
const GATEWAY_KEY = "vck_SECRETgatewaySECRET_9876"

const BYOK_ENV: ServerEnv = {
  ...TEST_ENV,
  AI_KEY_MODE: "byok",
  AI_KEYS_MASTER_KEY: MASTER,
}
const INSTANCE_ENV: ServerEnv = {
  ...TEST_ENV,
  AI_GATEWAY_API_KEY: "vck_INSTANCEkeySECRET_0000",
}

describe("AES-GCM key storage", () => {
  it("round-trips a key", async () => {
    const master = await importMasterKey(MASTER)
    const binding = { userId: "u1", provider: "anthropic" }
    const sealed = await sealKey(master, ANTHROPIC_KEY, binding)
    expect(sealed.ciphertext).not.toContain("SECRET")
    expect(await openKey(master, sealed, binding)).toBe(ANTHROPIC_KEY)
  })

  it("uses a fresh IV each time", async () => {
    const master = await importMasterKey(MASTER)
    const binding = { userId: "u1", provider: "anthropic" }
    const a = await sealKey(master, ANTHROPIC_KEY, binding)
    const b = await sealKey(master, ANTHROPIC_KEY, binding)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it("fails under another master key, or when moved to another user or provider", async () => {
    const master = await importMasterKey(MASTER)
    const sealed = await sealKey(master, ANTHROPIC_KEY, { userId: "u1", provider: "anthropic" })
    await expect(
      openKey(await importMasterKey(OTHER_MASTER), sealed, { userId: "u1", provider: "anthropic" })
    ).rejects.toThrow()
    await expect(openKey(master, sealed, { userId: "u2", provider: "anthropic" })).rejects.toThrow()
    await expect(openKey(master, sealed, { userId: "u1", provider: "openai" })).rejects.toThrow()
  })

  it("rejects a master key that isn't 32 bytes of base64", async () => {
    await expect(importMasterKey(btoa("too short"))).rejects.toThrow(/32 bytes/)
    await expect(importMasterKey("not base64!!")).rejects.toThrow(/base64/)
  })
})

async function byok(fetchSeen: { url: string; key: string | null }[] = []) {
  const db = await testDb()
  const fetch = (async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers)
    fetchSeen.push({ url, key: h.get("x-api-key") ?? h.get("authorization") })
    return new Response("{}", { status: 200 })
  }) as typeof globalThis.fetch
  const app = testApp(BYOK_ENV, db, undefined, { ai: { fetch } })
  const ada = await signUp(app, "ada")
  const ed = await signUp(app, "ed")
  const call = async (user: { headers: Record<string, string> }, method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: user.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, text: await res.text() }
  }
  const json = <T>(r: { text: string }) => JSON.parse(r.text) as T
  return { db, app, ada, ed, call, json }
}

describe("keys are never returned by any API", () => {
  it("no route's response carries a stored key, its ciphertext or its IV", async () => {
    const { db, app, ada, call } = await byok()
    const secrets = [ANTHROPIC_KEY, GATEWAY_KEY, ANTHROPIC_KEY.slice(4, -4), GATEWAY_KEY.slice(4, -4)]
    const responses: { route: string; status: number; text: string }[] = []
    const record = (route: string, r: { status: number; text: string }) => responses.push({ route, ...r })

    record("PUT anthropic", await call(ada, "PUT", "/api/ai/keys/anthropic", { apiKey: ANTHROPIC_KEY }))
    record("PUT gateway", await call(ada, "PUT", "/api/ai/keys/gateway", { apiKey: GATEWAY_KEY }))
    // A malformed key is refused without echoing it back.
    record("PUT bad", await call(ada, "PUT", "/api/ai/keys/openai", { apiKey: `${ANTHROPIC_KEY} with spaces` }))
    expect(responses.at(-1)!.status).toBe(400)

    const rows = await db.select().from(schema.aiKeys).where(eq(schema.aiKeys.userId, ada.id))
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.ciphertext).not.toContain("SECRET")
      secrets.push(row.ciphertext, row.iv)
    }

    record("test", await call(ada, "POST", "/api/ai/keys/anthropic/test"))
    record("settings", await call(ada, "PATCH", "/api/ai/settings", { provider: "gateway" }))
    record("estimate", await call(ada, "POST", "/api/ai/estimate", { sourceChars: 10_000 }))

    // Every GET route the app has, with placeholder params.
    const gets = new Set(
      app.routes
        .filter((r) => r.method === "GET" || r.method === "ALL")
        .map((r) => r.path)
        .filter((p) => !p.includes("*"))
    )
    expect(gets.has("/api/ai")).toBe(true)
    for (const path of gets) {
      const url = path.replace(/:(\w+)\??/g, "x") + "?q=a&expedition=x"
      record(`GET ${path}`, await call(ada, "GET", url))
    }
    record("DELETE", await call(ada, "DELETE", "/api/ai/keys/anthropic"))

    expect(responses.length).toBeGreaterThan(10)
    for (const { route, text } of responses)
      for (const secret of secrets) expect(text, route).not.toContain(secret)

    // What the browser does see: provider and last 4.
    const overview = JSON.parse(responses.find((r) => r.route === "GET /api/ai")!.text) as AiOverview
    expect(overview.keys).toEqual([
      { provider: "anthropic", last4: "wxyz", createdAt: expect.any(String) },
      { provider: "gateway", last4: "9876", createdAt: expect.any(String) },
    ])
  })
})

describe("bring your own key", () => {
  it("adds, tests, prefers and deletes keys; one key per provider per user", async () => {
    const seen: { url: string; key: string | null }[] = []
    const { db, ada, ed, call, json } = await byok(seen)

    let o = json<AiOverview>(await call(ada, "GET", "/api/ai"))
    expect(o).toMatchObject({ mode: "byok", ready: false, active: null, keys: [] })
    expect(o.providers.map((p) => p.id)).toEqual(["anthropic", "openai", "google", "gateway"])
    expect(await resolveAi(db, BYOK_ENV, ada.id)).toEqual({ ok: false, reason: "no-key" })
    expect((await call(ada, "POST", "/api/ai/estimate", { sourceChars: 1000 })).status).toBe(409)

    expect((await call(ada, "PUT", "/api/ai/keys/anthropic", { apiKey: "sk-ant-old-key-1111" })).status).toBe(200)
    expect((await call(ada, "PUT", "/api/ai/keys/anthropic", { apiKey: ANTHROPIC_KEY })).status).toBe(200)
    expect((await call(ada, "PUT", "/api/ai/keys/mistral", { apiKey: ANTHROPIC_KEY })).status).toBe(404)
    o = json<AiOverview>(await call(ada, "GET", "/api/ai"))
    expect(o.keys).toHaveLength(1)
    expect(o.keys[0]!.last4).toBe("wxyz")
    expect(o.active).toEqual({
      provider: "anthropic",
      label: "Anthropic",
      models: DEFAULT_MODELS.anthropic,
    })

    // Test sends the decrypted key to the provider, from the server only.
    const tested = json<{ ok: boolean }>(await call(ada, "POST", "/api/ai/keys/anthropic/test"))
    expect(tested).toEqual({ ok: true })
    expect(seen.at(-1)).toEqual({ url: expect.stringContaining("api.anthropic.com"), key: ANTHROPIC_KEY })

    // Resolved for a job: the reader's key and models, overrides applied.
    await call(ada, "PATCH", "/api/ai/settings", { models: { anthropic: { writer: "claude-opus-5-5" } } })
    const ai = await resolveAi(db, BYOK_ENV, ada.id)
    expect(ai.ok && ai.setup).toMatchObject({
      keySource: "reader",
      credentials: { provider: "anthropic", apiKey: ANTHROPIC_KEY },
      models: { ...DEFAULT_MODELS.anthropic, writer: "claude-opus-5-5" },
    })

    // Preferring a provider with no key falls back to one that has a key.
    await call(ada, "PATCH", "/api/ai/settings", { provider: "gateway" })
    expect(json<AiOverview>(await call(ada, "GET", "/api/ai")).active!.provider).toBe("anthropic")
    await call(ada, "PUT", "/api/ai/keys/gateway", { apiKey: GATEWAY_KEY })
    expect(json<AiOverview>(await call(ada, "GET", "/api/ai")).active!.provider).toBe("gateway")

    // Another reader sees, tests and deletes none of it.
    expect(json<AiOverview>(await call(ed, "GET", "/api/ai")).keys).toEqual([])
    expect((await call(ed, "POST", "/api/ai/keys/anthropic/test")).status).toBe(404)
    expect((await call(ed, "DELETE", "/api/ai/keys/anthropic")).status).toBe(404)
    expect(await loadKey(db, await importMasterKey(MASTER), ada.id, "anthropic")).toBe(ANTHROPIC_KEY)

    expect((await call(ada, "DELETE", "/api/ai/keys/anthropic")).status).toBe(204)
    expect((await call(ada, "DELETE", "/api/ai/keys/anthropic")).status).toBe(404)
    expect(json<AiOverview>(await call(ada, "GET", "/api/ai")).keys.map((k) => k.provider)).toEqual(["gateway"])
  })

  it("needs the master key to store or use keys", async () => {
    const db = await testDb()
    const app = testApp({ ...BYOK_ENV, AI_KEYS_MASTER_KEY: undefined }, db)
    const ada = await signUp(app, "ada")
    const res = await app.request("/api/ai/keys/anthropic", {
      method: "PUT",
      headers: ada.headers,
      body: JSON.stringify({ apiKey: ANTHROPIC_KEY }),
    })
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain("SECRET")
  })
})

describe("instance key", () => {
  it("serves everyone with the operator's key and models; takes no reader keys", async () => {
    const db = await testDb()
    const app = testApp(INSTANCE_ENV, db)
    const ada = await signUp(app, "ada")
    const get = async () =>
      (await (await app.request("/api/ai", { headers: ada.headers })).json()) as AiOverview
    const o = await get()
    expect(o).toMatchObject({
      mode: "instance",
      ready: true,
      keys: [],
      providers: [],
      active: { provider: "gateway", label: "Vercel AI Gateway", models: DEFAULT_MODELS.gateway },
    })
    const put = await app.request("/api/ai/keys/anthropic", {
      method: "PUT",
      headers: ada.headers,
      body: JSON.stringify({ apiKey: ANTHROPIC_KEY }),
    })
    expect(put.status).toBe(409)

    const ai = await resolveAi(db, { ...INSTANCE_ENV, AI_MODEL_SKIM: "anthropic/claude-sonnet-5.5" }, ada.id)
    expect(ai.ok && ai.setup).toMatchObject({
      keySource: "instance",
      credentials: { provider: "gateway", apiKey: INSTANCE_ENV.AI_GATEWAY_API_KEY },
      models: { ...DEFAULT_MODELS.gateway, skim: "anthropic/claude-sonnet-5.5" },
    })

    const est = await app.request("/api/ai/estimate", {
      method: "POST",
      headers: ada.headers,
      body: JSON.stringify({ sourceChars: 32_000, views: 5 }),
    })
    const { estimate } = (await est.json()) as { estimate: { usd: number; capUsd: number; views: number } }
    expect(estimate.views).toBe(5)
    expect(estimate.capUsd).toBeCloseTo(estimate.usd * 2)
  })

  it("falls back to direct provider keys, and says when there is none", async () => {
    const db = await testDb()
    const app = testApp(TEST_ENV, db)
    const ada = await signUp(app, "ada")
    expect(await resolveAi(db, TEST_ENV, ada.id)).toEqual({ ok: false, reason: "not-configured" })
    const ai = await resolveAi(
      db,
      { ...TEST_ENV, OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1", AI_MODEL_SKIM: "a", AI_MODEL_CURATOR: "b", AI_MODEL_WRITER: "c" },
      ada.id
    )
    expect(ai.ok && ai.setup.credentials).toEqual({
      provider: "openai-compatible",
      baseURL: "http://localhost:11434/v1",
      apiKey: "none",
    })
    const direct = await resolveAi(db, { ...TEST_ENV, ANTHROPIC_API_KEY: "sk-ant-direct-0000" }, ada.id)
    expect(direct.ok && direct.setup.models).toEqual(DEFAULT_MODELS.anthropic)
  })
})

describe("settings", () => {
  it("keeps the per-ask cap, within bounds, and resets it to the default", async () => {
    const { ada, call, json } = await byok()
    expect(json<AiOverview>(await call(ada, "GET", "/api/ai")).settings.askCapUsd).toBe(DEFAULT_ASK_CAP_USD)
    expect(json<AiOverview>(await call(ada, "PATCH", "/api/ai/settings", { askCapUsd: 1.25 })).settings.askCapUsd).toBe(1.25)
    expect((await call(ada, "PATCH", "/api/ai/settings", { askCapUsd: 500 })).status).toBe(400)
    expect((await call(ada, "PATCH", "/api/ai/settings", { askCapUsd: 0 })).status).toBe(400)
    expect((await call(ada, "PATCH", "/api/ai/settings", { models: { anthropic: { skim: "has space" } } })).status).toBe(400)
    expect((await call(ada, "PATCH", "/api/ai/settings", { nope: 1 })).status).toBe(400)
    expect(json<AiOverview>(await call(ada, "PATCH", "/api/ai/settings", { askCapUsd: null })).settings.askCapUsd).toBe(DEFAULT_ASK_CAP_USD)
  })

  it("needs a session", async () => {
    const { app } = await byok()
    expect((await app.request("/api/ai")).status).toBe(401)
  })

  it("rejects an unknown key mode", async () => {
    const db = await testDb()
    const app = testApp({ ...TEST_ENV, AI_KEY_MODE: "shared" }, db)
    const ada = await signUp(app, "ada")
    expect((await app.request("/api/ai", { headers: ada.headers })).status).toBe(503)
  })
})

describe("POST /ai/estimate/article", () => {
  it("prices each article length on the Expedition's Sources, for those who may use AI", async () => {
    const db = await testDb()
    const app = testApp(INSTANCE_ENV, db, undefined, { blobs: memoryBlobStore() })
    const ada = await signUp(app, "ada")
    const ed = await signUp(app, "ed")
    const created = await app.request("/api/expeditions", {
      method: "POST",
      headers: ada.headers,
      body: JSON.stringify({ title: "Tides" }),
    })
    const { id } = (await created.json()) as { id: string }
    const ask = (user = ada) =>
      app.request("/api/ai/estimate/article", {
        method: "POST",
        headers: user.headers,
        body: JSON.stringify({ expeditionId: id }),
      })
    type Out = {
      lengths: Record<"short" | "standard" | "long", { words: number; usd: number }>
      sourceChars: number
      askCapUsd: number
    }

    const before = (await (await ask()).json()) as Out
    expect(before.sourceChars).toBe(0)
    expect(before.askCapUsd).toBe(DEFAULT_ASK_CAP_USD)

    const text = "## Spring tides\n\nThe Sun and Moon line up.\n\n".repeat(400)
    const pasted = await app.request(`/api/sources/${id}`, {
      method: "POST",
      headers: ada.headers,
      body: JSON.stringify({ type: "paste", text }),
    })
    expect(pasted.status).toBe(201)

    const out = (await (await ask()).json()) as Out
    expect(out.sourceChars).toBeGreaterThan(5_000)
    const { short, standard, long } = out.lengths
    expect([short.words, standard.words, long.words]).toEqual([300, 600, 1200])
    expect(short.usd).toBeGreaterThan(0)
    expect(standard.usd).toBeGreaterThan(short.usd)
    expect(long.usd).toBeGreaterThan(standard.usd)
    expect(standard.usd).toBeGreaterThan(before.lengths.standard.usd)

    // Someone who can't see the Expedition gets nothing.
    expect((await ask(ed)).status).toBe(404)
  })
})
