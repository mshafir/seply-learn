// Runs a real build (the `build` job kind, WP-3.5b) on a committed public
// fixture, with the real curator model through the instance key, against a
// Postgres database, on the in-process engine. Spends real money (a few
// dollars a build), so it is not part of `pnpm test`.
//
//   DATABASE_URL=postgres://… node --env-file=../worker/.dev.vars \
//     --experimental-transform-types scripts/real-build.ts <fixture> [options]
//
// Fixtures: `research-doc` (docs/research/knowledge-graph-learning-tools.md)
// and `ebike-chat` (packages/ai/fixtures/builds/ebike-chat.md, a synthetic
// chat). Options:
//   --crash-at-view <n>  simulate a runtime restart as View n starts building,
//                        then wake the job (Workflows' restart semantics)
//   --kill-at-view <n>   exit the process as View n starts building (a hard
//                        kill); rerun with --resume <jobId> to Retry it
//   --resume <jobId>     mark an interrupted job failed and Retry it
//   --model <id>         override the curator model (AI_MODEL_CURATOR)
//
// Writes packages/ai/fixtures/builds/<fixture>.json (the Expedition, our JSON)
// and <fixture>.summary.json (Views, counts, inspect results, cost, time).
import { createGateway } from "ai"
import { inspectView } from "@seply/ai"
import {
  addSource,
  connectPg,
  createExpedition,
  createInlineEngine,
  createJobRunner,
  instanceId,
  JOB_KINDS,
  loadState,
  parseFile,
  parsePaste,
  type BlobStore,
  type BuildViewChoice,
  type Job,
  type Relay,
} from "@seply/server"
import {
  isLive,
  makeOps,
  schema,
  stateToExpeditionJson,
  ulid,
  type BuildEvent,
} from "@seply/domain"
import { readView } from "@seply/views/inspect"
import { eq } from "drizzle-orm"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"

const root = new URL("../../../", import.meta.url)
const outDir = new URL("packages/ai/fixtures/builds/", root)

const FIXTURES: Record<
  string,
  { title: string; read: () => Promise<ReturnType<typeof parsePaste>>; raw: () => Uint8Array; views: BuildViewChoice[] }
> = {
  "research-doc": {
    title: "Open-source tools for learning graphs",
    raw: () => readFileSync(new URL("docs/research/knowledge-graph-learning-tools.md", root)),
    read: async () =>
      parseFile({
        bytes: readFileSync(new URL("docs/research/knowledge-graph-learning-tools.md", root)),
        filename: "knowledge-graph-learning-tools.md",
        type: "text/markdown",
      }),
    // The Views the seeding prototype's skim proposed for this doc.
    views: [
      { viewType: "comparison-table", label: "Compare tools", question: "How do the tools stack up on the four pillars: prerequisites, visuals, LLM and human curation?" },
      { viewType: "outline", label: "Outline", question: "What families of tools are out there, what's in each, and what does it all add up to?" },
      { viewType: "evidence", label: "Evidence", question: "Why can't an LLM build the prerequisite graph on its own, and what backs the design advice?" },
      { viewType: "quadrant", label: "Prerequisites vs LLM", question: "Which tools have a real prerequisite model, which have real LLM power, and does anything have both?" },
    ],
  },
  "ebike-chat": {
    title: "E-bike commute",
    raw: () => readFileSync(new URL("ebike-chat.md", outDir)),
    read: async () => parsePaste(readFileSync(new URL("ebike-chat.md", outDir), "utf8"), "E-bike commute chat"),
    views: [
      { viewType: "comparison-table", label: "Compare e-bikes", question: "Which e-bike fits a 14 km hilly, all-year commute?" },
      { viewType: "outline", label: "Outline", question: "What do I need to know to commute by e-bike?" },
      { viewType: "cause-and-effect", label: "What wears it down", question: "What makes winter and the hill harder on the bike and battery, and what can I do about it?" },
    ],
  },
}

