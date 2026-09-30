// Runs the real skim on the fixtures (synthetic chats and the research doc)
// through the AI Gateway on the default skim model, and writes
// src/skim-actuals.json: time, tokens, cost and the proposed Views. The bar
// (WP-3.4): 4–8 Views within 20 s, with valid ids and View Types. Spends real
// money (about a cent a run), so it is not part of `pnpm test`:
//
//   node --env-file=../../apps/worker/.dev.vars --experimental-transform-types \
//     scripts/measure-skim.ts [runs per fixture, default 2]
import { writeFileSync } from "node:fs"
import { DEFAULT_MODELS } from "../src/models.ts"
import { runSkim, SkimResult } from "../src/skim.ts"
import { skimFixtures } from "../src/skim-fixtures.ts"
import { modelFor } from "../src/setup.ts"
import { SpendMeter } from "../src/spend.ts"

const apiKey = process.env.AI_GATEWAY_API_KEY
if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not set")
const runs = Number(process.argv[2] ?? 2)
const models = DEFAULT_MODELS.gateway
const setup = { keySource: "instance" as const, credentials: { provider: "gateway" as const, apiKey }, models }

const rows = []
for (const f of skimFixtures()) {
  for (let run = 0; run < runs; run++) {
    const meter = new SpendMeter({ kind: "build", capUsd: 1 })
    const started = Date.now()
    const out = await runSkim({ model: modelFor(setup, "skim", meter), sources: f.sources })
    const totalMs = Date.now() - started
    const valid = SkimResult.safeParse(out.result).success
    const n = out.result.views.length
    const ids = new Set(out.result.views.map((v) => v.id))
    const ok = valid && n >= 4 && n <= 8 && ids.size === n && totalMs <= 20_000
    const row = {
      fixture: f.name,
      model: models.skim,
      run,
      ms: totalMs,
      usd: Number(meter.spentUsd.toFixed(5)),
      usage: out.usage,
      sample: out.sample,
      ok,
      title: out.result.title,
      views: out.result.views.map((v) => `${v.on ? "●" : "○"} ${v.id} [${v.viewType}] ${v.question}`),
    }
    rows.push(row)
    console.log(`${f.name} #${run}: ${(totalMs / 1000).toFixed(1)} s, $${row.usd}, ${n} Views, ${ok ? "ok" : "FAIL"}`)
    for (const v of row.views) console.log(`   ${v}`)
  }
}
writeFileSync(
  new URL("../src/skim-actuals.json", import.meta.url),
  JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2) + "\n"
)
