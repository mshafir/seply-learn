// Per-reader state (spec §1.7): Reading status, personal View settings and
// the reader's position. Plain rows per user, outside the op log: never part
// of a Change, never undone, never forked, never shown to anyone else. The
// newest write wins, by the mark's `at`. Routes run behind `requireUser`.
//
//   GET  /reader/expeditions/:id  → { reading, viewSettings, position }
//   POST /reader  ReaderBatch     → { saved: { reading, viewSettings, positions }, skipped: [expeditionId] }
//   GET  /reader/recent?limit=3   → { items: [{ expedition, position }] }  (Continue reading)
//
// One POST carries any marks, across Expeditions: a single mark, a tab's
// offline queue, or an anonymous reader's whole browser state on sign-in.
// Marks for an Expedition the reader can't view (or that is gone) are
// skipped, not refused, so a queue never gets stuck on one.
import {
  can,
  parsePersonalSettings,
  ReaderBatch,
  schema,
  type PositionMark,
  type ReadingMark,
  type ViewSettingsMark,
  type ViewTypeId,
} from "@umbel/domain"
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import type { ExpeditionSummary } from "./expeditions.ts"
import { roleOf } from "./oplog.ts"
import type { Relay } from "./relay.ts"

const { readingStatus, personalViewSettings, readerPosition, expeditions } =
  schema

/** A timestamp column as an ISO 8601 UTC string (what marks carry). */
const isoAt = (col: PgColumn): SQL<string> =>
  sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/** The newest write wins: an upsert only replaces an older row. */
const newerThan = (col: PgColumn) => sql`${col} < excluded.at`

export const RecentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(3),
})

export type ReaderSnapshot = {
  reading: ReadingMark[]
  viewSettings: ViewSettingsMark[]
  position: PositionMark | null
}

export type ContinueReadingItem = {
  expedition: Omit<ExpeditionSummary, "role">
  position: PositionMark
}

/** A mark from the future (a skewed clock) would shadow every later write. */
function clampAt<T extends { at: string }>(mark: T, now: number): T {
  return Date.parse(mark.at) > now
    ? { ...mark, at: new Date(now).toISOString() }
    : mark
}

/** The Expeditions of `ids` this user may read. */
async function readable(db: Db, userId: string, ids: string[]) {
  if (!ids.length) return new Set<string>()
  const rows = await db
    .select({
      id: expeditions.id,
      visibility: expeditions.visibility,
      deletedAt: expeditions.deletedAt,
    })
    .from(expeditions)
    .where(inArray(expeditions.id, ids))
  const ok = new Set<string>()
  for (const e of rows) {
    if (e.deletedAt) continue
    const role = await roleOf(db, e.id, userId)
    if (can({ role, signedIn: true }, "read", e.visibility)) ok.add(e.id)
  }
  return ok
}

/** One reader's state in one Expedition. */
export async function readReaderState(
  db: Db,
  userId: string,
  expeditionId: string
): Promise<ReaderSnapshot> {
  const reading = await db
    .select({
      conceptId: readingStatus.conceptId,
      state: readingStatus.state,
      at: isoAt(readingStatus.at),
    })
    .from(readingStatus)
    .where(
      and(
        eq(readingStatus.userId, userId),
        eq(readingStatus.expeditionId, expeditionId)
      )
    )
  const settings = await db
    .select({
      viewId: personalViewSettings.viewId,
      settings: personalViewSettings.settings,
      at: isoAt(personalViewSettings.at),
    })
    .from(personalViewSettings)
    .where(
      and(
        eq(personalViewSettings.userId, userId),
        eq(personalViewSettings.expeditionId, expeditionId)
      )
    )
  const [pos] = await db
    .select({
      viewId: readerPosition.viewId,
      focusConceptId: readerPosition.focusConceptId,
      step: readerPosition.step,
      panelDepth: readerPosition.panelDepth,
      at: isoAt(readerPosition.at),
    })
    .from(readerPosition)
    .where(
      and(
        eq(readerPosition.userId, userId),
        eq(readerPosition.expeditionId, expeditionId)
      )
    )
  return {
    reading: reading.map((r) => ({ expeditionId, ...r })),
    viewSettings: settings.map((s) => ({ expeditionId, ...s })),
    position: pos
      ? {
          expeditionId,
          ...pos,
          panelDepth: pos.panelDepth as PositionMark["panelDepth"],
        }
      : null,
  }
}

/**
 * Saves a batch of one reader's marks, newest winning per row. Personal
 * settings are checked against their View Type's personal schema; marks of
 * Expeditions the reader can't view, and settings of unknown Views, are
 * skipped. Returns what was accepted (the rows it may have left alone
 * because they were newer count too).
 */