// --- args ---------------------------------------------------------------------
const args = process.argv.slice(2)
const name = args[0]!
const opt = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const fixture = FIXTURES[name]
if (!fixture) throw new Error(`fixture: one of ${Object.keys(FIXTURES).join(", ")}`)
const crashAt = opt("--crash-at-view") ? Number(opt("--crash-at-view")) : null
const killAt = opt("--kill-at-view") ? Number(opt("--kill-at-view")) : null
const resume = opt("--resume")
if (opt("--model")) process.env.AI_MODEL_CURATOR = opt("--model")
const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set")
const gatewayKey = process.env.AI_GATEWAY_API_KEY
if (!gatewayKey) throw new Error("AI_GATEWAY_API_KEY is not set")

// Blobs on disk, so a killed run's Sources survive for --resume.
const blobDir = join(process.env.TMPDIR ?? "/tmp", "seply-real-build-blobs")
const fsBlobs: BlobStore = {
  async put(key, body) {
    const file = join(blobDir, key)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, typeof body === "string" ? body : Buffer.from(body))
  },
  async get(key) {
    const file = join(blobDir, key)
    if (!existsSync(file)) return null
    return { body: new Uint8Array(readFileSync(file)) as Uint8Array<ArrayBuffer> }
  },
  async delete() {},
}

const connect = () => connectPg(url)
const credits = async () => (await createGateway({ apiKey: gatewayKey }).getCredits()).totalUsed

// --- the run -------------------------------------------------------------------
const t0 = Date.now()
const usedBefore = Number(await credits())
let viewN = 0
const builds = new Set<string>()
let engineRef: ReturnType<typeof createInlineEngine> | null = null
const relay: Relay = {
  published: () => {},
  build: (_e, evt: BuildEvent) => {
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    if (evt.viewId && evt.status === "building" && !builds.has(evt.viewId)) {
      builds.add(evt.viewId)
      viewN++
      console.log(`[${secs}s] View ${viewN} building (${evt.step})`)
      if (killAt === viewN) {
        console.log(`KILL: exiting as View ${viewN} starts`)
        process.exit(3)
      }
      if (crashAt === viewN && engineRef) {
        console.log(`CRASH: dropping the job as View ${viewN} starts`)
        engineRef.crash()
      }
    } else if (!evt.viewId || evt.status !== "building") {
      console.log(`[${secs}s] ${evt.viewId ? `View ${evt.viewId.slice(-6)} ` : ""}${evt.status}: ${evt.step}${evt.reason ? ` (${evt.reason})` : ""}`)
    }
  },
}

const services = { env: process.env as Record<string, string>, blobs: fsBlobs, views: { read: readView } }
const engine = createInlineEngine({ deps: { connect, relay, services }, registry: JOB_KINDS, delayScale: 1 })
engineRef = engine
const runner = createJobRunner({ engine, registry: JOB_KINDS, relay })

const conn = await connect()
const db = conn.db
let job: Job
let expeditionId: string
if (resume) {
  const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, resume))
  if (!row) throw new Error(`no job ${resume}`)
  expeditionId = row.expeditionId
  // The process that ran it is gone: a durable engine would resume the
  // attempt; the in-process one can't, so mark it failed and Retry.
  await db.update(schema.jobs).set({ status: "failed", error: "Interrupted" }).where(eq(schema.jobs.id, resume))
  job = await runner.retry(db, resume)
  console.log(`resumed job ${job.id} as attempt ${job.attempt}`)
} else {
  const userId = `real-build-${ulid(Date.now())}`
  await db.insert(schema.users).values({ id: userId, name: "Real build", email: `${userId}@example.com` })
  expeditionId = ulid(Date.now())
  await db.transaction((tx) =>
    createExpedition(tx, {
      id: expeditionId,
      userId,
      ops: makeOps([{ kind: "expedition.set", target: expeditionId, path: "title", value: fixture.title }], {
        expeditionId,
        actor: userId,
        changeId: ulid(Date.now()),
        nextOpId: () => ulid(Date.now()),
      }),
      change: { id: ulid(Date.now()), label: "Created the Expedition" },
    })
  )
  const parsed = await fixture.read()
  await addSource(db, fsBlobs, { expeditionId, userId, parsed, raw: fixture.raw() })
  job = await runner.start(db, { expeditionId, kind: "build", input: { views: fixture.views }, startedBy: userId })
  console.log(`expedition ${expeditionId}, job ${job.id}`)
}

