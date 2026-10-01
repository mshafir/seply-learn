// Jobs and the live room over HTTP (all signed in).
//
//   POST /expeditions/:id/jobs   { kind, input? } → 201 { job }   (useAi: owners, editors)
//   GET  /expeditions/:id/jobs   → { jobs }, the 20 most recent  (read)
//   GET  /jobs/:id               → { job }                        (read)
//   POST /jobs/:id/cancel        → { job }                        (useAi)
//   POST /jobs/:id/retry         → { job }                        (useAi)
//   POST /jobs/:id/continue      → { job }  paused at the cap     (useAi)
//   GET  /expeditions/:id/live   WebSocket upgrade into the room  (read)
//
// A job or Expedition the caller can't view is a 404; one they can view but
// not run jobs on is a 403. Test-only kinds (the fake job) are refused unless
// test credentials are on.
import { can, schema, type Action } from "@seply/domain"
import { eq } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { z } from "zod"
import type { AppEnv } from "../app.ts"
import type { Db } from "../db.ts"
import { roleOf } from "../oplog.ts"
import type { Relay } from "../relay.ts"
import { JobError } from "./runner.ts"
import { getJob, listJobs } from "./store.ts"
import type { JobRunner } from "./types.ts"

const StartBody = z.object({
  kind: z.string().min(1).max(64),
  input: z.unknown().optional(),
})

/** The caller's access to an Expedition, or null when it isn't there for them. */
export async function access(db: Db, expeditionId: string, userId: string) {
  const [exp] = await db
    .select({
      visibility: schema.expeditions.visibility,
      deletedAt: schema.expeditions.deletedAt,
      headSeq: schema.expeditions.headSeq,
    })
    .from(schema.expeditions)
    .where(eq(schema.expeditions.id, expeditionId))
  if (!exp || exp.deletedAt) return null
  const role = await roleOf(db, expeditionId, userId)
  const actor = { role, signedIn: true }
  if (!can(actor, "read", exp.visibility)) return null
  return {
    headSeq: exp.headSeq,
    may: (action: Action) => can(actor, action, exp.visibility),
  }
}

export function jobRoutes(runner: JobRunner | undefined, relay: Relay) {
  const r = new Hono<AppEnv>()

  const noRunner = (c: Context<AppEnv>) =>
    c.json({ error: "jobs are not available on this server" }, 501)
  const refused = (c: Context<AppEnv>, err: unknown) => {
    if (err instanceof JobError)
      return c.json({ error: err.message }, err.status)
    throw err
  }

  r.post("/expeditions/:id/jobs", async (c) => {
    if (!runner) return noRunner(c)
    const body = StartBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const def = runner.registry.get(body.data.kind)
    if (!def || (def.testOnly && !c.var.config().testCredentials))
      return c.json({ error: `unknown job kind: ${body.data.kind}` }, 400)
    const input = def.input.safeParse(body.data.input ?? {})
    if (!input.success)
      return c.json({ error: "invalid input", issues: input.error.issues }, 400)
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const a = await access(db, expeditionId, c.var.user.id)
    if (!a) return c.json({ error: "Expedition not found" }, 404)
    if (!a.may("useAi")) return c.json({ error: "not allowed" }, 403)
    try {
      const job = await runner.start(db, {
        expeditionId,
        kind: def.kind,
        input: input.data,
        startedBy: c.var.user.id,
      })
      return c.json({ job }, 201)
    } catch (err) {
      return refused(c, err)
    }
  })

  r.get("/expeditions/:id/jobs", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    if (!(await access(db, expeditionId, c.var.user.id)))
      return c.json({ error: "Expedition not found" }, 404)
    return c.json({ jobs: await listJobs(db, expeditionId) })
  })

  r.get("/expeditions/:id/live", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return c.json({ error: "expected a WebSocket upgrade" }, 426)
    if (!relay.handleUpgrade)
      return c.json({ error: "the live room is not available" }, 501)
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const a = await access(db, expeditionId, c.var.user.id)
    if (!a) return c.json({ error: "Expedition not found" }, 404)
    return relay.handleUpgrade(c.req.raw, {
      expeditionId,
      userId: c.var.user.id,
      headSeq: a.headSeq,
    })
  })

  /** The job, if the caller may take `action` on its Expedition. */
  const jobFor = async (c: Context<AppEnv>, action: Action) => {
    const db = await c.var.db()
    const job = await getJob(db, c.req.param("id")!)
    const a = job && (await access(db, job.expeditionId, c.var.user.id))
    if (!job || !a) return { db, res: c.json({ error: "job not found" }, 404) }
    if (!a.may(action))
      return { db, res: c.json({ error: "not allowed" }, 403) }
    return { db, job }
  }

  r.get("/jobs/:id", async (c) => {
    const { job, res } = await jobFor(c, "read")
    return res ?? c.json({ job })
  })

  r.post("/jobs/:id/cancel", async (c) => {
    if (!runner) return noRunner(c)
    const { db, job, res } = await jobFor(c, "useAi")
    if (res) return res
    try {
      return c.json({ job: await runner.cancel(db, job!.id) })
    } catch (err) {
      return refused(c, err)
    }
  })

  r.post("/jobs/:id/retry", async (c) => {
    if (!runner) return noRunner(c)
    const { db, job, res } = await jobFor(c, "useAi")
    if (res) return res
    try {
      return c.json({ job: await runner.retry(db, job!.id) })
    } catch (err) {
      return refused(c, err)
    }
  })

  r.post("/jobs/:id/continue", async (c) => {
    if (!runner) return noRunner(c)
    const { db, job, res } = await jobFor(c, "useAi")
    if (res) return res
    try {
      return c.json({ job: await runner.continue(db, job!.id) })
    } catch (err) {
      return refused(c, err)
    }
  })

  return r
}
