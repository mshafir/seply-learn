// The pg-boss JobRunner (WP-6.1) on a real Postgres: the fake job's steps
// recorded in job_steps, a step retried, cancel, Retry as a new attempt, and
// an instance dying mid-job while another picks the attempt up and finishes
// it from its last recorded step, every Change logged once.
// Needs TEST_DATABASE_URL (any Postgres the tests may create databases on).
import type { BuildEvent } from "@seply/domain"
import {
  createApp,
  createJobRunner,
  instanceId,
  JOB_KINDS,
  type Job,
  type JobRunner,
  type Relay,
  type ServerEnv,
} from "@seply/server"
import { Hono } from "hono"
import type pg from "pg"
import { PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectPool, createPool } from "./db.ts"
import { bossJobId, createPgBossEngine, type PgBossEngine } from "./jobs.ts"
import { freshDatabase, TEST_DATABASE_URL } from "./test/db.ts"

const ORIGIN = "http://localhost:3999"
const ENV: ServerEnv = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!!",
  AUTH_TEST_CREDENTIALS: "1",
}

type Instance = {
  boss: PgBoss
  engine: PgBossEngine
  runner: JobRunner
}

describe.skipIf(!TEST_DATABASE_URL)("pg-boss JobRunner", () => {
  let database: Awaited<ReturnType<typeof freshDatabase>>
  let pool: pg.Pool
  const events: BuildEvent[] = []
  const relay: Relay = {
    published: () => {},
    build: (_e, evt) => void events.push(evt),
  }
  const instances: Instance[] = []
  let a: Instance
  let app: Hono
  let headers: Record<string, string>
  let exp: string

  /** One instance: its own pg-boss and engine over the shared pool. */
  async function instance(): Promise<Instance> {
    const boss = new PgBoss({
      connectionString: database.url,
      max: 3,
      schema: "pgboss",
      superviseIntervalSeconds: 2,
      monitorIntervalSeconds: 2,
    })
    boss.on("error", () => {})
    await boss.start()
    const engine = createPgBossEngine({
      boss,
      pool,
      deps: { connect: () => connectPool(pool), relay },
      registry: JOB_KINDS,
      concurrency: 2,
      heartbeatSeconds: 10,
      pollingSeconds: 0.5,
    })
    await engine.start()
    const runner = createJobRunner({ engine, registry: JOB_KINDS, relay })
    const i = { boss, engine, runner }
    instances.push(i)
    return i
  }

  beforeAll(async () => {
    database = await freshDatabase("jobs")
    pool = createPool(database.url, 10)
    a = await instance()
    app = new Hono()
    app.route(
      "/api",
      createApp<ServerEnv>({
        connect: () => connectPool(pool),
        relay,
        jobs: {
          // Whichever instance is current runs the API's calls.
          get registry() {
            return JOB_KINDS
          },
          start: (db, req) => a.runner.start(db, req),
          cancel: (db, id) => a.runner.cancel(db, id),
          retry: (db, id) => a.runner.retry(db, id),
          continue: (db, id) => a.runner.continue(db, id),
          wake: (db) => a.runner.wake(db),
        },
      })
    )
    const signUp = await app.request(
      `${ORIGIN}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          email: "ada@example.com",
          password: "correct horse battery staple",
          name: "Ada",
        }),
      },
      ENV
    )
    const cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ")
    headers = { cookie, origin: ORIGIN, "content-type": "application/json" }
  })

  afterAll(async () => {
    for (const i of instances)
      await i.boss.stop({ graceful: false }).catch(() => {})
    await pool?.end()
    await database?.drop()
  })

  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `${ORIGIN}/api${path}`,
      {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      },
      ENV
    )

  /** Starts a fake job, by default in an Expedition of its own. */
  const start = async (input: unknown, fresh = true) => {
    if (fresh) {
      const created = await call("POST", "/expeditions", { title: "Jobs" })
      exp = ((await created.json()) as { id: string }).id
    }
    const res = await call("POST", `/expeditions/${exp}/jobs`, {
      kind: "fake",
      input,
    })
    expect(res.status).toBe(201)
    return ((await res.json()) as { job: Job }).job
  }

  const job = async (id: string) =>
    ((await (await call("GET", `/jobs/${id}`)).json()) as { job: Job }).job

  const until = async (pred: () => boolean | Promise<boolean>, ms = 60_000) => {
    const end = Date.now() + ms
    while (!(await pred())) {
      if (Date.now() > end) throw new Error("timed out")
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  const ended = (id: string) => async () =>
    ["complete", "failed", "cancelled", "paused"].includes(
      (await job(id)).status
    )

  const stepsOf = async (id: string, attempt = 1) =>
    (
      await pool.query<{ name: string }>(
        "select name from job_steps where job_id = $1 and attempt = $2 order by created_at, name",
        [id, attempt]
      )
    ).rows.map((r) => r.name)

  const bossJob = async (id: string, attempt: number) =>
    (
      await pool.query<{ state: string; retry_count: number }>(
        "select state, retry_count from pgboss.job where id = $1",
        [bossJobId(instanceId({ jobId: id, attempt }))]
      )
    ).rows[0]

  const changes = async () =>
    (
      await pool.query<{ label: string }>(
        "select label from changes where expedition_id = $1 order by first_seq",
        [exp]
      )
    ).rows.map((r) => r.label)

  it("runs a job to the end, recording each step, with progress to the room", async () => {
    const j = await start({ views: 2, stepMs: 0, failOnce: [1] })
    await until(ended(j.id))
    expect(await job(j.id)).toMatchObject({
      status: "complete",
      progress: 1,
      attempt: 1,
    })
    const steps = await stepsOf(j.id)
    expect(steps).toContain("job: start")
    expect(steps).toContain("job: complete")
    // View 1's step threw once and was retried: recorded once.
    expect(steps.filter((s) => s.startsWith("view 1"))).toHaveLength(
      new Set(steps.filter((s) => s.startsWith("view 1"))).size
    )
    const mine = events.filter((e) => e.jobId === j.id)
    expect(mine.at(-1)).toMatchObject({ status: "complete", progress: 1 })
    expect(mine.some((e) => e.viewId && e.status === "ready")).toBe(true)
    expect(await changes()).toEqual([
      "Created the Expedition",
      "Queued the test Views",
      "Built Test View 1",
      "Built Test View 2",
    ])
  })

  it("cancels a running job: it stops at its next step", async () => {
    const j = await start({ views: 3, stepMs: 1000 })
    await until(() =>
      events.some((e) => e.jobId === j.id && e.step === "Built 1 of 3")
    )
    const res = await call("POST", `/jobs/${j.id}/cancel`)
    expect(((await res.json()) as { job: Job }).job.status).toBe("cancelled")
    // The attempt notices at its next step boundary and runs no more.
    await new Promise((r) => setTimeout(r, 2500))
    const recorded = await stepsOf(j.id)
    await new Promise((r) => setTimeout(r, 1500))
    expect(await stepsOf(j.id)).toEqual(recorded)
    expect(recorded).not.toContain("job: complete")
    expect((await job(j.id)).status).toBe("cancelled")
  })

  it("retries a failed job as its next attempt, from the first step", async () => {
    const j = await start({ views: 2, failView: { n: 2 } })
    await until(ended(j.id))
    expect((await job(j.id)).status).toBe("failed")
    // A failed attempt is over: pg-boss never runs it again (a replay would
    // re-send its events after a Retry).
    await until(async () => (await bossJob(j.id, 1))?.state === "completed")
    expect(await bossJob(j.id, 1)).toEqual({
      state: "completed",
      retry_count: 0,
    })
    const res = await call("POST", `/jobs/${j.id}/retry`)
    expect(((await res.json()) as { job: Job }).job).toMatchObject({
      status: "queued",
      attempt: 2,
    })
    await until(ended(j.id))
    expect(await job(j.id)).toMatchObject({ status: "complete", attempt: 2 })
    expect(await stepsOf(j.id, 2)).toContain("job: start")
  })

  it(
    "survives its instance dying: another picks the attempt up from its last step",
    { timeout: 150_000 },
    async () => {
      const j = await start({ views: 3, stepMs: 1500 })
      await until(() =>
        events.some((e) => e.jobId === j.id && e.step === "Built 1 of 3")
      )
      // Instance A dies: no heartbeats, and its run stops where it is.
      await a.boss.stop({ graceful: false, close: true })
      a.engine.halt()
      const before = await stepsOf(j.id)
      expect(before).not.toContain("job: complete")

      // Instance B starts and, once A's heartbeat is overdue, takes the attempt.
      const b = await instance()
      a = b
      await until(ended(j.id), 90_000)
      expect(await job(j.id)).toMatchObject({ status: "complete", attempt: 1 })
      const after = await stepsOf(j.id)
      // What A recorded was kept, not run again.
      for (const s of before) expect(after).toContain(s)
      // Each Change logged once.
      expect(await changes()).toEqual([
        "Created the Expedition",
        "Queued the test Views",
        "Built Test View 1",
        "Built Test View 2",
        "Built Test View 3",
      ])
    }
  )

  it("names one pg-boss job per attempt, the same on every instance", () => {
    expect(bossJobId(instanceId({ jobId: "J", attempt: 1 }))).toBe(
      bossJobId("J-1")
    )
    expect(bossJobId("J-1")).not.toBe(bossJobId("J-2"))
    expect(bossJobId("J-1")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })
})