const id = instanceId({ jobId: job.id, attempt: job.attempt })
await engine.settled(id)
if (crashAt !== null && engine.status(id) === "running") {
  console.log("waking the job after the simulated restart")
  await engine.wake!(id)
  await engine.settled(id)
}
const secs = Math.round((Date.now() - t0) / 1000)
const [final] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id))
console.log(`job ${final!.status}${final!.error ? `: ${final!.error}` : ""} in ${secs}s`)

// --- what it made ----------------------------------------------------------------
const state = (await loadState(db, expeditionId))!
const views = Object.values(state.views).filter(isLive).sort((a, b) => a.orderKey.localeCompare(b.orderKey))
const inspected = []
for (const v of views) {
  const i = await inspectView(state, v.id, { views: { read: readView } })
  inspected.push({
    viewType: v.viewType,
    label: v.label,
    question: v.question ?? null,
    status: v.status,
    failReason: v.failReason ?? null,
    inspect: { ok: i.ok, problems: i.problems.map((p) => p.message), warnings: i.warnings.map((w) => w.message), layout: i.layout ?? null },
  })
}
const results = Object.fromEntries(
  engine.recorded(id).filter((n) => /^(note|concepts|View \d+: build)/.test(n)).map((n) => [n, engine.result(id, n)])
)
const lastMeter = Object.values(results).at(-1) as { meter?: { spentUsd: number; usage: unknown; calls: number } } | undefined
await new Promise((r) => setTimeout(r, 5000)) // the gateway's usage settles
const usedAfter = Number(await credits())
const changes = await db.select({ label: schema.changes.label }).from(schema.changes).where(eq(schema.changes.expeditionId, expeditionId)).orderBy(schema.changes.id)
const summary = {
  fixture: name,
  expeditionId,
  jobId: job.id,
  attempt: final!.attempt,
  status: final!.status,
  error: final!.error,
  model: process.env.AI_MODEL_CURATOR ?? "anthropic/claude-opus-5.5 (default)",
  seconds: secs,
  costUsd: { gatewayBilled: +(usedAfter - usedBefore).toFixed(4), meter: lastMeter?.meter?.spentUsd ?? null, calls: lastMeter?.meter?.calls ?? null },
  counts: {
    concepts: Object.values(state.concepts).filter(isLive).length,
    relationships: Object.values(state.relationships).filter(isLive).length,
    attributes: Object.values(state.attributes).filter(isLive).length,
    views: views.length,
    coreConcepts: Object.values(state.concepts).filter((c) => isLive(c) && c.weightPin === "core").length,
    backgroundConcepts: Object.values(state.concepts).filter((c) => isLive(c) && c.prov.length === 0).length,
  },
  changes: changes.map((c) => c.label),
  views: inspected,
  stages: Object.fromEntries(
    Object.entries(results).map(([k, v]) => {
      const r = v as Record<string, unknown>
      return [k, { summary: r.summary ?? r.note ?? null, review: r.review ?? null, reason: r.reason ?? null, steps: r.steps ?? null, toolCalls: r.toolCalls ?? null, spentUsd: (r.meter as { spentUsd?: number } | undefined)?.spentUsd ?? null }]
    })
  ),
}
mkdirSync(outDir, { recursive: true })
writeFileSync(new URL(`${name}.json`, outDir), JSON.stringify(stateToExpeditionJson(state), null, 2) + "\n")
writeFileSync(new URL(`${name}.summary.json`, outDir), JSON.stringify(summary, null, 2) + "\n")
console.log(JSON.stringify({ ...summary, changes: undefined, stages: undefined }, null, 2))
await conn.close()
process.exit(0)
