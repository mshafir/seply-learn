// The build job end to end on the in-process engine and a migrated database,
// with a scripted model (no provider, no spend): the note, the Concept set as
// one Change, each View as its own Change with preview events, a View failed
// with a plain reason, a restart mid-build and a Retry (nothing logged twice,
// no duplicate Views), the spending-cap pause, and chunk mode.
import type { ViewReader } from "@seply/ai"
import { idsFrom, scriptedModel, type ScriptTurn } from "@seply/ai/testing"
import { isLive, schema, type BuildEvent, type DomainState } from "@seply/domain"
import { asc, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { memoryBlobStore } from "../blobs.ts"
import type { Db } from "../db.ts"
import { loadState } from "../projection.ts"
import type { Relay } from "../relay.ts"
import { parsePaste } from "../sources/parse.ts"
import { addSource } from "../sources/store.ts"
import { signUp, testApp, testDb, TEST_ENV, type TestUser } from "../test-harness.ts"
import { BuildJobInput, isCapPause } from "./build.ts"
import { createInlineEngine, type InlineEngine } from "./inline.ts"
import { JOB_KINDS } from "./registry.ts"
import { createJobRunner } from "./runner.ts"
import { instanceId, type Job, type JobServices } from "./types.ts"

// A synthetic decision chat, written for this test.
const CHAT = `## User
We want a 3D printer for the kids. It has to be enclosed, and multicolour would be nice.

## Assistant
I'd go with the Orbit P2: enclosed, and every enclosed printer here runs ABS.

## User
OK, we ordered the Orbit P2 this morning.

## Assistant
The Kite has no enclosure; the Box S1 is enclosed but single colour.
`

type Hooks = {
  /** Called when a View's build starts (its first model call), by View Type. */
  onView?: (viewType: string) => void
  /** View Types the script fails with view_fail. */
  fail?: Set<string>
}

const prov = (source: string, segment: string) => [{ source, segment }]

/** One script for every stage, told apart by the tools on offer. */
function script(hooks: Hooks) {
  return (t: ScriptTurn) => {
    const source = /<source(?:-index)? id="([^"]+)"/.exec(t.user)?.[1] ?? "?"
    if (!t.tools.length) return { text: "They want an enclosed printer; they ordered the Orbit P2." }
    if (!t.tools.includes("view_build")) {
      // The Concept set (whole, a chunk, or the merge pass).
      if (t.tools.includes("concept_merge")) return { text: "Tidy." }
      if (t.step === 0) {
        const hub = /Choosing a printer \((\w+)\)|(\w+) \| Choosing a printer/.exec(t.user)
        return {
          calls: [
            ...(hub ? [] : [{ tool: "concept_create", input: { title: "Choosing a printer", kind: "builtin:topic", tags: ["topic"], prov: prov(source, "t1") } }]),
            { tool: "concept_create", input: { title: "Orbit P2", kind: "builtin:thing", prov: prov(source, "t2") } },
            { tool: "concept_create", input: { title: "Kite", kind: "builtin:thing", prov: prov(source, "t4") } },
          ],
        }
      }
      if (t.step === 1) {
        const made = idsFrom(t, "concept_create")
        const hubId =
          /(\w+) \| Choosing a printer/.exec(t.user)?.[1] ?? made[0]!
        const kids = made.filter((id) => id !== hubId)
        return {
          calls: kids.map((id) => ({
            tool: "relationship_add",
            input: { from: id, type: "builtin:part-of", to: hubId, prov: prov(source, "t1") },
          })),
        }
      }
      return { text: "Found the Concepts." }
    }
    const viewType = /- View Type: ([\w-]+)/.exec(t.user)![1]!
    if (t.step === 0) hooks.onView?.(viewType)
    if (hooks.fail?.has(viewType))
      return { calls: [{ tool: "view_fail", input: { reason: "Only one printer has verdicts, so there's nothing to compare." } }] }
    if (t.step === 0) {
      const settings =
        viewType === "outline"
          ? { relationshipTypes: ["builtin:part-of"], rootTag: "topic" }
          : viewType === "comparison-table"
            ? { rows: {}, columns: [] }
            : { relationshipTypes: ["builtin:prerequisite"] }
      return { calls: [{ tool: "view_build", input: { viewType, label: `Built ${viewType}`, settings } }] }
    }
    if (t.step === 1) return { calls: [{ tool: "view_commit", input: { review: "It answers the question with the printers and the hub." } }] }
    return { text: "done" }
  }
}

