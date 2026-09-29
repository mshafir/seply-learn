// Expedition and Collaborator basics (WP-1.1): create one, list mine.
// Routes here run behind `requireUser`.
import { schema, ulid, type Role } from "@umbel/domain"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"

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

export function expeditionRoutes() {
  const r = new Hono<AppEnv>()

  // Create: a new private draft; the creator is its owner Collaborator.
  // The title is written directly for now; WP-1.2 moves logged fields onto ops.
  r.post("/", async (c) => {
    const body = CreateExpedition.safeParse(
      await c.req.json().catch(() => ({}))
    )
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const user = c.var.user
    const db = await c.var.db()
    const id = ulid(Date.now())
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(expeditions)
        .values({ id, ownerId: user.id, title: body.data.title })
        .returning(summaryColumns)
      await tx
        .insert(collaborators)
        .values({ expeditionId: id, userId: user.id, role: "owner" })
      return row!
    })
    const out: ExpeditionSummary = { ...created, role: "owner" }
    return c.json(out, 201)
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
