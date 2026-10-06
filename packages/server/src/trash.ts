// Trash (spec §1.8, §3.2; WP-5.2): the owner deletes an Expedition to Trash
// for 30 days, and may restore it until then. After that a scheduled job
// purges everything: the tables, the log, Proposals and the Source files.
// Forks are unaffected (they share nothing but a `forked_from` reference).
//
//   DELETE /expeditions/:id           → 200 { purgeAfter }   (trashExpedition: owner)
//   GET    /expeditions/trash         → { expeditions: TrashedCard[] } (mine, as owner)
//   POST   /expeditions/:id/restore   → 200 ExpeditionSummary (restoreExpedition: owner)
//
// An Expedition in Trash is unreadable to everyone (`expeditionAccess` is
// null), so restoring resolves the owner from the rows directly; anyone else
// gets 404, as for any Expedition they can't read.
import { can, schema, type Role } from "@seply/domain"
import { and, asc, eq, isNotNull, lte } from "drizzle-orm"
import { Hono } from "hono"
import { authorize, roleOf } from "./access.ts"
import type { AppEnv } from "./app.ts"
import type { BlobStore } from "./blobs.ts"
import type { Db } from "./db.ts"
import {
  libraryCards,
  type ExpeditionSummary,
  type LibraryCard,
} from "./expeditions.ts"
import type { Relay } from "./relay.ts"

const { expeditions, collaborators, trash, sources } = schema

/** How long an Expedition stays in Trash before it is purged. */
export const TRASH_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** A Library card for an Expedition in Trash. */
export type TrashedCard = LibraryCard & {
  /** When it went to Trash, and when it will be purged (ISO 8601). */
  deletedAt: string
  purgeAfter: string
}

const iso = (v: string | Date) => new Date(v).toISOString()

/** Best effort, like the other relay calls: the rows are already changed. */
async function kickAll(
  db: Db,
  relay: Relay,
  expeditionId: string,
  reason: string
) {
  if (!relay.kick) return
  const people = await db
    .select({ userId: collaborators.userId })
    .from(collaborators)
    .where(eq(collaborators.expeditionId, expeditionId))
  try {
    for (const p of people) await relay.kick(expeditionId, p.userId, reason)
    await relay.kick(expeditionId, null, reason)
  } catch (err) {
    console.error("relay: kick failed", err)
  }
}

/**
 * Moves an Expedition to Trash as `userId` (the owner): it disappears for
 * everyone at once, and is purged after `TRASH_DAYS`. Throws AccessDenied.
 */
export async function trashExpedition(
  db: Db,
  args: { expeditionId: string; userId: string; now?: () => number }
): Promise<{ deletedAt: string; purgeAfter: string }> {
  const now = (args.now ?? Date.now)()
  const deletedAt = new Date(now).toISOString()
  const purgeAfter = new Date(now + TRASH_DAYS * DAY_MS).toISOString()
  await db.transaction(async (tx) => {
    await authorize(tx, args.expeditionId, args.userId, "trashExpedition", {
      lock: true,
      refusal: "only the owner deletes an Expedition",
    })
    await tx
      .update(expeditions)
      .set({ deletedAt })
      .where(eq(expeditions.id, args.expeditionId))
    await tx
      .insert(trash)
      .values({
        expeditionId: args.expeditionId,
        deletedBy: args.userId,
        purgeAfter,
      })
      .onConflictDoUpdate({
        target: trash.expeditionId,
        set: { deletedBy: args.userId, purgeAfter },
      })
  })
  return { deletedAt, purgeAfter }
}

/**
 * Restores an Expedition from Trash as `userId`. "not-found" unless they own
 * it and it is in Trash (an Expedition that isn't is "not-trashed").
 */
export async function restoreExpedition(
  db: Db,
  args: { expeditionId: string; userId: string }
): Promise<ExpeditionSummary | "not-found" | "not-trashed"> {
  return db.transaction(async (tx) => {
    const [exp] = await tx
      .select({
        id: expeditions.id,
        title: expeditions.title,
        summary: expeditions.summary,
        visibility: expeditions.visibility,
        status: expeditions.status,
        deletedAt: expeditions.deletedAt,
      })
      .from(expeditions)
      .where(eq(expeditions.id, args.expeditionId))
      .for("update")
    if (!exp) return "not-found"
    const role = await roleOf(tx, exp.id, args.userId)
    const actor = { role, signedIn: true }
    if (!can(actor, "restoreExpedition", exp.visibility)) return "not-found"
    // Not in Trash: the owner can read it, so say so rather than 404.
    if (!exp.deletedAt) return "not-trashed"
    await tx
      .update(expeditions)
      .set({ deletedAt: null })
      .where(eq(expeditions.id, exp.id))
    await tx.delete(trash).where(eq(trash.expeditionId, exp.id))
    return {
      id: exp.id,
      title: exp.title,
      summary: exp.summary,
      visibility: exp.visibility,
      status: exp.status,
      role: role as Role,
    }
  })
}