const stubViews: ViewReader = {
  read: async (state, viewId) => ({ text: `${state.views[viewId]!.label}` }),
}

type Setup = {
  db: Db
  app: ReturnType<typeof testApp>
  engine: InlineEngine
  events: BuildEvent[]
  ada: TestUser
  exp: string
  source: string
  hooks: Hooks
  model: ReturnType<typeof scriptedModel>
}

async function setup(
  opts: { usage?: { input: number; output: number }; curator?: JobServices["curator"] } = {}
): Promise<Setup> {
  const db = await testDb()
  const events: BuildEvent[] = []
  const relay: Relay = {
    published: () => {},
    build: (_e, evt) => void events.push(evt),
  }
  const hooks: Hooks = {}
  const model = scriptedModel(script(hooks), { usage: opts.usage })
  const blobs = memoryBlobStore()
  const services: JobServices = {
    blobs,
    views: stubViews,
    model: () => model,
    curator: opts.curator,
  }
  const deps = { connect: async () => ({ db, close: async () => {} }), relay, services }
  const engine = createInlineEngine({ deps, registry: JOB_KINDS })
  const jobs = createJobRunner({ engine, registry: JOB_KINDS, relay })
  const app = testApp(TEST_ENV, db, relay, { jobs, blobs })
  const ada = await signUp(app, "ada")
  const created = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Which printer?" }),
  })
  const { id: exp } = (await created.json()) as { id: string }
  const added = await addSource(db, blobs, {
    expeditionId: exp,
    userId: ada.id,
    parsed: parsePaste(CHAT, "Printer chat"),
    raw: CHAT,
  })
  return { db, app, engine, events, ada, exp, source: added.source.id, hooks, model }
}

const VIEWS = [
  { viewType: "outline", label: "Outline", question: "What's in here?" },
  { viewType: "learning-path", label: "Learning path", question: "What do I learn first?" },
]

async function start(s: Setup, input: unknown): Promise<Job> {
  const res = await s.app.request(`/api/expeditions/${s.exp}/jobs`, {
    method: "POST",
    headers: s.ada.headers,
    body: JSON.stringify({ kind: "build", input }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { job: Job }).job
}

async function job(s: Setup, id: string): Promise<Job> {
  const res = await s.app.request(`/api/jobs/${id}`, { headers: s.ada.headers })
  return ((await res.json()) as { job: Job }).job
}

async function state(s: Setup): Promise<DomainState> {
  return (await loadState(s.db, s.exp))!
}

async function changes(s: Setup): Promise<string[]> {
  const rows = await s.db
    .select({ label: schema.changes.label })
    .from(schema.changes)
    .where(eq(schema.changes.expeditionId, s.exp))
    .orderBy(asc(schema.changes.id))
  return rows.map((r) => r.label ?? "")
}

const inst = (j: Job, attempt = 1) => instanceId({ jobId: j.id, attempt })

const liveViews = (st: DomainState) =>
  Object.values(st.views)
    .filter(isLive)
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey))

