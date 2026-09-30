// Runs the real writers (WP-3.6) on a committed build export: every Concept's
// summary and overview, then the core Concepts' articles, through the AI
// Gateway on the default writer model, and checks the Done-when (every
// Concept has an overview, core Concepts have articles, every provenance ref
// resolves to a real segment). Spends real money (well under $1 for the
// e-bike chat on Sonnet 5.5), so it is not part of `pnpm test`; the spending
// cap stops it (default $2):
//
//   node --env-file=../../apps/worker/.dev.vars --experimental-transform-types \
//     scripts/real-write.ts <ebike-chat|research-doc> [--cap <usd>] [--model <id>] [--dry]
//
// --dry runs the scripted writer from @seply/ai/testing instead (no key, no
// spend, nothing written), to check the plumbing and the Source's segments.
//
// The writers run here as plain stage calls, one batch at a time (the build
// job runs them as durable steps; apps/server-node/scripts/real-build.ts runs
// the whole build, writers included). Writes fixtures/builds/<fixture>.written.json
// (the Expedition with its overviews and articles, our JSON: Library → Import)
// and <fixture>.written.summary.json (counts, checks, repairs, time and cost).
import {
  importExpeditionJson,
  isLive,
  segmentText,
  stateToExpeditionJson,
  ulid,
  type DomainState,
} from "@seply/domain"
import { createGateway } from "ai"
import { readFileSync, writeFileSync } from "node:fs"
import { applyBodies } from "../src/curator/curator.ts"
import type { CuratorSource } from "../src/curator/sources.ts"
import { DEFAULT_MODELS } from "../src/models.ts"
import { modelFor } from "../src/setup.ts"
import { meteredModel, SpendingCapReached, SpendMeter } from "../src/spend.ts"
import { scriptedModel, writerScript } from "../src/testing.ts"
import {
  coreConcepts,
  planWriters,
  unresolvedProv,
  writeBatch,
  type ProvRepair,
  type WriterMode,
} from "../src/writers/writers.ts"

const root = new URL("../../../", import.meta.url)
const builds = new URL("packages/ai/fixtures/builds/", root)
const FIXTURES: Record<string, { source: URL; title: string }> = {
  "ebike-chat": { source: new URL("packages/ai/fixtures/skim/ebike-decision-chat.txt", root), title: "E-bike chat" },
  "research-doc": { source: new URL("docs/research/knowledge-graph-learning-tools.md", root), title: "knowledge-graph-learning-tools" },
}

const args = process.argv.slice(2)
const name = args[0] ?? "ebike-chat"
const opt = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const fixture = FIXTURES[name]
if (!fixture) throw new Error(`fixture: one of ${Object.keys(FIXTURES).join(", ")}`)
const capUsd = Number(opt("--cap") ?? 2)
const dry = args.includes("--dry")
const apiKey = process.env.AI_GATEWAY_API_KEY ?? ""
if (!apiKey && !dry) throw new Error("AI_GATEWAY_API_KEY is not set")
const models = { ...DEFAULT_MODELS.gateway, ...(opt("--model") && { writer: opt("--model")! }) }
const setup = { keySource: "instance" as const, credentials: { provider: "gateway" as const, apiKey }, models }

// The build's Expedition, re-minted, and its one Source segmented as the build did.
const now = Date.now()
const imported = importExpeditionJson(JSON.parse(readFileSync(new URL(`${name}.json`, builds), "utf8")), {
  expeditionId: ulid(now),
  actor: "real-write",
  changeId: ulid(now),
  nextOpId: () => ulid(Date.now()),
  newId: () => ulid(Date.now()),
  at: new Date(now).toISOString(),
})
let state: DomainState = imported.state
const sourceIds = Object.keys(state.sources)
if (sourceIds.length !== 1) throw new Error(`expected one Source, found ${sourceIds.length}`)
const sources: CuratorSource[] = [
  {
    id: sourceIds[0]!,
    title: fixture.title,
    segments: segmentText(readFileSync(fixture.source, "utf8")).segments,
  },
]

const gateway = createGateway({ apiKey })
const credits = async () => (dry ? 0 : Number((await gateway.getCredits()).totalUsed))
const usedBefore = await credits()
const meter = new SpendMeter({ kind: "build", capUsd })
const model = dry
  ? meteredModel(scriptedModel(writerScript()), meter, { provider: "gateway", modelId: models.writer })
  : modelFor(setup, "writer", meter)
