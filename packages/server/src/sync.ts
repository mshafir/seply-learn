// Push and pull (spec §2.3).
//
//   POST /push  { expeditionId, ops: Op[], changes?: [{ id, label?, origin? }] }
//     → 200 { headSeq, results: [{ opId, serverSeq }] }
//   GET  /pull?expedition=<id>&since=<serverSeq>[&limit=<n>]
//     → 200 { headSeq, ops: LoggedOp[], more }
//
// A push is all or nothing: one transaction appends and applies every new op,
// or nothing is written. Retrying a push returns the same results.
import { can, parseOp, SCHEMA_V, schema, type Op } from "@umbel/domain"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { requireUser, type AppEnv } from "./app.ts"
import {
  appendOps,
  CLIENT_ORIGINS,
  PULL_LIMIT,
  PushError,
  readOps,
  roleOf,
} from "./oplog.ts"
import { publishCommitted, type Relay } from "./relay.ts"

/** The most ops one push may carry. */
export const PUSH_LIMIT = 1000

export const PushBody = z.object({
  expeditionId: z.string().min(1),
  ops: z.array(z.unknown()).min(1).max(PUSH_LIMIT),
  changes: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().trim().min(1).max(200).optional(),
        origin: z.enum(CLIENT_ORIGINS).optional(),
      })
    )
    .max(PUSH_LIMIT)
    .optional(),
})

export const PullQuery = z.object({
  expedition: z.string().min(1),
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(PULL_LIMIT).default(PULL_LIMIT),
})

/** Validates each op of a push; throws a 400 PushError naming the first bad one. */
export function validateOps(
  raw: readonly unknown[],
  expeditionId: string,
  userId: string
): Op[] {
  const seen = new Set<string>()
  return raw.map((input, index) => {
    const r = parseOp(input)
    const opId =
      input && typeof input === "object" && "opId" in input
        ? String((input as { opId: unknown }).opId)
        : undefined
    const bad = (message: string) =>
      new PushError(400, {
        error: "invalid op",
        opId,
        message: `ops[${index}]: ${message}`,
      })
    if (!r.success)
      throw bad(
        r.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
      )
    const op = r.data as Op
    if (op.expeditionId !== expeditionId)
      throw bad("op is for another Expedition")
    if (op.actor !== userId) throw bad("op's actor is not the signed-in user")
    if (op.schemaV !== SCHEMA_V)
      throw bad(`schema_v ${op.schemaV} is not ${SCHEMA_V}`)
    if (seen.has(op.opId)) throw bad("duplicate op id in the batch")
    seen.add(op.opId)
    return op
  })
}

export function syncRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()

  r.post("/push", requireUser(), async (c) => {
    const body = PushBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const { expeditionId, changes } = body.data
    const user = c.var.user
    try {
      const ops = validateOps(body.data.ops, expeditionId, user.id)
      const db = await c.var.db()
      const out = await db.transaction((tx) =>
        appendOps(tx, { expeditionId, userId: user.id, ops, changes })
      )
      await publishCommitted(relay, expeditionId, out.logged)
      return c.json({ headSeq: out.headSeq, results: out.results })
    } catch (err) {
      if (err instanceof PushError) return c.json(err.body, err.status)
      throw err
    }
  })

  // Anyone who can view the Expedition may pull: viewing needs no sign-in
  // where Visibility allows (spec §1.8).
  r.get("/pull", async (c) => {
    const q = PullQuery.safeParse(c.req.query())
    if (!q.success)
      return c.json({ error: "invalid query", issues: q.error.issues }, 400)
    const { expedition: expeditionId, since, limit } = q.data
    const db = await c.var.db()
    const [exp] = await db
      .select({
        visibility: schema.expeditions.visibility,
        deletedAt: schema.expeditions.deletedAt,
        headSeq: schema.expeditions.headSeq,
      })
      .from(schema.expeditions)
      .where(eq(schema.expeditions.id, expeditionId))
    const notFound = () => c.json({ error: "Expedition not found" }, 404)
    if (!exp || exp.deletedAt) return notFound()
    let userId: string | null = null
    if (exp.visibility === "private") {
      const auth = await c.var.auth()
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      userId = session?.user.id ?? null
    }
    const role = await roleOf(db, expeditionId, userId)
    if (!can({ role, signedIn: !!userId }, "read", exp.visibility))
      return notFound()
    const ops = await readOps(db, expeditionId, since, limit)
    const last = ops.at(-1)?.serverSeq ?? since
    const headSeq = Math.max(exp.headSeq, last)
    return c.json({ headSeq, ops, more: last < headSeq })
  })

  return r
}
