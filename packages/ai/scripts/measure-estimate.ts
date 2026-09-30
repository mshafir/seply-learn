// Measures real calls on the committed fixtures through the AI Gateway and
// writes src/estimate-actuals.json, which src/estimate.test.ts checks the
// estimate against (within ±30%, the WP-3.3 bar). Spends real money (well
// under $1 a run), so it is not part of `pnpm test`:
//
//   node --env-file=../../apps/worker/.dev.vars --experimental-transform-types \
//     scripts/measure-estimate.ts
//
// Each call is the curator's first step (spec §5.2): the whole Source in
// context, cached, and the understanding note written back.
import { createGateway, generateText } from "ai"
import { writeFileSync } from "node:fs"
import { NOTE_INSTRUCTIONS } from "../src/estimate.ts"
import { fixtureSources } from "../src/fixture-sources.ts"
import { gatewayCost, tokenUsage } from "../src/pricing.ts"

const apiKey = process.env.AI_GATEWAY_API_KEY
if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not set")
const gateway = createGateway({ apiKey })

// The cheap model of each tokenizer family on both fixtures; the Claude
// tiers on the small one.
const plan: { model: string; fixtures: string[]; repeat?: boolean }[] = [
  { model: "anthropic/claude-haiku-4.5", fixtures: ["research-doc", "compute"] },
  { model: "anthropic/claude-sonnet-5.5", fixtures: ["research-doc", "compute"], repeat: true },
  { model: "anthropic/claude-opus-5.5", fixtures: ["research-doc"] },
  { model: "openai/gpt-6-luna", fixtures: ["research-doc", "compute"] },
  { model: "google/gemini-3.5-flash-lite", fixtures: ["research-doc", "compute"] },
]

const sources = new Map(fixtureSources().map((f) => [f.name, f.text]))
const rows = []
for (const { model, fixtures, repeat } of plan) {
  for (const name of fixtures) {
    const text = sources.get(name)!
    for (let run = 0; run < (repeat ? 2 : 1); run++) {
      const result = await generateText({
        model: gateway(model),
        system: NOTE_INSTRUCTIONS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text,
                providerOptions: {
                  anthropic: { cacheControl: { type: "ephemeral" } },
                },
              },
            ],
          },
        ],
        maxOutputTokens: 4000,
      })
      const usage = tokenUsage(result.usage)
      const row = {
        fixture: name,
        model,
        run,
        chars: { system: NOTE_INSTRUCTIONS.length, source: text.length },
        usage,
        costUsd: gatewayCost(result.providerMetadata) ?? null,
      }
      console.log(JSON.stringify(row))
      rows.push(row)
    }
  }
}

writeFileSync(
  new URL("../src/estimate-actuals.json", import.meta.url),
  JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2) + "\n"
)
