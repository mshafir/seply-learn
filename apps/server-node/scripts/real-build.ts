// Runs a real build (the `build` job kind, WP-3.5b) on a committed public
// fixture, with the real curator model through the instance key, against a
// Postgres database, on the in-process engine. Spends real money (a few
// dollars a build), so it is not part of `pnpm test`.
//
//   DATABASE_URL=postgres://… node --env-file=../worker/.dev.vars \
//     --experimental-transform-types scripts/real-build.ts <fixture> [options]
//
// Fixtures: `research-doc` (docs/research/knowledge-graph-learning-tools.md)
// and `ebike-chat` (packages/ai/fixtures/skim/ebike-decision-chat.txt, the
// synthetic decision chat WP-3.4 wrote). Options:
//   --crash-at-view <n>  simulate a runtime restart as View n starts building,
//                        then wake the job (Workflows' restart semantics)
//   --kill-at-view <n>   exit the process as View n starts building (a hard
//                        kill); rerun with --resume <jobId> to Retry it
//   --resume <jobId>     mark an interrupted job failed and Retry it (the
//                        summary adds up time, cost and stages across runs)
//   --summarize <expeditionId>  no build: inspect and export it again
//   --model <id>         override the curator model (AI_MODEL_CURATOR)
//
// The build ends with the writers (WP-3.6): the summary counts overviews and
// articles and lists any provenance ref that doesn't resolve.
//
// Writes packages/ai/fixtures/builds/<fixture>.json (the Expedition, our JSON)
// and <fixture>.summary.json (Views, counts, inspect results, cost, time).
import { createGateway } from "ai"
import { coreConcepts, inspectView, memorySourceReader, unresolvedProv, type Segment } from "@seply/ai"
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
  readSegments,
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
    // The four Views the WP-3.4 skim pre-selected for this doc (src/skim-actuals.json, run 0).
    views: [
      { viewType: "comparison-table", label: "Compare tools", question: "Which tools have the features I need: prerequisite graphs, visual exploration, LLM help, and human curation?" },
      { viewType: "evidence", label: "What the evidence says", question: "What evidence exists for which features are most important, and where do the tools fail?" },
      { viewType: "anatomy", label: "Anatomy of a tool", question: "What are the parts of a working knowledge-graph learning tool, and how do they fit together?" },
      { viewType: "learning-path", label: "Where to start", question: "What do I need to understand first: what are prerequisites vs related concepts, and where do the different tool families sit?" },
    ],
  },
  "ebike-chat": {
    title: "E-bike for the commute",
    raw: () => readFileSync(new URL("packages/ai/fixtures/skim/ebike-decision-chat.txt", root)),
    read: async () =>
      parsePaste(readFileSync(new URL("packages/ai/fixtures/skim/ebike-decision-chat.txt", root), "utf8"), "E-bike chat"),
    // The four Views the WP-3.4 skim pre-selected for this chat (src/skim-actuals.json, run 0).
    views: [
      { viewType: "comparison-table", label: "Compare the bikes", question: "How do these bikes stack up on what matters to me: hill climbing, maintenance, weight, theft protection, and price?" },
      { viewType: "cause-and-effect", label: "Mid-drive or hub", question: "If I pick mid-drive vs hub, what follows: how steep can I climb, how quiet is the ride, what maintenance do I face?" },
      { viewType: "learning-path", label: "What to learn first", question: "What do I need to understand first: motor types, battery size, frame style, or the bikes themselves?" },
      { viewType: "timeline", label: "Running costs over time", question: "When do batteries, chains, and servicing cost kick in, and how much for each bike?" },
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
const summarizeOnly = opt("--summarize")
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
        engineRef?.crash()
        void writeSummary("killed").finally(() => process.exit(3))
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
if (summarizeOnly) {
  expeditionId = summarizeOnly
  const prev = JSON.parse(readFileSync(new URL(`${name}.summary.json`, outDir), "utf8")) as { jobId: string }
  job = { id: prev.jobId, attempt: 1 } as Job
} else if (resume) {
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
  const changeId = ulid(Date.now())
  await db.transaction((tx) =>
    createExpedition(tx, {
      id: expeditionId,
      userId,
      ops: makeOps([{ kind: "expedition.set", target: expeditionId, path: "title", value: fixture.title }], {
        expeditionId,
        actor: userId,
        changeId,
        nextOpId: () => ulid(Date.now()),
      }),
      change: { id: changeId, label: "Created the Expedition" },
    })
  )
  const parsed = await fixture.read()
  await addSource(db, fsBlobs, { expeditionId, userId, parsed, raw: fixture.raw() })
  job = await runner.start(db, { expeditionId, kind: "build", input: { views: fixture.views }, startedBy: userId })
  console.log(`expedition ${expeditionId}, job ${job.id}`)
}

const id = instanceId({ jobId: job.id, attempt: job.attempt })
if (!summarizeOnly) {
  await engine.settled(id)
  if (crashAt !== null && engine.status(id) === "running") {
    console.log("waking the job after the simulated restart")
    await engine.wake!(id)
    await engine.settled(id)
  }
}
await writeSummary(summarizeOnly ? null : "ran")
await conn.close()
process.exit(0)

/** Inspects and exports the Expedition; adds this run to the summary. */
async function writeSummary(run: "ran" | "killed" | null) {
  const secs = Math.round((Date.now() - t0) / 1000)
  const [final] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id))
  if (run) console.log(`job ${final!.status}${final!.error ? `: ${final!.error}` : ""} in ${secs}s`)
  const state = (await loadState(db, expeditionId))!
  // The Sources, for the checks that read segments (a cited reader decision).
  const segs: Record<string, Segment[]> = {}
  for (const sid of Object.keys(state.sources)) {
    const r = await readSegments(db, fsBlobs, expeditionId, sid)
    if (r) segs[sid] = r.segments.segments
  }
  const ports = { views: { read: readView }, sources: memorySourceReader(segs) }
  const views = Object.values(state.views).filter(isLive).sort((a, b) => a.orderKey.localeCompare(b.orderKey))
  const inspected = []
  for (const v of views) {
    const i = await inspectView(state, v.id, ports)
    inspected.push({
      viewType: v.viewType,
      label: v.label,
      question: v.question ?? null,
      status: v.status,
      failReason: v.failReason ?? null,
      inspect: { ok: i.ok, problems: i.problems.map((p) => p.message), warnings: i.warnings.map((w) => w.message), layout: i.layout ?? null },
    })
  }
  const file = new URL(`${name}.summary.json`, outDir)
  type Prev = { jobId: string; seconds: number; costUsd: { gatewayBilled: number }; runs: unknown[]; stages: Record<string, unknown> }
  const prev: Prev | null =
    existsSync(file) && (resume || !run) ? (JSON.parse(readFileSync(file, "utf8")) as Prev) : null
  let stages = prev?.stages ?? {}
  let seconds = prev?.seconds ?? 0
  let billed = prev?.costUsd.gatewayBilled ?? 0
  const runs = prev?.runs ?? []
  if (run) {
    await new Promise((r) => setTimeout(r, 5000)) // the gateway's usage settles
    const cost = Number(await credits()) - usedBefore
    const recorded = engine.recorded(id).filter((n) => /^(note|concepts|View \d+: build|write \d+$)/.test(n))
    const these = Object.fromEntries(
      recorded.map((n) => {
        const r = (engine.result(id, n) ?? {}) as Record<string, unknown>
        return [
          `attempt ${job.attempt}: ${n}`,
          { summary: r.summary ?? r.note ?? null, written: r.written ?? null, missing: r.missing ?? null, repairs: r.repairs ?? null, review: r.review ?? null, reason: r.reason ?? null, warnings: r.warnings ?? null, steps: r.steps ?? null, toolCalls: r.toolCalls ?? null, spentUsdSoFar: (r.meter as { spentUsd?: number } | undefined)?.spentUsd ?? null },
        ]
      })
    )
    stages = { ...stages, ...these }
    seconds += secs
    billed += cost
    runs.push({ attempt: job.attempt, outcome: run === "killed" ? "killed (process exit)" : final!.status, seconds: secs, gatewayBilledUsd: +cost.toFixed(4) })
  }
  const changes = await db
    .select({ label: schema.changes.label })
    .from(schema.changes)
    .where(eq(schema.changes.expeditionId, expeditionId))
    .orderBy(schema.changes.id)
  const live = <T extends { deletedAt: string | null }>(r: Record<string, T>) => Object.values(r).filter(isLive)
  const summary = {
    fixture: name,
    expeditionId,
    jobId: job.id,
    status: final!.status,
    error: final!.error,
    model: process.env.AI_MODEL_CURATOR ?? "anthropic/claude-opus-5.5 (the default curator)",
    seconds,
    costUsd: { gatewayBilled: +billed.toFixed(4) },
    runs,
    counts: {
      concepts: live(state.concepts).length,
      relationships: live(state.relationships).length,
      attributes: live(state.attributes).length,
      views: views.length,
      coreConcepts: live(state.concepts).filter((c) => c.weightPin === "core").length,
      backgroundConcepts: live(state.concepts).filter((c) => c.prov.length === 0).length,
      // The writers (WP-3.6)
      withOverview: live(state.concepts).filter((c) => c.overview?.trim()).length,
      coreWithArticle: coreConcepts(state).filter((id) => live(state.sections).some((x) => x.conceptId === id)).length,
      core: coreConcepts(state).length,
      sections: live(state.sections).length,
    },
    // Done when (WP-3.6): every provenance ref resolves to a real segment.
    unresolvedProv: unresolvedProv(
      [
        ...live(state.concepts).map((c) => ({ kind: "concept.set" as const, target: c.id, path: "overviewProv", value: c.overviewProv })),
        ...live(state.sections).map((x) => ({ kind: "section.create" as const, target: x.id, value: { conceptId: x.conceptId, orderKey: x.orderKey, heading: x.heading, md: x.md, prov: x.prov } })),
      ],
      Object.entries(segs).map(([id, segments]) => ({ id, title: id, segments }))
    ),
    changes: changes.map((c) => c.label),
    views: inspected,
    stages,
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL(`${name}.json`, outDir), JSON.stringify(stateToExpeditionJson(state), null, 2) + "\n")
  writeFileSync(file, JSON.stringify(summary, null, 2) + "\n")
  console.log(JSON.stringify({ ...summary, changes: undefined, stages: undefined }, null, 2))
}
