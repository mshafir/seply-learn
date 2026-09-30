// The estimate against real calls on the fixtures (WP-3.3: within ±30%).
// estimate-actuals.json is recorded by scripts/measure-estimate.ts through the
// AI Gateway; re-run it when a model, price or tokenizer changes.
import { describe, expect, it } from "vitest"
import actuals from "./estimate-actuals.json" with { type: "json" }
import {
  BUILD_CAP_MULTIPLIER,
  estimateBuild,
  noteStepUsage,
  SOURCE_TOKEN_CAP,
} from "./estimate.ts"
import { fixtureSources } from "./fixture-sources.ts"
import { DEFAULT_MODELS, stageModels } from "./models.ts"
import { costOf, priceOf } from "./pricing.ts"

const within = (estimate: number, actual: number) =>
  Math.abs(estimate - actual) / actual

describe("the estimate on the fixtures", () => {
  const rows = actuals.rows
  const sources = new Map(fixtureSources().map((f) => [f.name, f.text]))

  it("was measured on the committed fixtures as they are now", () => {
    for (const row of rows)
      expect(row.chars.source, row.fixture).toBe(sources.get(row.fixture)!.length)
    expect(new Set(rows.map((r) => r.fixture))).toEqual(
      new Set(["research-doc", "compute"])
    )
  })

  it.each(rows.map((r) => [`${r.model} on ${r.fixture} (run ${r.run})`, r] as const))(
    "%s: tokens within 15%, cost within 30%",
    (_, row) => {
      const est = noteStepUsage("gateway", row.model, row.chars.source, {
        promptChars: row.chars.system,
        cached: row.run > 0,
      })
      const actualInput = row.usage.input + row.usage.cacheRead + row.usage.cacheWrite
      expect(within(est.cacheRead + est.cacheWrite, actualInput)).toBeLessThan(0.15)

      const { price, known } = priceOf("gateway", row.model)
      expect(known).toBe(true)
      expect(row.costUsd).not.toBeNull()
      expect(within(costOf(est, price), row.costUsd!)).toBeLessThan(0.3)
    }
  )

  it("prices actual usage as the gateway billed it (within 2%)", () => {
    for (const row of rows) {
      const { price } = priceOf("gateway", row.model)
      expect(within(costOf(row.usage, price), row.costUsd!), row.model).toBeLessThan(0.02)
    }
  })
})

describe("estimateBuild", () => {
  const research = fixtureSources()[0]!.text.length
  const models = stageModels("gateway")

  it("covers the skim, the curator and the writers, capped at 2×", () => {
    const e = estimateBuild({ provider: "gateway", models, sourceChars: research })
    expect(e.stages.skim.model).toBe(DEFAULT_MODELS.gateway.skim)
    expect(e.stages.curator.usage.cacheWrite).toBeGreaterThan(e.sourceTokens)
    expect(e.stages.curator.usage.cacheRead).toBeGreaterThan(0)
    expect(e.stages.writer.usage.output).toBeGreaterThan(0)
    for (const s of Object.values(e.stages)) expect(s.priced).toBe(true)
    expect(e.usd).toBeCloseTo(
      e.stages.skim.usd + e.stages.curator.usd + e.stages.writer.usd
    )
    expect(e.capUsd).toBeCloseTo(e.usd * BUILD_CAP_MULTIPLIER)
    expect(e.overCap).toBe(false)
    // A plausible range for a ~12k-token doc on Opus/Sonnet/Haiku.
    expect(e.usd).toBeGreaterThan(0.2)
    expect(e.usd).toBeLessThan(5)
  })

  it("grows with the Sources and the Views", () => {
    const small = estimateBuild({ provider: "gateway", models, sourceChars: research })
    const big = estimateBuild({ provider: "gateway", models, sourceChars: research * 10 })
    const more = estimateBuild({ provider: "gateway", models, sourceChars: research, views: 8 })
    expect(big.usd).toBeGreaterThan(small.usd)
    expect(big.concepts).toBeGreaterThan(small.concepts)
    expect(more.usd).toBeGreaterThan(small.usd)
  })

  it("flags Sources over the token cap", () => {
    const e = estimateBuild({
      provider: "anthropic",
      models: stageModels("anthropic"),
      sourceChars: SOURCE_TOKEN_CAP * 3,
    })
    expect(e.overCap).toBe(true)
  })

  it("prices an unknown model at the fallback and says so", () => {
    const e = estimateBuild({
      provider: "openai-compatible",
      models: { skim: "llama-local", curator: "llama-local", writer: "llama-local" },
      sourceChars: research,
    })
    expect(e.stages.curator.priced).toBe(false)
    expect(e.usd).toBeGreaterThan(0)
  })
})
