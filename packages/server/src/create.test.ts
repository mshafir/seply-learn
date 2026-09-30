// The create flow's routes over PGlite and a memory blob store: the draft,
// the skim (the model stubbed behind an OpenAI-compatible instance endpoint),
// saving the chosen Views, removing a Source, and the build hand-off.
import { schema, type LoggedOp } from "@seply/domain"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { memoryBlobStore } from "./blobs.ts"
import type { Draft } from "./create.ts"
import { loadState } from "./projection.ts"
import type { Relay } from "./relay.ts"
import { signUp, TEST_ENV, testApp, testDb, type TestUser } from "./test-harness.ts"

const ENV = {
  ...TEST_ENV,
  OPENAI_COMPATIBLE_BASE_URL: "http://model.test/v1",
  AI_MODEL_SKIM: "fast",
  AI_MODEL_CURATOR: "strong",
  AI_MODEL_WRITER: "mid",
}

const CHAT = [
  "You said:",
  "What is a starter, and why does my bread come out dense?",
  "ChatGPT said:",
  "A starter is a culture of wild yeast and bacteria. Dense bread usually means under-fermentation.",
  "You said:",
  "Back up: what is gluten?",
  "ChatGPT said:",
  "Gluten is the protein network that traps gas.",
].join("\n")

const answer = {
  title: "Sourdough basics",
  summary: "How a loaf rises and why it can come out dense.",
  views: [
    { id: "v-path", viewType: "learning-path", label: "Path to a good loaf", question: "What do I need to understand first?", why: "You asked 'what is' twice", on: true, confidence: "high" },
    { id: "v-parts", viewType: "anatomy", label: "What's in a loaf", question: "What is a loaf made of?", why: "Starter, gluten, gas", on: true, confidence: "high" },
    { id: "v-stages", viewType: "outline", label: "The stages", question: "What are the stages of a bake?", why: "The chat walks through them", on: true, confidence: "medium" },
    { id: "v-dense", viewType: "cause-and-effect", label: "Why it's dense", question: "What makes a loaf dense?", why: "Your first question", on: false, confidence: "medium" },
    { id: "v-nope", viewType: "funnel", label: "Nope", question: "Not a View Type", why: "", on: false, confidence: "medium" },
  ],
}

