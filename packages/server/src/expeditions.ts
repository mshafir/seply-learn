// Expedition and Collaborator basics (WP-1.1): create one, list mine.
// Routes here run behind `requireUser`.
import {
  makeOps,
  schema,
  ulid,
  ulidTime,
  type LoggedOp,
  type Op,
  type OpBody,
  type Role,
  type ViewTypeId,
} from "@umbel/domain"
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { appendOps, type ChangeInfo } from "./oplog.ts"
import { publishCommitted, type Relay } from "./relay.ts"

const {
  expeditions,
  collaborators,
  expeditionTags,
  users,
  concepts,
  views,
  changes,
} = schema

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

/** A Collaborator as a Library card shows them (no email). */
export type CardCollaborator = {
  id: string
  name: string
  image: string | null
  role: Role
}

/**
 * One Library card (spec §3.2): the summary, plus the Expedition Tags, the
 * Collaborators (owner first), live Concept and View counts, the best View's
 * View Type (for the fixed thumbnail; the first View's when no best View is
 * set, null with no Views) and when it last changed (its latest Change, else
 * its creation), ISO 8601.
 */
export type LibraryCard = ExpeditionSummary & {
  tags: string[]
  collaborators: CardCollaborator[]
  counts: { concepts: number; views: number }
  bestViewType: ViewTypeId | null
  updatedAt: string
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
    const out: LibraryCard[] = await libraryCards(db, rows)
    return c.json({ expeditions: out })
  })

  return r
}

const ROLE_ORDER: Record<Role, number> = { owner: 0, editor: 1, viewer: 2 }

/** Adds what a Library card shows to each summary (five queries in all). */
export async function libraryCards(
  db: Db,
  rows: ExpeditionSummary[]
): Promise<LibraryCard[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [tagRows, people, conceptCounts, viewRows, lastChanges, best] =
    await Promise.all([
      db
        .select({ id: expeditionTags.expeditionId, tag: expeditionTags.tag })
        .from(expeditionTags)
        .where(inArray(expeditionTags.expeditionId, ids)),
      db
        .select({
          expeditionId: collaborators.expeditionId,
          id: users.id,
          name: users.name,
          image: users.image,
          role: collaborators.role,
        })
        .from(collaborators)
        .innerJoin(users, eq(users.id, collaborators.userId))
        .where(inArray(collaborators.expeditionId, ids)),
      db
        .select({ id: concepts.expeditionId, n: count() })
        .from(concepts)
        .where(
          and(inArray(concepts.expeditionId, ids), isNull(concepts.deletedAt))
        )
        .groupBy(concepts.expeditionId),
      db
        .select({
          expeditionId: views.expeditionId,
          id: views.id,
          viewType: views.viewType,
          orderKey: views.orderKey,
        })
        .from(views)
        .where(and(inArray(views.expeditionId, ids), isNull(views.deletedAt))),
      db
        .select({
          id: changes.expeditionId,
          ms: sql<string>`extract(epoch from max(${changes.at})) * 1000`,
        })
        .from(changes)
        .where(inArray(changes.expeditionId, ids))
        .groupBy(changes.expeditionId),
      db
        .select({ id: expeditions.id, bestViewId: expeditions.bestViewId })
        .from(expeditions)
        .where(inArray(expeditions.id, ids)),
    ])

  const group = <T, K>(list: T[], keyOf: (t: T) => K) => {
    const m = new Map<K, T[]>()
    for (const t of list) m.set(keyOf(t), [...(m.get(keyOf(t)) ?? []), t])
    return m
  }
  const tagsOf = group(tagRows, (r) => r.id)
  const peopleOf = group(people, (r) => r.expeditionId)
  const viewsOf = group(viewRows, (r) => r.expeditionId)
  const conceptsOf = new Map(conceptCounts.map((r) => [r.id, Number(r.n)]))
  const changedAt = new Map(lastChanges.map((r) => [r.id, Number(r.ms)]))
  const bestOf = new Map(best.map((r) => [r.id, r.bestViewId]))

  return rows.map((row) => {
    const vs = (viewsOf.get(row.id) ?? []).sort((a, b) =>
      a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0
    )
    const bestView =
      vs.find((v) => v.id === bestOf.get(row.id)) ?? vs[0] ?? null
    const at = changedAt.get(row.id)
    return {
      ...row,
      tags: (tagsOf.get(row.id) ?? []).map((t) => t.tag).sort(),
      collaborators: (peopleOf.get(row.id) ?? [])
        .map(({ id, name, image, role }) => ({ id, name, image, role }))
        .sort(
          (a, b) =>
            ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
            a.name.localeCompare(b.name)
        ),
      counts: { concepts: conceptsOf.get(row.id) ?? 0, views: vs.length },
      bestViewType: bestView?.viewType ?? null,
      updatedAt: new Date(at ?? ulidTime(row.id)).toISOString(),
    }
  })
}
