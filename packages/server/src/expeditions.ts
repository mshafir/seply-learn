// Expedition and Collaborator basics (WP-1.1): create one, list mine.
// Routes here run behind `requireUser`.
import {
  makeOps,
  schema,
  ulid,
  type LoggedOp,
  type Op,
  type OpBody,
  type Role,
} from "@umbel/domain"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { appendOps, type ChangeInfo } from "./oplog.ts"
import { publishCommitted, type Relay } from "./relay.ts"

const { expeditions, collaborators } = schema

export const CreateExpedition = z.object({
  title: z.string().trim().max(200).default(""),
})

export type ExpeditionSummary = {
  id: string
  title: string
  summary: string
  visibility: "private" | "unlisted" | "public"
  status: "draft" | "building" | "ready"
  role: Role
}

const summaryColumns = {
  id: expeditions.id,
  title: expeditions.title,
  summary: expeditions.summary,
  visibility: expeditions.visibility,
  status: expeditions.status,
}

/**
 * Creates a private Expedition owned by `userId` and logs its first Change
 * (`ops`, which may be empty) through the op log. Run inside a transaction.
 */
export async function createExpedition(
  tx: Db,
  args: { id: string; userId: string; ops: readonly Op[]; change: ChangeInfo }
): Promise<{ summary: ExpeditionSummary; logged: LoggedOp[] }> {
  const { id, userId } = args
  await tx.insert(expeditions).values({ id, ownerId: userId })
  await tx
    .insert(collaborators)
    .values({ expeditionId: id, userId, role: "owner" })
  const { logged } = await appendOps(tx, {
    expeditionId: id,
    userId,
    ops: args.ops,
    changes: [args.change],
  })
  const [row] = await tx
    .select(summaryColumns)
    .from(expeditions)
    .where(eq(expeditions.id, id))
  return { summary: { ...row!, role: "owner" }, logged }
}

export function expeditionRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()

  // Create: a new private draft; the creator is its owner Collaborator. The
  // row and the owner are plain; the title is logged, as the first Change
  // ("Created the Expedition"), in the same transaction.
  r.post("/", async (c) => {
    const body = CreateExpedition.safeParse(
      await c.req.json().catch(() => ({}))
    )
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const user = c.var.user
    const db = await c.var.db()
    const now = Date.now()
    const id = ulid(now)
    const bodies: OpBody[] = body.data.title
      ? [
          {
            kind: "expedition.set",
            target: id,
            path: "title",
            value: body.data.title,
          },
        ]
      : []
    const changeId = ulid(now)
    const ops = makeOps(bodies, {
      expeditionId: id,
      actor: user.id,
      changeId,
      nextOpId: () => ulid(Date.now()),
    })
    const { summary, logged } = await db.transaction((tx) =>
      createExpedition(tx, {
        id,
        userId: user.id,
        ops,
        change: { id: changeId, label: "Created the Expedition" },
      })
    )
    await publishCommitted(relay, id, logged)
    return c.json(summary, 201)
  })

  // List mine: every Expedition I collaborate on (as owner, editor or viewer),
  // newest first (ids are ULIDs), excluding those in Trash.
  r.get("/", async (c) => {
    const db = await c.var.db()
    const rows = await db
      .select({ ...summaryColumns, role: collaborators.role })
      .from(collaborators)
      .innerJoin(expeditions, eq(expeditions.id, collaborators.expeditionId))
      .where(
        and(
          eq(collaborators.userId, c.var.user.id),
          isNull(expeditions.deletedAt)
        )
      )
      .orderBy(desc(expeditions.id))
    const out: ExpeditionSummary[] = rows
    return c.json({ expeditions: out })
  })

  return r
}
