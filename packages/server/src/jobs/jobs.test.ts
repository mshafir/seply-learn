// Jobs over the in-process engine (same step semantics as Workflows) and a
// real migrated database: the fake job's steps, retries, a simulated
// restart, cancel and retry, the room events and the notification.
import { isLive, schema, type BuildEvent, type LoggedOp } from "@seply/domain"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import type { Db } from "../db.ts"
import { loadState } from "../projection.ts"
import type { Relay, RoomJoin } from "../relay.ts"
import {
  signUp,
  testApp,
  testDb,
  TEST_ENV,
  type TestUser,
} from "../test-harness.ts"
import { fakeViewLabel } from "./fake.ts"
import { createInlineEngine, type InlineEngine } from "./inline.ts"
import { JOB_KINDS } from "./registry.ts"
import { createJobRunner } from "./runner.ts"
import { instanceId, type Job, type JobNotification } from "./types.ts"

type Setup = {
  db: Db
  app: ReturnType<typeof testApp>
  engine: InlineEngine
  events: BuildEvent[]
  published: LoggedOp[][]
  notes: { userId: string; note: JobNotification }[]
  joins: RoomJoin[]
  ada: TestUser
  exp: string
}

async function setup(): Promise<Setup> {
  const db = await testDb()
  const events: BuildEvent[] = []
  const published: LoggedOp[][] = []
  const notes: Setup["notes"] = []
  const joins: RoomJoin[] = []
  const relay: Relay = {
    published: (_e, batch) => void published.push([...batch]),
    build: (_e, evt) => void events.push(evt),
    handleUpgrade: (_req, join) => {
      joins.push(join)
      return new Response("upgraded")
    },
  }
  const deps = {
    connect: async () => ({ db, close: async () => {} }),
    relay,
    notify: async (_db: Db, userId: string, note: JobNotification) => {
      notes.push({ userId, note })
    },
  }
  const engine = createInlineEngine({ deps, registry: JOB_KINDS })
  const jobs = createJobRunner({ engine, registry: JOB_KINDS, relay })
  const app = testApp(TEST_ENV, db, relay, undefined, { jobs })
  const ada = await signUp(app, "ada")
  const created = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id: exp } = (await created.json()) as { id: string }
  return { db, app, engine, events, published, notes, joins, ada, exp }
}

