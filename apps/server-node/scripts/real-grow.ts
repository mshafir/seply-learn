// Runs one real Grow ask (the `grow` job kind, WP-4.4) on the committed
// compute sample, with the real curator model through the instance key,
// against a Postgres database, on the in-process engine. Spends real money
// (well under a dollar), so it is not part of `pnpm test`.
//
//   DATABASE_URL=postgres://… node --env-file=../worker/.dev.vars \
//     --experimental-transform-types scripts/real-grow.ts [options]
//
// Options:
//   --ask "<words>"     the ask (default: "What would I need to understand QLoRA?")
//   --cap <usd>         the per-ask cap (default: the reader's, $0.50)
//   --model <id>        override the curator model (AI_MODEL_CURATOR)
//   --name <file>       output name (default: qlora)
//
// Imports packages/domain/fixtures/compute.json as a new Expedition, asks,
// and writes packages/ai/fixtures/grow/<name>.proposal.json (the Proposal as
// GET …/proposals returns it) and <name>.summary.json (each item in words,
// when it streamed, whether they all apply, the agent's last words, time
// and cost), for owner review.
import { createGateway } from "ai"
import {
  connectPg,
  createInlineEngine,
  createJobRunner,
  importExpedition,
  instanceId,
  JOB_KINDS,
  loadState,
  memoryBlobStore,
  readProposal,
  type Relay,
} from "@seply/server"
import { isLive, previewProposals, schema, ulid, type BuildEvent, type DomainState, type OpBody } from "@seply/domain"
import { readView } from "@seply/views/inspect"
import { eq } from "drizzle-orm"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const root = new URL("../../../", import.meta.url)
const outDir = new URL("packages/ai/fixtures/grow/", root)

const args = process.argv.slice(2)
const opt = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const ask = opt("--ask") ?? "What would I need to understand QLoRA?"
const cap = opt("--cap") ? Number(opt("--cap")) : undefined
const name = opt("--name") ?? "qlora"
if (opt("--model")) process.env.AI_MODEL_CURATOR = opt("--model")
const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set")
const gatewayKey = process.env.AI_GATEWAY_API_KEY
if (!gatewayKey) throw new Error("AI_GATEWAY_API_KEY is not set")
const credits = async () => Number((await createGateway({ apiKey: gatewayKey }).getCredits()).totalUsed)

const t0 = Date.now()
const secs = () => Math.round((Date.now() - t0) / 100) / 10
const streamed: { at: number; step: string }[] = []
const relay: Relay = {
  published: () => {},
  poke: () => {},
  build: (_e, evt: BuildEvent) => {
    console.log(`[${secs()}s] ${evt.status}: ${evt.step}${evt.reason ? ` (${evt.reason})` : ""}`)
    if (/^Suggested \d+ changes? so far$/.test(evt.step)) streamed.push({ at: secs(), step: evt.step })
  },
}
const connect = () => connectPg(url)
const services = {
  env: process.env as Record<string, string>,
  blobs: memoryBlobStore(),
  views: { read: readView },
}
const engine = createInlineEngine({ deps: { connect, relay, services }, registry: JOB_KINDS, delayScale: 1 })
const runner = createJobRunner({ engine, registry: JOB_KINDS, relay })

const usedBefore = await credits()
const conn = await connect()
const db = conn.db
const userId = `real-grow-${ulid(Date.now())}`
await db.insert(schema.users).values({ id: userId, name: "Real grow", email: `${userId}@example.com` })
const file = JSON.parse(readFileSync(new URL("packages/domain/fixtures/compute.json", root), "utf8"))
const imported = await importExpedition(db, { userId, file })
const expeditionId = imported.expedition.id
const before = (await loadState(db, expeditionId))!

const t1 = Date.now()
const job = await runner.start(db, {
  expeditionId,
  kind: "grow",
  input: { ask, ...(cap && { capUsd: cap }) },
  startedBy: userId,
})
console.log(`expedition ${expeditionId}, job ${job.id}: “${ask}”`)
let inst = instanceId({ jobId: job.id, attempt: job.attempt })
await engine.settled(inst)
// At the per-ask cap the ask pauses; as a reader's Continue, carry on once.
const pauses: { at: number; error: string | null }[] = []
const [paused] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id))
if (paused!.status === "paused") {
  pauses.push({ at: secs(), error: paused!.error })
  console.log(`paused: ${paused!.error}; continuing once`)
  const next = await runner.continue(db, job.id)
  inst = instanceId({ jobId: next.id, attempt: next.attempt })
  await engine.settled(inst)
}
const seconds = Math.round((Date.now() - t1) / 1000)