/** An OpenAI-compatible endpoint that answers every chat completion with `content`. */
function fakeModel(content: () => unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) })
    return new Response(
      JSON.stringify({
        id: "c1",
        object: "chat.completion",
        created: 0,
        model: "fast",
        choices: [
          { index: 0, message: { role: "assistant", content: JSON.stringify(content()) }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 3000, completion_tokens: 400, total_tokens: 3400 },
      }),
      { headers: { "content-type": "application/json" } }
    )
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

async function setup(opts: { env?: typeof ENV; content?: () => unknown; relay?: Relay } = {}) {
  const db = await testDb()
  const blobs = memoryBlobStore()
  const model = fakeModel(opts.content ?? (() => answer))
  const app = testApp(opts.env ?? ENV, db, opts.relay, { blobs, ai: { fetch: model.fetch } })
  const ada = await signUp(app, "ada")
  const created = await app.request("/api/expeditions", { method: "POST", headers: ada.headers, body: "{}" })
  const { id } = (await created.json()) as { id: string }
  const call = (user: TestUser, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: user.headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const paste = (text = CHAT, user = ada) =>
    call(user, "POST", `/api/sources/${id}`, { type: "paste", text, title: "Sourdough chat" })
  const draft = async (user = ada) => (await (await call(user, "GET", `/api/expeditions/${id}/draft`)).json()) as Draft
  return { db, app, ada, id, call, paste, draft, model }
}

describe("GET /expeditions/:id/draft", () => {
  it("lists the Sources with their size, and the counts", async () => {
    const { paste, draft, call, id, ada } = await setup()
    expect((await draft()).sources).toEqual([])
    await paste()
    await call(ada, "POST", `/api/sources/${id}`, { type: "prompt", text: "How do I bake a lighter loaf?" })
    const d = await draft()
    expect(d.expedition).toMatchObject({ id, status: "draft", role: "owner", title: "" })
    expect(d.sources).toHaveLength(2)
    expect(d.sources[0]).toMatchObject({ kind: "chat", title: "Sourdough chat", segments: { kind: "chat", count: 4 } })
    expect(d.sources[0]!.segments!.chars).toBeGreaterThan(100)
    expect(d.sources[1]).toMatchObject({ kind: "prompt", segments: { count: 1 } })
    expect(d.counts).toEqual({ concepts: 0, sources: 2 })
  })

  it("is 404 for a stranger", async () => {
    const { app, call, id } = await setup()
    const bob = await signUp(app, "bob")
    expect((await call(bob, "GET", `/api/expeditions/${id}/draft`)).status).toBe(404)
  })
})

describe("POST /expeditions/:id/skim", () => {
  it("proposes ranked Views from a sample of the Sources", async () => {
    const { paste, call, ada, id, model } = await setup()
    await paste()
    const res = await call(ada, "POST", `/api/expeditions/${id}/skim`, { goals: ["learn"] })
    expect(res.status).toBe(200)
    const out = (await res.json()) as {
      skim: { title: string; views: { id: string; viewType: string; on: boolean }[] }
      run: { ms: number; usd: number; model: string }
    }
    expect(out.skim.title).toBe("Sourdough basics")
    // A View Type outside the catalog ("funnel", a candidate) is dropped.
    expect(out.skim.views.map((v) => v.viewType)).toEqual(["learning-path", "anatomy", "outline", "cause-and-effect"])
    expect(out.skim.views.filter((v) => v.on)).toHaveLength(3)
    expect(out.run.model).toBe("fast")
    expect(out.run.usd).toBeGreaterThan(0)
    const sent = JSON.stringify(model.calls.at(-1)!.body)
    expect(model.calls.at(-1)!.url).toBe("http://model.test/v1/chat/completions")
    expect(sent).toContain("[t1 reader]")
    expect(sent).toContain("learn it")
    expect(sent).toContain("### learning-path: Learning path")
  })

  it("asks for one specific View, and for more without repeats", async () => {
    const { paste, call, ada, id, model } = await setup({ content: () => ({ ...answer, views: answer.views.slice(0, 4) }) })
    await paste()
    const ask = await call(ada, "POST", `/api/expeditions/${id}/skim`, {
      mode: "ask",
      request: "a timeline of a bake day",
      takenIds: ["v-path"],
    })
    const one = (await ask.json()) as { skim: { views: { id: string; on: boolean }[] } }
    expect(one.skim.views).toEqual([expect.objectContaining({ id: "v-path-2", on: true })])
    expect(JSON.stringify(model.calls.at(-1)!.body)).toContain("a timeline of a bake day")

    const more = await call(ada, "POST", `/api/expeditions/${id}/skim`, {
      mode: "more",
      existing: [{ viewType: "learning-path", question: "What do I need to understand first?" }],
    })
    const m = (await more.json()) as { skim: { views: { viewType: string; on: boolean }[] } }
    expect(m.skim.views.map((v) => v.viewType)).toEqual(["anatomy", "outline", "cause-and-effect"])
    expect(m.skim.views.every((v) => !v.on)).toBe(true)
    expect((await call(ada, "POST", `/api/expeditions/${id}/skim`, { mode: "ask" })).status).toBe(400)
  })

  it("needs a Source, an AI setup and an editor; a failed model is a 502", async () => {
    const noSources = await setup()
    expect((await noSources.call(noSources.ada, "POST", `/api/expeditions/${noSources.id}/skim`, {})).status).toBe(400)

    const noAi = await setup({ env: { ...TEST_ENV } as typeof ENV })
    await noAi.paste()
    const r = await noAi.call(noAi.ada, "POST", `/api/expeditions/${noAi.id}/skim`, {})
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: "not-configured" })

    const broken = await setup({ content: () => ({ nope: true }) })
    await broken.paste()
    const b = await broken.call(broken.ada, "POST", `/api/expeditions/${broken.id}/skim`, {})
    expect(b.status).toBe(502)
    expect(await b.json()).toMatchObject({ error: "skim-failed" })

    const { app, db, call, paste, id } = await setup()
    await paste()
    const bob = await signUp(app, "bob")
    expect((await call(bob, "POST", `/api/expeditions/${id}/skim`, {})).status).toBe(404)
    await db.insert(schema.collaborators).values({ expeditionId: id, userId: bob.id, role: "viewer" })
    expect((await call(bob, "POST", `/api/expeditions/${id}/skim`, {})).status).toBe(403)
  })
})