describe("the build job", () => {
  it("takes the chosen Views and optional Sources and cap", () => {
    expect(BuildJobInput.parse({ views: VIEWS }).views).toHaveLength(2)
    expect(BuildJobInput.safeParse({ views: [{ viewType: "pie-chart", label: "x" }] }).success).toBe(false)
  })

  it("queues the Views, commits the Concept set, then each View as its own Change", async () => {
    const s = await setup()
    const j = await start(s, { views: VIEWS, capUsd: 50 })
    await s.engine.settled(inst(j))
    expect((await job(s, j.id)).status).toBe("complete")

    const st = await state(s)
    const views = liveViews(st)
    expect(views.map((v) => [v.viewType, v.status])).toEqual([
      ["outline", "ready"],
      ["learning-path", "ready"],
    ])
    expect(Object.values(st.concepts).filter(isLive)).toHaveLength(3)
    expect(st.expedition.status).toBe("ready")
    expect(st.expedition.bestViewId).toBe(views[0]!.id)
    expect(await changes(s)).toEqual([
      "Created the Expedition",
      "Added the Source “Printer chat”",
      "Queued 2 Views",
      "Found 3 Concepts in 1 Source",
      "Built Built outline",
      "Built Built learning-path",
    ])
    // Provenance points at the real Source and its segments.
    const orbit = Object.values(st.concepts).find((c) => c.title === "Orbit P2")!
    expect(orbit.prov).toEqual([{ source: s.source, segment: "t2" }])
    // The room saw each View building (with preview nodes) and ready.
    const v1 = s.events.filter((e) => e.viewId === views[0]!.id)
    expect(v1.map((e) => e.status)).toContain("building")
    expect(v1.at(-1)!.status).toBe("ready")
    expect(s.events.at(-1)).toMatchObject({ status: "complete", progress: 1 })
    // The understanding note went to the model once, and into every later stage.
    const noteCalls = s.model.turns.filter((t) => !t.tools.length)
    expect(noteCalls).toHaveLength(1)
    expect(s.model.turns.filter((t) => t.tools.length).every((t) => t.user.includes("they ordered the Orbit P2"))).toBe(true)
  })

  it("resumes after a restart mid-build with nothing logged twice and no duplicate Views", async () => {
    const s = await setup()
    let crashed = false
    s.hooks.onView = (viewType) => {
      if (viewType === "learning-path" && !crashed) {
        crashed = true
        s.engine.crash()
      }
    }
    const j = await start(s, { views: VIEWS, capUsd: 50 })
    await s.engine.settled(inst(j))
    expect(crashed).toBe(true)
    const mid = await state(s)
    expect(liveViews(mid).map((v) => v.status)).toEqual(["ready", "queued"])

    await s.engine.wake!(inst(j))
    await s.engine.settled(inst(j))
    expect((await job(s, j.id)).status).toBe("complete")
    const st = await state(s)
    expect(liveViews(st).map((v) => v.status)).toEqual(["ready", "ready"])
    const labels = await changes(s)
    expect(labels.filter((l) => l.startsWith("Found"))).toHaveLength(1)
    expect(labels.filter((l) => l === "Built Built outline")).toHaveLength(1)
    expect(labels.filter((l) => l === "Built Built learning-path")).toHaveLength(1)
    expect(Object.values(st.concepts).filter(isLive)).toHaveLength(3)
  })

  it("fails a View the Sources can't support with its plain reason; a Retry builds only that View", async () => {
    const s = await setup()
    s.hooks.fail = new Set(["comparison-table"])
    const input = { views: [VIEWS[0], { viewType: "comparison-table", label: "Compare printers" }], capUsd: 50 }
    const j = await start(s, input)
    await s.engine.settled(inst(j))
    const failed = await job(s, j.id)
    expect(failed.status).toBe("failed")
    expect(failed.error).toBe("1 of 2 Views couldn't be built: Compare printers")
    let st = await state(s)
    const table = liveViews(st).find((v) => v.viewType === "comparison-table")!
    expect(table).toMatchObject({
      status: "failed",
      failReason: "Only one printer has verdicts, so there's nothing to compare.",
    })
    expect(s.events.find((e) => e.viewId === table.id && e.status === "failed")?.reason).toMatch(/nothing to compare/)

    // Retry: the Concept set and the ready View are kept; the table builds.
    s.hooks.fail = new Set()
    const built: string[] = []
    s.hooks.onView = (t) => void built.push(t)
    const res = await s.app.request(`/api/jobs/${j.id}/retry`, { method: "POST", headers: s.ada.headers })
    expect(res.status).toBe(200)
    await s.engine.settled(inst(j, 2))
    expect((await job(s, j.id)).status).toBe("complete")
    expect(built).toEqual(["comparison-table"])
    st = await state(s)
    expect(liveViews(st).map((v) => [v.viewType, v.status])).toEqual([
      ["outline", "ready"],
      ["comparison-table", "ready"],
    ])
    expect(st.views[table.id]!.failReason).toBeUndefined()
    expect((await changes(s)).filter((l) => l.startsWith("Found"))).toHaveLength(1)
  })

  it("pauses at the spending cap, and Continue (a Retry) picks up where it stopped", async () => {
    // $4/M in, $20/M out: each call costs 0.1 × 4 + 0.01 × 20 = $0.60.
    const s = await setup({ usage: { input: 100_000, output: 10_000 } })
    const j = await start(s, { views: VIEWS, capUsd: 2 })
    await s.engine.settled(inst(j))
    const paused = await job(s, j.id)
    expect(paused.status).toBe("failed")
    expect(isCapPause(paused.error)).toBe(true)
    expect(paused.error).toMatch(/^Paused at the spending cap: \$2\.\d\d of \$2\.00/)
    const res = await s.app.request(`/api/jobs/${j.id}/retry`, { method: "POST", headers: s.ada.headers })
    expect(res.status).toBe(200)
    await s.engine.settled(inst(j, 2))
    // A new attempt gets the cap again; it may pause again, but never duplicates.
    const st = await state(s)
    expect(liveViews(st)).toHaveLength(2)
    expect((await changes(s)).filter((l) => l.startsWith("Found"))).toHaveLength(1)
  })

  it("builds the create flow's queued Views into their own rows (POST /build)", async () => {
    const s = await setup()
    const plan = await s.app.request(`/api/expeditions/${s.exp}/plan`, {
      method: "PUT",
      headers: s.ada.headers,
      body: JSON.stringify({ title: "Which printer?", views: VIEWS }),
    })
    expect(plan.status).toBe(200)
    const queued = liveViews(await state(s)).map((v) => v.id)
    expect(queued).toHaveLength(2)
    const res = await s.app.request(`/api/expeditions/${s.exp}/build`, {
      method: "POST",
      headers: s.ada.headers,
      body: JSON.stringify({ goals: ["decide"] }),
    })
    expect(res.status).toBe(202)
    const { jobId } = (await res.json()) as { jobId: string }
    await s.engine.settled(instanceId({ jobId, attempt: 1 }))
    expect((await job(s, jobId)).status).toBe("complete")
    const st = await state(s)
    expect(liveViews(st).map((v) => [v.id, v.status])).toEqual(queued.map((id) => [id, "ready"]))
    expect(st.expedition.status).toBe("ready")
    const labels = await changes(s)
    expect(labels).toContain("Started the build")
    expect(labels.some((l) => l.startsWith("Queued"))).toBe(false)
    expect(s.model.turns[0]!.user).toContain("The reader's goals: decide.")
  })

  it("builds the Concept set chunk by chunk when the Sources don't fit, then merges", async () => {
    const s = await setup({ curator: { wholeSourceMaxTokens: 10, chunkTokens: 40 } })
    const j = await start(s, { views: [VIEWS[0]], capUsd: 50 })
    await s.engine.settled(inst(j))
    expect((await job(s, j.id)).status).toBe("complete")
    const recorded = s.engine.recorded(inst(j))
    const chunkSteps = recorded.filter((n) => n.startsWith("concepts: chunk"))
    expect(chunkSteps.length).toBeGreaterThan(1)
    expect(recorded).toContain("concepts: merge")
    const st = await state(s)
    // Each chunk made "Orbit P2" and "Kite" again; the merge folded them.
    const titles = Object.values(st.concepts).filter(isLive).map((c) => c.title).sort()
    expect(titles).toEqual(["Choosing a printer", "Kite", "Orbit P2"])
    expect((await changes(s)).filter((l) => l.startsWith("Found"))).toEqual(["Found 3 Concepts in 1 Source"])
  })
})