const t0 = Date.now()
const plan = planWriters(state)
const batches: { mode: WriterMode; ids: string[] }[] = [
  ...plan.overviews.map((ids) => ({ mode: "overviews" as const, ids })),
  ...plan.articles.map((ids) => ({ mode: "articles" as const, ids })),
]
console.log(`${name}: ${plan.overviews.flat().length} overviews in ${plan.overviews.length} batches, ${plan.articles.flat().length} articles in ${plan.articles.length}, on ${models.writer}, cap $${capUsd}`)

const runs: { n: number; mode: WriterMode; concepts: number; written: number; missing: string[]; ms: number; usd: number }[] = []
const repairs: ProvRepair[] = []
let unlinked = 0
let stopped: string | null = null
for (const [i, b] of batches.entries()) {
  const started = Date.now()
  const spent = meter.spentUsd
  try {
    const r = await writeBatch(b.mode, { model, state, sources, ids: b.ids, whole: true })
    const bad = unresolvedProv(r.bodies, sources)
    if (bad.length) throw new Error(`unresolved provenance: ${JSON.stringify(bad)}`)
    state = applyBodies(state, r.bodies)
    repairs.push(...r.repairs)
    unlinked += r.unlinked
    runs.push({ n: i + 1, mode: b.mode, concepts: b.ids.length, written: r.written.length, missing: r.missing, ms: Date.now() - started, usd: +(meter.spentUsd - spent).toFixed(4) })
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] batch ${i + 1}/${batches.length} ${b.mode}: ${r.written.length}/${b.ids.length} written, ${r.repairs.length} repairs, $${meter.spentUsd.toFixed(3)} so far`)
  } catch (err) {
    if (err instanceof SpendingCapReached || (err as { cause?: unknown })?.cause instanceof SpendingCapReached) {
      stopped = `spending cap: ${(err as Error).message}`
      console.log(`STOP: ${stopped}`)
      break
    }
    stopped = `batch ${i + 1} failed: ${(err as Error).message}`
    console.log(`STOP: ${stopped}`)
    break
  }
}
const seconds = Math.round((Date.now() - t0) / 1000)

// --- the Done-when checks ---------------------------------------------------------
const concepts = Object.values(state.concepts).filter(isLive)
const core = coreConcepts(state)
const sections = Object.values(state.sections).filter(isLive)
const refs = [
  ...concepts.flatMap((c) => c.overviewProv),
  ...sections.flatMap((s) => s.prov),
]
const allBodies = [
  ...concepts.map((c) => ({ kind: "concept.set" as const, target: c.id, path: "overviewProv", value: c.overviewProv })),
  ...sections.map((s) => ({ kind: "section.create" as const, target: s.id, value: { conceptId: s.conceptId, orderKey: s.orderKey, heading: s.heading, md: s.md, prov: s.prov } })),
]
const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const checks = {
  everyConceptHasAnOverview: concepts.every((c) => !!c.overview?.trim()),
  coreConceptsHaveArticles: core.every((id) => sections.some((s) => s.conceptId === id)),
  everyRefResolves: unresolvedProv(allBodies, sources).length === 0,
}
if (!dry) await new Promise((r) => setTimeout(r, 5000)) // the gateway's usage settles
const billed = (await credits()) - usedBefore
const summary = {
  fixture: name,
  model: models.writer,
  stopped,
  seconds,
  costUsd: { meter: +meter.spentUsd.toFixed(4), gatewayBilled: +billed.toFixed(4) },
  checks,
  counts: {
    concepts: concepts.length,
    withOverview: concepts.filter((c) => c.overview?.trim()).length,
    overviewsFromSources: concepts.filter((c) => c.overviewProv.length).length,
    core: core.length,
    coreWithArticle: core.filter((id) => sections.some((s) => s.conceptId === id)).length,
    sections: sections.length,
    sectionsFromSources: sections.filter((s) => s.prov.length).length,
    provRefs: refs.length,
    overviewWords: { min: Math.min(...concepts.map((c) => words(c.overview ?? ""))), max: Math.max(...concepts.map((c) => words(c.overview ?? ""))) },
    articleWords: core.map((id) => sections.filter((s) => s.conceptId === id).reduce((n, s) => n + words(s.md), 0)),
    linksInText: [...concepts.map((c) => c.overview ?? ""), ...sections.map((s) => s.md)].reduce((n, t) => n + (t.match(/\]\(#c\//g)?.length ?? 0), 0),
    unlinked,
  },
  repairs,
  batches: runs,
}
if (!dry) writeFileSync(new URL(`${name}.written.json`, builds), JSON.stringify(stateToExpeditionJson(state), null, 2) + "\n")
if (!dry) writeFileSync(new URL(`${name}.written.summary.json`, builds), JSON.stringify(summary, null, 2) + "\n")
console.log(JSON.stringify({ ...summary, repairs: repairs.length, batches: runs.length }, null, 2))
