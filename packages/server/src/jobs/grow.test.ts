// Grow asks (spec §5.5, WP-4.4) end to end on the in-process engine and
// PGlite, with a scripted model: the ask writes only to its one Proposal
// (never a Change), items stream as the agent works (room pokes, and the
// asker's `data-proposal` stream), the per-ask cap pauses it with what
// streamed kept and Continue picks up from there, Stop keeps what streamed,
// and Activity lists asks with who asked.
import { scriptedModel, type ScriptTurn } from "@seply/ai/testing"
import { isLive, schema, type BuildEvent, type DomainState, type ProposalView } from "@seply/domain"
import { asc, eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { AskStreamPart, AskView } from "../asks.ts"
import { memoryBlobStore } from "../blobs.ts"
import type { Db } from "../db.ts"
import { loadState } from "../projection.ts"
import type { Relay } from "../relay.ts"
import { signUp, testApp, testDb, TEST_ENV, type TestUser } from "../test-harness.ts"
import { scriptOf } from "./grow.ts"
import { createInlineEngine, type InlineEngine } from "./inline.ts"
import { JOB_KINDS } from "./registry.ts"
import { createJobRunner } from "./runner.ts"
import { instanceId, type Job, type JobServices } from "./types.ts"

const COMPUTE = readFileSync(new URL("../../../domain/fixtures/compute.json", import.meta.url), "utf8")

const concept = (title: string, extra: object = {}) => ({
  title,
  kind: "builtin:idea",
  summary: `${title}, in one line.`,
  overview: `${title} is explained here in one paragraph, for a reader who knows LoRA.`,
  tags: ["technique"],
  prov: [],
  ...extra,
})

/** "What would I need to understand QLoRA?": two Concepts, then their links. */
const QLORA = scriptOf({
  steps: [
    { calls: [{ tool: "search_existing", input: { query: "quantization" } }] },
    { calls: [{ tool: "concept_create", input: concept("NormalFloat (NF4)") }] },
    { calls: [{ tool: "concept_create", input: concept("Paged optimizers") }] },
    {
      calls: [
        { tool: "relationship_add", input: { from: "@0", type: "builtin:part-of", to: "=QLoRA" } },
        { tool: "relationship_add", input: { from: "@1", type: "builtin:part-of", to: "=QLoRA" } },
        { tool: "relationship_add", input: { from: "=Weight quantization", type: "builtin:prerequisite", to: "=QLoRA" } },
      ],
    },
    { text: "Added NF4 and paged optimizers, and linked weight quantization." },
  ],
})

type Setup = {
  db: Db
  app: ReturnType<typeof testApp>
  engine: InlineEngine
  events: BuildEvent[]
  pokes: number
  ada: TestUser
  exp: string
  script: { current: (t: ScriptTurn) => unknown }
  model: ReturnType<typeof scriptedModel>
}

async function setup(opts: { usage?: { input: number; output: number } } = {}): Promise<Setup> {
  const db = await testDb()
  const events: BuildEvent[] = []
  const s = { pokes: 0 }
  const relay: Relay = {
    published: () => {},
    build: (_e, evt) => void events.push(evt),
    poke: () => void s.pokes++,
  }
  const script = { current: QLORA as (t: ScriptTurn) => unknown }
  const model = scriptedModel((t) => script.current(t) as never, { usage: opts.usage })
  const blobs = memoryBlobStore()
  const services: JobServices = { blobs, model: () => model }
  const deps = { connect: async () => ({ db, close: async () => {} }), relay, services }
  const engine = createInlineEngine({ deps, registry: JOB_KINDS })
  const jobs = createJobRunner({ engine, registry: JOB_KINDS, relay })
  const app = testApp(TEST_ENV, db, relay, { jobs, blobs })
  const ada = await signUp(app, "ada")
  const imported = await app.request("/api/import", { method: "POST", headers: ada.headers, body: COMPUTE })
  expect(imported.status).toBe(201)
  const { expedition } = (await imported.json()) as { expedition: { id: string } }
  return {
    db,
    app,
    engine,
    events,
    get pokes() {
      return s.pokes
    },
    ada,
    exp: expedition.id,
    script,
    model,
  }
}

async function ask(s: Setup, input: unknown, user = s.ada): Promise<Job> {
  const res = await s.app.request(`/api/expeditions/${s.exp}/jobs`, {
    method: "POST",
    headers: user.headers,
    body: JSON.stringify({ kind: "grow", input }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { job: Job }).job
}

async function job(s: Setup, id: string): Promise<Job> {
  const res = await s.app.request(`/api/jobs/${id}`, { headers: s.ada.headers })
  return ((await res.json()) as { job: Job }).job
}

const state = async (s: Setup): Promise<DomainState> => (await loadState(s.db, s.exp))!
const titleId = (st: DomainState, title: string) =>
  Object.values(st.concepts).find((c) => c.title === title)!.id
const changeCount = async (s: Setup) =>
  (await s.db.select().from(schema.changes).where(eq(schema.changes.expeditionId, s.exp))).length
const items = (s: Setup, proposalId: string) =>
  s.db
    .select()
    .from(schema.proposalItems)
    .where(eq(schema.proposalItems.proposalId, proposalId))
    .orderBy(asc(schema.proposalItems.position))
const inst = (j: Job, attempt = 1) => instanceId({ jobId: j.id, attempt })
const titles = (rows: { ops: { kind: string; value?: unknown }[] }[]) =>
  rows.flatMap((r) => r.ops.filter((o) => o.kind === "concept.create").map((o) => (o.value as { title: string }).title))

/** Reads an SSE body into its UI message stream parts. */
async function parts(res: Response): Promise<(AskStreamPart | "[DONE]")[]> {
  const text = await res.text()
  return text
    .split("\n\n")
    .map((b) => b.split("\n").find((l) => l.startsWith("data: "))?.slice(6))
    .filter((d): d is string => !!d)
    .map((d) => (d === "[DONE]" ? "[DONE]" : (JSON.parse(d) as AskStreamPart)))
}

describe("the grow job", () => {
  it("writes the ask into one Proposal, item by item, and never into the Expedition", async () => {
    const s = await setup()
    const before = await state(s)
    const changes = await changeCount(s)
    const j = await ask(s, { ask: "What would I need to understand QLoRA?" })
    await s.engine.settled(inst(j))
    expect(await job(s, j.id)).toMatchObject({ status: "complete" })

    // The Expedition is as it was: no Change, no new Concepts or Relationships.
    expect(await changeCount(s)).toBe(changes)
    const after = await state(s)
    expect(Object.keys(after.concepts)).toEqual(Object.keys(before.concepts))
    expect(Object.keys(after.relationships)).toEqual(Object.keys(before.relationships))

    // One Proposal, the job's id, the ask as its rationale.
    const proposals = await s.db.select().from(schema.proposals).where(eq(schema.proposals.expeditionId, s.exp))
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({
      id: j.id,
      author: s.ada.id,
      origin: "ai",
      status: "pending",
      rationale: "What would I need to understand QLoRA?",
    })
    // One item per Concept (summary and overview in its create), one per Relationship.
    const rows = await items(s, j.id)
    expect(rows.map((r) => r.ops.map((o) => o.kind))).toEqual([
      ["concept.create"],
      ["concept.create"],
      ["relationship.add"],
      ["relationship.add"],
      ["relationship.add"],
    ])
    expect(titles(rows)).toEqual(["NormalFloat (NF4)", "Paged optimizers"])
    expect(rows[0]!.ops[0]).toMatchObject({ value: { summary: "NormalFloat (NF4), in one line.", overview: expect.stringContaining("one paragraph") } })
    const qlora = titleId(before, "QLoRA")
    expect(rows[4]!.ops[0]!.target).toBe(`${titleId(before, "Weight quantization")}|builtin:prerequisite|${qlora}`)

    // Streamed: one write (and one poke) per step that suggested something.
    expect(s.pokes).toBeGreaterThanOrEqual(3)
    const steps = s.events.filter((e) => e.jobId === j.id).map((e) => e.step)
    expect(steps).toContain("Suggested 1 change so far")
    expect(steps).toContain("Suggested 5 changes so far")

    // Accepting them all applies them as one Change.
    const review = await s.app.request(`/api/expeditions/${s.exp}/proposals/review`, {
      method: "POST",
      headers: s.ada.headers,
      body: JSON.stringify({ accept: rows.map((r) => r.id) }),
    })
    expect(review.status).toBe(200)
    expect(await changeCount(s)).toBe(changes + 1)
    const accepted = await state(s)
    expect(isLive(accepted.relationships[rows[4]!.ops[0]!.target])).toBe(true)
    expect(Object.values(accepted.concepts).find((c) => c.title === "Paged optimizers")?.overview).toBeTruthy()
  })

  it("streams the ask to the asker as data-proposal parts", async () => {
    const s = await setup()
    s.script.current = scriptOf({
      delayMs: 800,
      steps: [
        { calls: [{ tool: "concept_create", input: concept("NormalFloat (NF4)") }] },
        { calls: [{ tool: "relationship_add", input: { from: "@0", type: "builtin:part-of", to: "=QLoRA" } }] },
        { text: "Done." },
      ],
    })
    const qlora = titleId(await state(s), "QLoRA")
    const j = await ask(s, { action: "missing", conceptId: qlora })
    const res = await s.app.request(`/api/expeditions/${s.exp}/asks/${j.id}/stream`, { headers: s.ada.headers })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expect(res.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1")
    const got = await parts(res)
    expect(got[0]).toEqual({ type: "start", messageId: j.id })
    expect(got.slice(-2)).toEqual([{ type: "finish" }, "[DONE]"])

    const proposals = got.filter((p): p is Extract<AskStreamPart, { type: "data-proposal" }> => p !== "[DONE]" && p.type === "data-proposal")
    expect(proposals.every((p) => p.id === j.id)).toBe(true)
    // Items arrive while it works: a part with the Concept alone, then with its link.
    const counts = proposals.map((p) => p.data.items.length)
    expect(counts).toContain(1)
    expect(counts.at(-1)).toBe(2)
    const last: ProposalView = proposals.at(-1)!.data
    expect(last).toMatchObject({ rationale: "Add what's missing to understand QLoRA", origin: "ai" })
    const asks = got.filter((p) => p !== "[DONE]" && p.type === "data-ask") as Extract<AskStreamPart, { type: "data-ask" }>[]
    expect(asks.at(-1)!.data.status).toBe("complete")

    // A viewer can't open it; an ask of another Expedition isn't there.
    const vic = await signUp(s.app, "vic")
    await s.db.insert(schema.collaborators).values({ expeditionId: s.exp, userId: vic.id, role: "viewer" })
    expect((await s.app.request(`/api/expeditions/${s.exp}/asks/${j.id}/stream`, { headers: vic.headers })).status).toBe(403)
    expect((await s.app.request(`/api/expeditions/${s.exp}/asks/nope/stream`, { headers: s.ada.headers })).status).toBe(404)
  })

  it("pauses at the per-ask cap with what streamed kept; Continue carries on without repeating it", async () => {
    // $0.60 a call on Opus prices: over the $0.50 cap after the first.
    const s = await setup({ usage: { input: 100_000, output: 10_000 } })
    s.script.current = (t: ScriptTurn) => {
      const resumed = t.user.includes("## Already suggested")
      if (t.step === 0)
        return { calls: [{ tool: "concept_create", input: concept(resumed ? "Paged optimizers" : "NormalFloat (NF4)") }] }
      return { text: "Done." }
    }
    const j = await ask(s, { ask: "What would I need to understand QLoRA?" })
    await s.engine.settled(inst(j))
    const paused = await job(s, j.id)
    expect(paused).toMatchObject({ status: "paused" })
    expect(paused.error).toMatch(/Spent \$0\.60 of the \$0\.50 cap/)
    expect(titles(await items(s, j.id))).toEqual(["NormalFloat (NF4)"])

    const res = await s.app.request(`/api/jobs/${j.id}/continue`, { method: "POST", headers: s.ada.headers })
    expect(res.status).toBe(200)
    await s.engine.settled(inst(j, 2))
    // The resumed agent saw NF4 in its state and was told it's already suggested.
    const resumedTurn = s.model.turns.find((t) => t.user.includes("## Already suggested"))!
    expect(resumedTurn.user).toContain("NormalFloat (NF4)")
    expect(titles(await items(s, j.id))).toEqual(["NormalFloat (NF4)", "Paged optimizers"])
  })

  it("stops when the asker stops it, keeping what already streamed", async () => {
    const s = await setup()
    s.script.current = scriptOf({
      delayMs: 150,
      steps: Array.from({ length: 12 }, (_, i) => ({
        calls: [{ tool: "concept_create", input: concept(`Idea ${i}`) }],
      })),
    })
    const j = await ask(s, { ask: "Add a lot" })
    for (let i = 0; i < 100 && (await items(s, j.id)).length < 2; i++)
      await new Promise((r) => setTimeout(r, 30))
    const stopped = await s.app.request(`/api/jobs/${j.id}/cancel`, { method: "POST", headers: s.ada.headers })
    expect(stopped.status).toBe(200)
    await new Promise((r) => setTimeout(r, 600))
    const kept = (await items(s, j.id)).length
    expect(kept).toBeGreaterThanOrEqual(2)
    expect(kept).toBeLessThan(12)
    expect(await job(s, j.id)).toMatchObject({ status: "cancelled" })
    // Nothing more arrives after Stop.
    await new Promise((r) => setTimeout(r, 600))
    expect((await items(s, j.id)).length).toBe(kept)
  })

  it("fails with the agent's reason when there is nothing to suggest, and refuses what isn't an ask", async () => {
    const s = await setup()
    s.script.current = () => ({ text: "QLoRA already has everything it needs here." })
    const j = await ask(s, { ask: "Anything missing about QLoRA?" })
    await s.engine.settled(inst(j))
    expect(await job(s, j.id)).toMatchObject({
      status: "failed",
      error: "Nothing to suggest: QLoRA already has everything it needs here.",
    })

    const bad = (input: unknown) =>
      s.app.request(`/api/expeditions/${s.exp}/jobs`, {
        method: "POST",
        headers: s.ada.headers,
        body: JSON.stringify({ kind: "grow", input }),
      })
    expect((await bad({})).status).toBe(400)
    expect((await bad({ action: "examples" })).status).toBe(400)
    const gone = await ask(s, { action: "examples", conceptId: "nope" })
    await s.engine.settled(inst(gone))
    expect(await job(s, gone.id)).toMatchObject({ status: "failed", error: "That Concept is gone" })
  })

  it("lists asks in Activity, with who asked and what came of them", async () => {
    const s = await setup()
    const j = await ask(s, { ask: "What would I need to understand QLoRA?" })
    await s.engine.settled(inst(j))
    const res = await s.app.request(`/api/expeditions/${s.exp}/asks`, { headers: s.ada.headers })
    expect(res.status).toBe(200)
    const { asks } = (await res.json()) as { asks: AskView[] }
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({
      jobId: j.id,
      kind: "grow",
      rationale: "What would I need to understand QLoRA?",
      author: { id: s.ada.id, name: "ada" },
      status: "complete",
      items: { pending: 5, accepted: 0, dismissed: 0 },
    })
    const vic = await signUp(s.app, "vic")
    expect((await s.app.request(`/api/expeditions/${s.exp}/asks`, { headers: vic.headers })).status).toBe(404)
    await s.db.insert(schema.collaborators).values({ expeditionId: s.exp, userId: vic.id, role: "viewer" })
    expect((await s.app.request(`/api/expeditions/${s.exp}/asks`, { headers: vic.headers })).status).toBe(403)
  })
})