async function start(s: Setup, input: unknown, who = s.ada) {
  const res = await s.app.request(`/api/expeditions/${s.exp}/jobs`, {
    method: "POST",
    headers: who.headers,
    body: JSON.stringify({ kind: "fake", input }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { job: Job }).job
}

async function getJob(s: Setup, id: string) {
  const res = await s.app.request(`/api/jobs/${id}`, { headers: s.ada.headers })
  expect(res.status).toBe(200)
  return ((await res.json()) as { job: Job }).job
}

const liveViews = async (s: Setup) => {
  const state = await loadState(s.db, s.exp)
  return Object.values(state!.views)
    .filter(isLive)
    .sort((a, b) => a.label.localeCompare(b.label))
}

const changeLabels = async (s: Setup) =>
  (
    await s.db
      .select({ label: schema.changes.label, origin: schema.changes.origin })
      .from(schema.changes)
      .where(eq(schema.changes.expeditionId, s.exp))
      .orderBy(schema.changes.firstSeq)
  ).map((c) => `${c.origin}: ${c.label}`)

async function until(check: () => boolean, ms = 5_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe("the fake job on the inline engine", () => {
  let s: Setup
  beforeEach(async () => {
    s = await setup()
  })

  it("builds each View as its own Change and survives a forced step failure", async () => {
    const job = await start(s, { views: 3, failOnce: [2] })
    expect(job).toMatchObject({ kind: "fake", status: "queued", attempt: 1 })
    await s.engine.settled(instanceId({ jobId: job.id, attempt: 1 }))

    expect(await getJob(s, job.id)).toMatchObject({
      status: "complete",
      progress: 1,
      step: "Done",
      error: null,
    })
    const views = await liveViews(s)
    expect(views.map((v) => [v.label, v.status])).toEqual([
      [fakeViewLabel(1), "ready"],
      [fakeViewLabel(2), "ready"],
      [fakeViewLabel(3), "ready"],
    ])
    // One Change per commit, authored by whoever started it, origin build.
    expect(await changeLabels(s)).toEqual([
      "human: Created the Expedition",
      "build: Queued the test Views",
      "build: Built Test View 1",
      "build: Built Test View 2",
      "build: Built Test View 3",
    ])
    // Each commit told the relay (after the Expedition's own first Change).
    expect(s.published).toHaveLength(5)

    // The room saw the job queued, running, each View build and the end.
    const jobLevel = s.events.filter((e) => !e.viewId).map((e) => e.status)
    expect(jobLevel[0]).toBe("queued")
    expect(jobLevel.at(-1)).toBe("complete")
    const v2 = views[1]!.id
    expect(
      s.events.filter((e) => e.viewId === v2).map((e) => e.status)
    ).toEqual(["building", "ready"])
    const building = s.events.find((e) => e.viewId === v2)!
    expect(building.previewNodes).toHaveLength(2)
    expect(s.events.every((e) => e.jobId === job.id && e.kind === "fake")).toBe(
      true
    )

    expect(s.notes).toEqual([
      {
        userId: s.ada.id,
        note: {
          title: "Test build finished",
          body: "Every test View is ready.",
          url: `/e/${s.exp}`,
          tag: `job-${job.id}`,
        },
      },
    ])
  })

  it("resumes after a restart from its last recorded step, logging nothing twice", async () => {
    const job = await start(s, { views: 3, stepMs: 30 })
    const id = instanceId({ jobId: job.id, attempt: 1 })
    await until(() => s.engine.recorded(id).includes("commit View 1 (commit)"))

    s.engine.crash()
    await s.engine.settled(id)
    const recorded = s.engine.recorded(id)
    expect(await getJob(s, job.id)).toMatchObject({ status: "running" })

    // Nothing moves until the runtime wakes it (wrangler dev after a restart).
    await new Promise((r) => setTimeout(r, 100))
    expect(s.engine.recorded(id)).toEqual(recorded)

    const runner = createJobRunner({
      engine: s.engine,
      registry: JOB_KINDS,
      relay: { published() {} },
    })
    expect(await runner.wake(s.db)).toBe(1)
    await s.engine.settled(id)

    expect(await getJob(s, job.id)).toMatchObject({ status: "complete" })
    expect(s.engine.recorded(id).slice(0, recorded.length)).toEqual(recorded)
    expect((await liveViews(s)).map((v) => v.status)).toEqual([
      "ready",
      "ready",
      "ready",
    ])
    expect(await changeLabels(s)).toEqual([
      "human: Created the Expedition",
      "build: Queued the test Views",
      "build: Built Test View 1",
      "build: Built Test View 2",
      "build: Built Test View 3",
    ])
    expect(s.notes).toHaveLength(1)
  })

  it("fails with a plain reason on the View, and a retry resumes past the Views it built", async () => {
    const job = await start(s, { views: 3, failView: { n: 2 } })
    await s.engine.settled(instanceId({ jobId: job.id, attempt: 1 }))

    expect(await getJob(s, job.id)).toMatchObject({
      status: "failed",
      error: "Forced failure while building Test View 2",
    })
    let views = await liveViews(s)
    expect(views.map((v) => [v.status, v.failReason ?? null])).toEqual([
      ["ready", null],
      ["failed", "Forced failure while building Test View 2"],
      ["queued", null],
    ])
    const failed = s.events.filter((e) => e.status === "failed")
    expect(failed.map((e) => e.viewId ?? "job")).toEqual([views[1]!.id, "job"])
    expect(failed[1]!.reason).toBe("Forced failure while building Test View 2")
    expect(s.notes.map((n) => n.note.title)).toEqual(["Test build failed"])

    const res = await s.app.request(`/api/jobs/${job.id}/retry`, {
      method: "POST",
      headers: s.ada.headers,
    })
    expect(res.status).toBe(200)
    const retried = ((await res.json()) as { job: Job }).job
    expect(retried).toMatchObject({ status: "queued", attempt: 2, error: null })
    await s.engine.settled(instanceId({ jobId: job.id, attempt: 2 }))

    expect(await getJob(s, job.id)).toMatchObject({
      status: "complete",
      attempt: 2,
    })
    views = await liveViews(s)
    expect(views.map((v) => [v.label, v.status, v.failReason ?? null])).toEqual(
      [
        [fakeViewLabel(1), "ready", null],
        [fakeViewLabel(2), "ready", null],
        [fakeViewLabel(3), "ready", null],
      ]
    )
    // View 1 was not built again.
    expect(await changeLabels(s)).toEqual([
      "human: Created the Expedition",
      "build: Queued the test Views",
      "build: Built Test View 1",
      "build: Could not build Test View 2",
      "build: Queued the test Views",
      "build: Built Test View 2",
      "build: Built Test View 3",
    ])
    // A complete job can't be retried.
    const again = await s.app.request(`/api/jobs/${job.id}/retry`, {
      method: "POST",
      headers: s.ada.headers,
    })
    expect(again.status).toBe(409)
  })

  it("cancels a running job; it stops and can be retried", async () => {
    const job = await start(s, { views: 2, stepMs: 200 })
    const id = instanceId({ jobId: job.id, attempt: 1 })
    await until(() => s.engine.recorded(id).includes("plan"))
    const res = await s.app.request(`/api/jobs/${job.id}/cancel`, {
      method: "POST",
      headers: s.ada.headers,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { job: Job }).job.status).toBe("cancelled")
    await s.engine.settled(id)
    expect(s.engine.status(id)).toBe("terminated")
    expect(await getJob(s, job.id)).toMatchObject({ status: "cancelled" })
    expect(s.events.at(-1)).toMatchObject({
      status: "cancelled",
      jobId: job.id,
    })
    expect(s.notes).toEqual([])

    const twice = await s.app.request(`/api/jobs/${job.id}/cancel`, {
      method: "POST",
      headers: s.ada.headers,
    })
    expect(twice.status).toBe(409)

    await s.app.request(`/api/jobs/${job.id}/retry`, {
      method: "POST",
      headers: s.ada.headers,
    })
    await s.engine.settled(instanceId({ jobId: job.id, attempt: 2 }))
    expect(await getJob(s, job.id)).toMatchObject({ status: "complete" })
    expect((await liveViews(s)).map((v) => v.status)).toEqual([
      "ready",
      "ready",
    ])
  })
})

describe("job routes", () => {
  let s: Setup
  beforeEach(async () => {
    s = await setup()
  })

  it("lists an Expedition's jobs, newest first", async () => {
    const a = await start(s, { views: 1 })
    const b = await start(s, { views: 1 })
    const res = await s.app.request(`/api/expeditions/${s.exp}/jobs`, {
      headers: s.ada.headers,
    })
    const { jobs } = (await res.json()) as { jobs: Job[] }
    expect(jobs.map((j) => j.id)).toEqual([b.id, a.id])
  })

  it("lets editors start jobs, viewers only read them, and hides them from strangers", async () => {
    const job = await start(s, { views: 1 })
    const ed = await signUp(s.app, "ed")
    const vic = await signUp(s.app, "vic")
    const eve = await signUp(s.app, "eve")
    await s.db.insert(schema.collaborators).values([
      { expeditionId: s.exp, userId: ed.id, role: "editor" },
      { expeditionId: s.exp, userId: vic.id, role: "viewer" },
    ])
    const post = (path: string, who: TestUser, body?: unknown) =>
      s.app.request(path, {
        method: "POST",
        headers: who.headers,
        body: body ? JSON.stringify(body) : undefined,
      })
    const startBody = { kind: "fake", input: { views: 1 } }

    expect(
      (await post(`/api/expeditions/${s.exp}/jobs`, ed, startBody)).status
    ).toBe(201)
    expect(
      (await post(`/api/expeditions/${s.exp}/jobs`, vic, startBody)).status
    ).toBe(403)
    expect(
      (await post(`/api/expeditions/${s.exp}/jobs`, eve, startBody)).status
    ).toBe(404)
    expect(
      (await s.app.request(`/api/jobs/${job.id}`, { headers: vic.headers }))
        .status
    ).toBe(200)
    expect(
      (await s.app.request(`/api/jobs/${job.id}`, { headers: eve.headers }))
        .status
    ).toBe(404)
    expect((await post(`/api/jobs/${job.id}/retry`, vic)).status).toBe(403)
    expect((await post(`/api/jobs/${job.id}/cancel`, eve)).status).toBe(404)
    expect((await s.app.request(`/api/jobs/${job.id}`)).status).toBe(401)
  })

  it("validates the kind and input, and keeps the test job to test servers", async () => {
    const post = (body: unknown, app = s.app) =>
      app.request(`/api/expeditions/${s.exp}/jobs`, {
        method: "POST",
        headers: s.ada.headers,
        body: JSON.stringify(body),
      })
    expect((await post({ kind: "nope" })).status).toBe(400)
    expect((await post({ kind: "fake", input: { views: 99 } })).status).toBe(
      400
    )
    expect((await post({ kind: "fake", input: { extra: 1 } })).status).toBe(400)

    // The same session on a server without test credentials.
    const env = { ...TEST_ENV, AUTH_TEST_CREDENTIALS: undefined }
    const engine = createInlineEngine({
      deps: {
        connect: async () => ({ db: s.db, close: async () => {} }),
        relay: { published() {} },
      },
      registry: JOB_KINDS,
    })
    const prod = testApp(env, s.db, undefined, undefined, {
      jobs: createJobRunner({
        engine,
        registry: JOB_KINDS,
        relay: { published() {} },
      }),
    })
    const res = await post({ kind: "fake" }, prod)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "unknown job kind: fake" })
  })

  it("answers 501 without a runner", async () => {
    const plain = testApp(TEST_ENV, s.db)
    const res = await plain.request(`/api/expeditions/${s.exp}/jobs`, {
      method: "POST",
      headers: s.ada.headers,
      body: JSON.stringify({ kind: "fake" }),
    })
    expect(res.status).toBe(501)
  })
})

describe("the live route", () => {
  it("hands a viewer's upgrade to the relay with the head seq, and refuses others", async () => {
    const s = await setup()
    const ws = { ...s.ada.headers, upgrade: "websocket" }
    const res = await s.app.request(`/api/expeditions/${s.exp}/live`, {
      headers: ws,
    })
    expect(await res.text()).toBe("upgraded")
    expect(s.joins).toEqual([
      { expeditionId: s.exp, userId: s.ada.id, headSeq: 1 },
    ])

    const plain = await s.app.request(`/api/expeditions/${s.exp}/live`, {
      headers: s.ada.headers,
    })
    expect(plain.status).toBe(426)
    const eve = await signUp(s.app, "eve")
    const stranger = await s.app.request(`/api/expeditions/${s.exp}/live`, {
      headers: { ...eve.headers, upgrade: "websocket" },
    })
    expect(stranger.status).toBe(404)
    const anon = await s.app.request(`/api/expeditions/${s.exp}/live`, {
      headers: { upgrade: "websocket" },
    })
    expect(anon.status).toBe(401)

    const noRoom = testApp(TEST_ENV, s.db)
    const res501 = await noRoom.request(`/api/expeditions/${s.exp}/live`, {
      headers: ws,
    })
    expect(res501.status).toBe(501)
  })
})