/** The Expeditions `userId` owns that are in Trash, the soonest purged first. */
export async function listTrash(
  db: Db,
  userId: string
): Promise<TrashedCard[]> {
  const rows = await db
    .select({
      id: expeditions.id,
      title: expeditions.title,
      summary: expeditions.summary,
      visibility: expeditions.visibility,
      status: expeditions.status,
      role: collaborators.role,
      deletedAt: expeditions.deletedAt,
      purgeAfter: trash.purgeAfter,
    })
    .from(collaborators)
    .innerJoin(expeditions, eq(expeditions.id, collaborators.expeditionId))
    .innerJoin(trash, eq(trash.expeditionId, expeditions.id))
    .where(
      and(
        eq(collaborators.userId, userId),
        eq(collaborators.role, "owner"),
        isNotNull(expeditions.deletedAt)
      )
    )
    .orderBy(asc(trash.purgeAfter))
  const when = new Map(
    rows.map((r) => [
      r.id,
      { deletedAt: iso(r.deletedAt!), purgeAfter: iso(r.purgeAfter) },
    ])
  )
  const cards = await libraryCards(
    db,
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      visibility: r.visibility,
      status: r.status,
      role: r.role,
      seenAt: new Date(0).toISOString(),
    }))
  )
  return cards.map((card) => ({ ...card, ...when.get(card.id)! }))
}

/** Every table that holds an Expedition's rows, children before parents. */
const EXPEDITION_TABLES = [
  schema.proposalItems,
  schema.proposals,
  schema.jobs,
  schema.readingStatus,
  schema.personalViewSettings,
  schema.readerPosition,
  schema.invites,
  schema.collaborators,
  schema.ops,
  schema.changes,
  schema.articleSections,
  schema.conceptTags,
  schema.relationships,
  schema.concepts,
  schema.views,
  schema.kindDefs,
  schema.relTypeDefs,
  schema.attributeDefs,
  schema.expeditionTags,
  schema.sources,
] as const

/**
 * Purges every Expedition whose 30 days in Trash are over (`purge_after` ≤
 * `now`): its Source files, then all its rows, each Expedition in its own
 * transaction. The scheduled job (the Worker's cron) runs it daily. Returns
 * the purged ids. A file that fails to delete is logged and the purge goes
 * on (an orphaned blob is unreachable: nothing points at it any more).
 */
export async function purgeTrash(
  db: Db,
  blobs: BlobStore | null,
  now: Date = new Date()
): Promise<string[]> {
  const due = await db
    .select({ id: trash.expeditionId })
    .from(trash)
    .innerJoin(expeditions, eq(expeditions.id, trash.expeditionId))
    .where(
      and(
        lte(trash.purgeAfter, now.toISOString()),
        isNotNull(expeditions.deletedAt)
      )
    )
  const purged: string[] = []
  for (const { id } of due) {
    const files = await db
      .select({ raw: sources.blobKey, segments: sources.segmentsKey })
      .from(sources)
      .where(eq(sources.expeditionId, id))
    for (const key of files.flatMap((f) => [f.raw, f.segments]))
      if (key && blobs)
        await blobs.delete(key).catch((err: unknown) => {
          console.error(`trash: could not delete ${key}`, err)
        })
    await db.transaction(async (tx) => {
      // Restored meanwhile? Then keep it.
      const [still] = await tx
        .select({ id: expeditions.id })
        .from(expeditions)
        .where(and(eq(expeditions.id, id), isNotNull(expeditions.deletedAt)))
        .for("update")
      if (!still) return
      for (const table of EXPEDITION_TABLES)
        await tx.delete(table).where(eq(table.expeditionId, id))
      await tx.delete(trash).where(eq(trash.expeditionId, id))
      await tx.delete(expeditions).where(eq(expeditions.id, id))
      purged.push(id)
    })
  }
  return purged
}

/** The Trash routes, under /expeditions (signed in). */
export function trashRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()

  r.get("/trash", async (c) => {
    const db = await c.var.db()
    return c.json({ expeditions: await listTrash(db, c.var.user.id) })
  })

  r.delete("/:id", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const out = await trashExpedition(db, {
      expeditionId,
      userId: c.var.user.id,
    })
    await kickAll(
      db,
      relay,
      expeditionId,
      "The owner moved this Expedition to Trash"
    )
    return c.json(out)
  })

  r.post("/:id/restore", async (c) => {
    const db = await c.var.db()
    const out = await restoreExpedition(db, {
      expeditionId: c.req.param("id"),
      userId: c.var.user.id,
    })
    if (out === "not-found")
      return c.json({ error: "Expedition not found" }, 404)
    if (out === "not-trashed")
      return c.json({ error: "it isn't in Trash" }, 409)
    return c.json(out)
  })

  return r
}