const [final] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id))
const proposal = await readProposal(db, expeditionId, job.id)
const result = engine.result(inst, "ask") as
  | { items: number; text: string; meter: { spentUsd: number; calls: number; usage: unknown } }
  | undefined
// Gateway credits settle a little after the call.
await new Promise((r) => setTimeout(r, 5_000))
const billed = Math.round(((await credits()) - usedBefore) * 10_000) / 10_000

// Would they all apply, accepted together?
const items = proposal?.items ?? []
const preview = previewProposals(before, items)
const after = preview.state

const untouched =
  Object.keys((await loadState(db, expeditionId))!.concepts).length === Object.keys(before.concepts).length

const title = (s: DomainState, id: string) => s.concepts[id]?.title ?? id
const short = (t: string) => t.replace(/^builtin:/, "")
const describe = (ops: OpBody[]) => {
  const op = ops[0]!
  if (op.kind === "concept.create")
    return {
      kind: "new Concept",
      title: op.value.title,
      conceptKind: short(op.value.kind),
      tags: op.value.tags ?? [],
      summary: op.value.summary ?? null,
      overview: op.value.overview ?? null,
      overviewWords: op.value.overview?.split(/\s+/).filter(Boolean).length ?? 0,
      prov: op.value.prov ?? [],
      more: ops.slice(1).map((o) => `${o.kind}${"path" in o ? ` ${o.path}` : ""}`),
    }
  if (op.kind === "relationship.add") {
    const [from, type, to] = op.target.split("|") as [string, string, string]
    return {
      kind: "new Relationship",
      title: `${title(after, from)} -${short(type)}-> ${title(after, to)}`,
      fromIsNew: !isLive(before.concepts[from]),
      toIsNew: !isLive(before.concepts[to]),
      note: (op.value as { note?: string }).note ?? null,
    }
  }
  return {
    kind: "edit",
    title: title(after, op.target),
    ops: ops.map((o) => ({ kind: o.kind, ...("path" in o && { path: o.path }), ...("value" in o && { value: o.value }) })),
  }
}

const summary = {
  ask,
  fixture: "packages/domain/fixtures/compute.json (201 Concepts, 425 Relationships, no Source text)",
  model: process.env.AI_MODEL_CURATOR ?? "anthropic/claude-opus-5.5 (default curator)",
  jobStatus: final!.status,
  jobError: final!.error,
  seconds,
  costUsd: {
    gatewayBilled: billed,
    meter: result ? Math.round(result.meter.spentUsd * 10_000) / 10_000 : null,
    cap: cap ?? 0.5,
  },
  pausedAtCap: pauses,
  calls: result?.meter.calls ?? null,
  usage: result?.meter.usage ?? null,
  agentLastWords: result?.text ?? null,
  streamed,
  items: items.map((i) => ({ id: i.id, position: i.position, ...describe(i.ops) })),
  counts: {
    items: items.length,
    newConcepts: items.filter((i) => i.ops[0]!.kind === "concept.create").length,
    relationships: items.filter((i) => i.ops[0]!.kind === "relationship.add").length,
    edits: items.filter((i) => !["concept.create", "relationship.add"].includes(i.ops[0]!.kind)).length,
  },
  doneWhen: {
    itemsStreamedWhileRunning: streamed.length > 1,
    everyNewConceptHasSummaryAndOverview: items.every(
      (i) => i.ops[0]!.kind !== "concept.create" || (!!i.ops[0]!.value.summary && !!i.ops[0]!.value.overview)
    ),
    allApplyWhenAccepted: preview.skipped.length === 0,
    expeditionUntouched: untouched,
  },
}

mkdirSync(outDir, { recursive: true })
writeFileSync(new URL(`${name}.proposal.json`, outDir), JSON.stringify(proposal, null, 2) + "\n")
writeFileSync(new URL(`${name}.summary.json`, outDir), JSON.stringify(summary, null, 2) + "\n")
console.log(JSON.stringify({ ...summary, items: summary.items.map((i) => `${i.kind}: ${i.title}`) }, null, 2))
await conn.close()
process.exit(0)
