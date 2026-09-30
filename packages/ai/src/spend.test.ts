import type { LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider"
import { generateText, streamText } from "ai"
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test"
import { describe, expect, it } from "vitest"
import { modelFor } from "./setup.ts"
import { meteredModel, SpendingCapReached, SpendMeter } from "./spend.ts"

const usage = (input: number, output: number): LanguageModelV4Usage => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
})

const generated = (
  input: number,
  output: number,
  providerMetadata?: LanguageModelV4GenerateResult["providerMetadata"]
): LanguageModelV4GenerateResult => ({
  content: [{ type: "text", text: "ok" }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: usage(input, output),
  warnings: [],
  providerMetadata,
})

// Opus 5.5 on the gateway: $4 in, $20 out per million.
const OPUS = { provider: "gateway", modelId: "anthropic/claude-opus-5.5" } as const

describe("SpendMeter", () => {
  it("prices calls from the table and stops at the cap", async () => {
    const meter = new SpendMeter({ kind: "ask", capUsd: 0.5 })
    const model = meteredModel(
      new MockLanguageModelV4({ doGenerate: generated(100_000, 5_000) }),
      meter,
      OPUS
    )
    // Each call: 0.1 × $4 + 0.005 × $20 = $0.50.
    await generateText({ model, prompt: "hi" })
    expect(meter.spentUsd).toBeCloseTo(0.5)
    expect(meter.reached).toBe(true)
    await expect(generateText({ model, prompt: "again", maxRetries: 0 })).rejects.toThrow(
      SpendingCapReached
    )
    expect(meter.toJSON().calls).toBe(1)
  })

  it("prefers the cost the gateway reports", async () => {
    const meter = new SpendMeter({ kind: "build", capUsd: 10 })
    const model = meteredModel(
      new MockLanguageModelV4({
        doGenerate: generated(100_000, 5_000, { gateway: { cost: "0.1234" } }),
      }),
      meter,
      OPUS
    )
    await generateText({ model, prompt: "hi" })
    expect(meter.spentUsd).toBeCloseTo(0.1234)
  })

  it("records streamed calls when they finish", async () => {
    const meter = new SpendMeter({ kind: "build", capUsd: 10 })
    const model = meteredModel(
      new MockLanguageModelV4({
        doStream: {
          stream: convertArrayToReadableStream([
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "hello" },
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: usage(1_000_000, 0),
            },
          ]),
        },
      }),
      meter,
      OPUS
    )
    const result = streamText({ model, prompt: "hi" })
    expect(await result.text).toBe("hello")
    expect(meter.spentUsd).toBeCloseTo(4)
    expect(meter.toJSON().usage.input).toBe(1_000_000)
  })

  it("prices an unknown model at the fallback and counts it as estimated", () => {
    const meter = new SpendMeter({ kind: "build", capUsd: 10 })
    meter.record({
      provider: "openai-compatible",
      modelId: "llama-local",
      usage: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 },
    })
    expect(meter.spentUsd).toBeCloseTo(5)
    expect(meter.toJSON().estimatedCalls).toBe(1)
  })

  it("continues after a pause by raising the cap, and resumes from JSON", () => {
    const meter = new SpendMeter({ kind: "build", capUsd: 1 })
    meter.record({ ...OPUS, usage: { input: 250_000, cacheRead: 0, cacheWrite: 0, output: 0 } })
    expect(meter.reached).toBe(true)
    expect(() => meter.check()).toThrow(SpendingCapReached)
    meter.raise()
    expect(meter.capUsd).toBe(2)
    expect(meter.remainingUsd).toBeCloseTo(1)
    const resumed = SpendMeter.from(JSON.parse(JSON.stringify(meter)))
    expect(resumed.spentUsd).toBeCloseTo(1)
    expect(resumed.capUsd).toBe(2)
    expect(() => resumed.check()).not.toThrow()
  })

  it("rejects a cap that isn't positive", () => {
    expect(() => new SpendMeter({ kind: "ask", capUsd: 0 })).toThrow(RangeError)
  })
})

describe("modelFor", () => {
  it("builds the stage's model on the setup's provider, metered when asked", async () => {
    const calls: string[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push(url)
      const body = JSON.parse(String(init?.body)) as { model: string }
      expect(body.model).toBe("claude-haiku-4-5")
      expect(new Headers(init?.headers).get("x-api-key")).toBe("sk-ant-test-1234")
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: "hi" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1_000_000, output_tokens: 0 },
        }),
        { headers: { "content-type": "application/json" } }
      )
    }) as typeof globalThis.fetch
    const meter = new SpendMeter({ kind: "build", capUsd: 5 })
    const model = modelFor(
      {
        keySource: "reader",
        credentials: { provider: "anthropic", apiKey: "sk-ant-test-1234" },
        models: { skim: "claude-haiku-4-5", curator: "claude-opus-5-5", writer: "claude-sonnet-5-5" },
        options: { fetch },
      },
      "skim",
      meter
    )
    const { text } = await generateText({ model, prompt: "hi" })
    expect(text).toBe("hi")
    expect(calls[0]).toMatch(/^https:\/\/api\.anthropic\.com\//)
    // Haiku 4.5: $1 per million input tokens.
    expect(meter.spentUsd).toBeCloseTo(1)
  })
})
