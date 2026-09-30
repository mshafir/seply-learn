import { describe, expect, it } from "vitest"
import { DEFAULT_MODELS, stageModels } from "./models.ts"
import { canonicalModelId, priceOf, tokenUsage } from "./pricing.ts"
import { ApiKey, languageModel, last4, testKey } from "./providers.ts"
import { tokenizerFamily } from "./tokens.ts"

describe("languageModel", () => {
  it("creates each provider's model per call, with the given key", () => {
    const key = "test-key-12345678"
    expect(languageModel({ provider: "gateway", apiKey: key }, "anthropic/claude-opus-5.5").modelId).toBe(
      "anthropic/claude-opus-5.5"
    )
    expect(languageModel({ provider: "anthropic", apiKey: key }, "claude-opus-5-5").provider).toMatch(/anthropic/)
    expect(languageModel({ provider: "openai", apiKey: key }, "gpt-6-luna").provider).toMatch(/openai/)
    expect(languageModel({ provider: "google", apiKey: key }, "gemini-3.8-flash").provider).toMatch(/google/)
    expect(
      languageModel(
        { provider: "openai-compatible", apiKey: key, baseURL: "http://localhost:11434/v1" },
        "llama"
      ).modelId
    ).toBe("llama")
    expect(() => languageModel({ provider: "openai-compatible", apiKey: key }, "llama")).toThrow()
  })
})

describe("testKey", () => {
  const fake = (status: number, seen: { url?: string; headers?: Headers }[] = []) =>
    (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: new Headers(init?.headers) })
      return new Response("{}", { status })
    }) as typeof globalThis.fetch

  it("lists models with the key in a header, never in the URL", async () => {
    const seen: { url?: string; headers?: Headers }[] = []
    const key = "sk-ant-secret-abcd"
    expect(await testKey({ provider: "anthropic", apiKey: key }, { fetch: fake(200, seen) })).toEqual({ ok: true })
    expect(seen[0]!.url).not.toContain(key)
    expect(seen[0]!.headers!.get("x-api-key")).toBe(key)

    await testKey({ provider: "google", apiKey: key }, { fetch: fake(200, seen) })
    expect(seen[1]!.url).not.toContain(key)
    expect(seen[1]!.headers!.get("x-goog-api-key")).toBe(key)
  })

  it("reports a refused key, other errors and an unreachable provider", async () => {
    const creds = { provider: "openai", apiKey: "sk-bad-00000000" } as const
    expect(await testKey(creds, { fetch: fake(401) })).toEqual({ ok: false, reason: "rejected", status: 401 })
    expect(await testKey(creds, { fetch: fake(500) })).toEqual({ ok: false, reason: "error", status: 500 })
    const down = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof globalThis.fetch
    expect(await testKey(creds, { fetch: down })).toEqual({ ok: false, reason: "unreachable" })
  })

  it("checks a gateway key by reading its credits", async () => {
    const seen: { url?: string; headers?: Headers }[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: new Headers(init?.headers) })
      return new Response(JSON.stringify({ balance: "1", total_used: "0" }), {
        headers: { "content-type": "application/json" },
      })
    }) as typeof globalThis.fetch
    expect(await testKey({ provider: "gateway", apiKey: "vck_test_1234" }, { fetch })).toEqual({ ok: true })
    expect(seen[0]!.url).toMatch(/credits/)
  })
})

describe("keys", () => {
  it("accepts API-key-shaped strings only, and shows the last 4", () => {
    expect(ApiKey.parse("  sk-ant-api03-abcdefgh  ")).toBe("sk-ant-api03-abcdefgh")
    expect(ApiKey.safeParse("short").success).toBe(false)
    expect(ApiKey.safeParse("has a space in it").success).toBe(false)
    expect(last4("sk-ant-api03-abcdefgh")).toBe("efgh")
  })
})

describe("models and prices", () => {
  it("has a price and a tokenizer for every default model", () => {
    for (const [provider, models] of Object.entries(DEFAULT_MODELS))
      for (const id of Object.values(models)) {
        const p = provider as keyof typeof DEFAULT_MODELS
        expect(priceOf(p, id).known, `${provider} ${id}`).toBe(true)
        expect(tokenizerFamily(p, id)).not.toBe("other")
      }
  })

  it("maps provider ids to the gateway's", () => {
    expect(canonicalModelId("anthropic", "claude-opus-5-5")).toBe("anthropic/claude-opus-5.5")
    expect(canonicalModelId("anthropic", "claude-haiku-4-5-20251001")).toBe("anthropic/claude-haiku-4.5")
    expect(canonicalModelId("google", "models/gemini-3.8-flash")).toBe("google/gemini-3.8-flash")
    expect(tokenizerFamily("anthropic", "claude-haiku-4-5")).toBe("claude-legacy")
    expect(tokenizerFamily("gateway", "anthropic/claude-sonnet-5.5")).toBe("claude")
  })

  it("applies overrides per stage and needs a model for every stage", () => {
    expect(stageModels("anthropic", { writer: "claude-opus-5-5" })).toEqual({
      ...DEFAULT_MODELS.anthropic,
      writer: "claude-opus-5-5",
    })
    expect(() => stageModels("openai-compatible", { skim: "a" })).toThrow(/curator/)
  })

  it("reads both shapes of AI SDK usage", () => {
    expect(
      tokenUsage({
        inputTokens: { total: 100, noCache: 10, cacheRead: 80, cacheWrite: 10 },
        outputTokens: { total: 5 },
      })
    ).toEqual({ input: 10, cacheRead: 80, cacheWrite: 10, output: 5 })
    expect(
      tokenUsage({
        inputTokens: 100,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 60, cacheWriteTokens: 0 },
        outputTokens: 7,
      })
    ).toEqual({ input: 40, cacheRead: 60, cacheWrite: 0, output: 7 })
  })
})