export async function saveReaderMarks(
  db: Db,
  userId: string,
  batch: ReaderBatch,
  now = Date.now()
) {
  const ids = [
    ...new Set([
      ...batch.reading.map((m) => m.expeditionId),
      ...batch.viewSettings.map((m) => m.expeditionId),
      ...batch.positions.map((m) => m.expeditionId),
    ]),
  ]
  const ok = await readable(db, userId, ids)
  const skipped = ids.filter((id) => !ok.has(id))

  const reading = newestBy(
    batch.reading
      .filter((m) => ok.has(m.expeditionId))
      .map((m) => clampAt(m, now)),
    (m) => `${m.expeditionId}/${m.conceptId}`
  )
  const positions = newestBy(
    batch.positions
      .filter((m) => ok.has(m.expeditionId))
      .map((m) => clampAt(m, now)),
    (m) => m.expeditionId
  )

  // Personal settings need their View's type.
  const wanted = batch.viewSettings.filter((m) => ok.has(m.expeditionId))
  const viewTypes = new Map<string, ViewTypeId>()
  const expIds = [...new Set(wanted.map((m) => m.expeditionId))]
  if (expIds.length) {
    const rows = await db
      .select({
        expeditionId: schema.views.expeditionId,
        id: schema.views.id,
        viewType: schema.views.viewType,
      })
      .from(schema.views)
      .where(
        and(
          inArray(schema.views.expeditionId, expIds),
          isNull(schema.views.deletedAt)
        )
      )
    for (const v of rows) viewTypes.set(`${v.expeditionId}/${v.id}`, v.viewType)
  }
  const viewSettings = newestBy(
    wanted
      .filter((m) => {
        const type = viewTypes.get(`${m.expeditionId}/${m.viewId}`)
        return !!type && parsePersonalSettings(type, m.settings).success
      })
      .map((m) => clampAt(m, now)),
    (m) => `${m.expeditionId}/${m.viewId}`
  )

  await db.transaction(async (tx) => {
    if (reading.length)
      await tx
        .insert(readingStatus)
        .values(reading.map((m) => ({ userId, ...m })))
        .onConflictDoUpdate({
          target: [
            readingStatus.userId,
            readingStatus.expeditionId,
            readingStatus.conceptId,
          ],
          set: {
            state: sql`excluded.state`,
            at: sql`excluded.at`,
          },
          setWhere: newerThan(readingStatus.at),
        })
    if (viewSettings.length)
      await tx
        .insert(personalViewSettings)
        .values(viewSettings.map((m) => ({ userId, ...m })))
        .onConflictDoUpdate({
          target: [
            personalViewSettings.userId,
            personalViewSettings.expeditionId,
            personalViewSettings.viewId,
          ],
          set: {
            settings: sql`excluded.settings`,
            at: sql`excluded.at`,
          },
          setWhere: newerThan(personalViewSettings.at),
        })
    for (const m of positions)
      await tx
        .insert(readerPosition)
        .values({ userId, ...m })
        .onConflictDoUpdate({
          target: [readerPosition.userId, readerPosition.expeditionId],
          set: {
            viewId: sql`excluded.view_id`,
            focusConceptId: sql`excluded.focus_concept_id`,
            step: sql`excluded.step`,
            panelDepth: sql`excluded.panel_depth`,
            at: sql`excluded.at`,
          },
          setWhere: newerThan(readerPosition.at),
        })
  })

  return {
    saved: { reading, viewSettings, positions },
    skipped,
  }
}

/** One upsert may not touch a row twice: keep the newest mark per row. */
function newestBy<T extends { at: string }>(ms: T[], key: (m: T) => string) {
  const by = new Map<string, T>()
  for (const m of ms) {
    const prev = by.get(key(m))
    if (!prev || Date.parse(m.at) > Date.parse(prev.at)) by.set(key(m), m)
  }
  return [...by.values()]
}

/** Continue reading: the reader's most recent positions in Expeditions they can still view. */
export async function recentPositions(
  db: Db,
  userId: string,
  limit: number
): Promise<ContinueReadingItem[]> {
  const rows = await db
    .select({
      expeditionId: readerPosition.expeditionId,
      viewId: readerPosition.viewId,
      focusConceptId: readerPosition.focusConceptId,
      step: readerPosition.step,
      panelDepth: readerPosition.panelDepth,
      at: isoAt(readerPosition.at),
      title: expeditions.title,
      summary: expeditions.summary,
      visibility: expeditions.visibility,
      status: expeditions.status,
    })
    .from(readerPosition)
    .innerJoin(expeditions, eq(expeditions.id, readerPosition.expeditionId))
    .where(
      and(eq(readerPosition.userId, userId), isNull(expeditions.deletedAt))
    )
    .orderBy(desc(readerPosition.at))
    // Some may no longer be viewable; look a little further.
    .limit(limit * 3)
  const out: ContinueReadingItem[] = []
  for (const r of rows) {
    if (out.length >= limit) break
    const role = await roleOf(db, r.expeditionId, userId)
    if (!can({ role, signedIn: true }, "read", r.visibility)) continue
    out.push({
      expedition: {
        id: r.expeditionId,
        title: r.title,
        summary: r.summary,
        visibility: r.visibility,
        status: r.status,
      },
      position: {
        expeditionId: r.expeditionId,
        viewId: r.viewId,
        focusConceptId: r.focusConceptId,
        step: r.step,
        panelDepth: r.panelDepth as PositionMark["panelDepth"],
        at: r.at,
      },
    })
  }
  return out
}

export function readerRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()

  r.get("/expeditions/:id", async (c) => {
    const db = await c.var.db()
    const id = c.req.param("id")
    const ok = await readable(db, c.var.user.id, [id])
    if (!ok.has(id)) return c.json({ error: "Expedition not found" }, 404)
    return c.json(await readReaderState(db, c.var.user.id, id))
  })

  r.post("/", async (c) => {
    const body = ReaderBatch.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const userId = c.var.user.id
    const { saved, skipped } = await saveReaderMarks(db, userId, body.data)
    const count = {
      reading: saved.reading.length,
      viewSettings: saved.viewSettings.length,
      positions: saved.positions.length,
    }
    if (count.reading + count.viewSettings + count.positions > 0) {
      try {
        await relay.reader?.(userId, saved)
      } catch (err) {
        console.error("relay: reader failed", err)
      }
    }
    return c.json({ saved: count, skipped })
  })

  r.get("/recent", async (c) => {
    const q = RecentQuery.safeParse(c.req.query())
    if (!q.success)
      return c.json({ error: "invalid query", issues: q.error.issues }, 400)
    const db = await c.var.db()
    return c.json({
      items: await recentPositions(db, c.var.user.id, q.data.limit),
    })
  })

  return r
}