describe("PUT /expeditions/:id/plan", () => {
  const plan = {
    title: "Sourdough basics",
    summary: "How a loaf rises.",
    views: [
      { viewType: "learning-path", label: "Path to a good loaf", question: "What do I need to understand first?" },
      { viewType: "quadrant", label: "Flours", question: "Where does each flour sit?" },
      { viewType: "outline", label: "The stages", question: "What are the stages?" },
    ],
  }

  it("saves the title and the chosen Views, queued, as one Change; the first is the best View", async () => {
    const published: LoggedOp[][] = []
    const relay: Relay = { published: (_id, ops) => void published.push([...ops]) }
    const { call, ada, id, db, paste } = await setup({ relay })
    await paste()
    const res = await call(ada, "PUT", `/api/expeditions/${id}/plan`, plan)
    expect(res.status).toBe(200)
    const d = (await res.json()) as Draft
    expect(d.expedition).toMatchObject({ title: "Sourdough basics", summary: "How a loaf rises.", status: "draft" })
    expect(d.views.map((v) => [v.viewType, v.label, v.status])).toEqual([
      ["learning-path", "Path to a good loaf", "queued"],
      ["quadrant", "Flours", "queued"],
      ["outline", "The stages", "queued"],
    ])
    expect(d.expedition.bestViewId).toBe(d.views[0]!.id)
    const changes = await db.select().from(schema.changes).where(eq(schema.changes.expeditionId, id))
    expect(changes.map((c) => c.label)).toContain("Chose 3 Views")
    expect(published.at(-1)!.map((o) => o.kind)).toContain("view.create")
    const state = (await loadState(db, id))!
    expect(state.views[d.views[1]!.id]!.settings).toEqual({ x: "unset", y: "unset" })
  })

  it("re-saving keeps, relabels, reorders and removes queued Views; nothing changed logs nothing", async () => {
    const { call, ada, id, db } = await setup()
    const first = (await (await call(ada, "PUT", `/api/expeditions/${id}/plan`, plan)).json()) as Draft
    const [path, quad, outline] = first.views
    const again = await call(ada, "PUT", `/api/expeditions/${id}/plan`, {
      title: "Sourdough basics",
      views: [
        { id: outline!.id, viewType: "outline", label: "Stages", question: "What are the stages?" },
        { id: path!.id, viewType: "learning-path", label: "Path to a good loaf", question: "What do I need to understand first?" },
        { viewType: "timeline", label: "Bake day", question: "When does each step happen?" },
      ],
    })
    const d = (await again.json()) as Draft
    expect(d.views.map((v) => v.label)).toEqual(["Stages", "Path to a good loaf", "Bake day"])
    expect(d.views.map((v) => v.id).slice(0, 2)).toEqual([outline!.id, path!.id])
    expect(d.views.some((v) => v.id === quad!.id)).toBe(false)
    expect(d.expedition.bestViewId).toBe(outline!.id)

    const before = (await db.select().from(schema.changes).where(eq(schema.changes.expeditionId, id))).length
    await call(ada, "PUT", `/api/expeditions/${id}/plan`, {
      title: "Sourdough basics",
      views: d.views.map((v) => ({ id: v.id, viewType: v.viewType, label: v.label, question: v.question })),
    })
    const after = (await db.select().from(schema.changes).where(eq(schema.changes.expeditionId, id))).length
    expect(after).toBe(before)
  })

  it("refuses a View that isn't a queued View of this draft, viewers, and built Expeditions", async () => {
    const { call, ada, id, app, db } = await setup()
    const bad = await call(ada, "PUT", `/api/expeditions/${id}/plan`, {
      title: "x",
      views: [{ id: "someone-elses", viewType: "outline", label: "x", question: "y" }],
    })
    expect(bad.status).toBe(400)
    expect((await call(ada, "PUT", `/api/expeditions/${id}/plan`, { title: "", views: [] })).status).toBe(400)
    const bob = await signUp(app, "bob")
    await db.insert(schema.collaborators).values({ expeditionId: id, userId: bob.id, role: "viewer" })
    expect((await call(bob, "PUT", `/api/expeditions/${id}/plan`, plan)).status).toBe(403)
    await db.update(schema.expeditions).set({ status: "ready" }).where(eq(schema.expeditions.id, id))
    expect((await call(ada, "PUT", `/api/expeditions/${id}/plan`, plan)).status).toBe(409)
  })
})

describe("DELETE /sources/:exp/:source", () => {
  it("removes a Source as its own Change; viewers can't", async () => {
    const { call, ada, id, paste, draft, app, db } = await setup()
    const added = (await (await paste()).json()) as { source: { id: string } }
    const bob = await signUp(app, "bob")
    await db.insert(schema.collaborators).values({ expeditionId: id, userId: bob.id, role: "viewer" })
    expect((await call(bob, "DELETE", `/api/sources/${id}/${added.source.id}`)).status).toBe(403)
    expect((await call(ada, "DELETE", `/api/sources/${id}/${added.source.id}`)).status).toBe(204)
    expect((await draft()).sources).toEqual([])
    expect((await call(ada, "DELETE", `/api/sources/${id}/${added.source.id}`)).status).toBe(404)
    const changes = await db.select().from(schema.changes).where(eq(schema.changes.expeditionId, id))
    expect(changes.map((c) => c.label)).toContain("Removed the Source “Sourdough chat”")
  })
})

describe("POST /expeditions/:id/build (the hand-off to WP-3.5b)", () => {
  it("needs Sources and queued Views, then answers 501 until the build exists", async () => {
    const { call, ada, id, paste } = await setup()
    expect((await call(ada, "POST", `/api/expeditions/${id}/build`, {})).status).toBe(409)
    await paste()
    await call(ada, "PUT", `/api/expeditions/${id}/plan`, {
      title: "Sourdough",
      views: [{ viewType: "outline", label: "Stages", question: "What are the stages?" }],
    })
    const res = await call(ada, "POST", `/api/expeditions/${id}/build`, { goals: ["learn"] })
    expect(res.status).toBe(501)
    expect(await res.json()).toMatchObject({ error: "build-unavailable" })
  })
})
