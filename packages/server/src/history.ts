// History (spec §1.4, §3.9; WP-4.2): the Changes of an Expedition, newest
// first, for owners and editors.
//
//   GET /history?expedition=<id>[&before=<firstSeq>][&limit=<n>]
//     → 200 { headSeq, changes: ChangeSummary[], more }
//
// Undo, "view as of" and "Restore to here" run in the client's op engine
// (@seply/sync), over the log it already pulled: they append ordinary ops
// through /push as a new Change, so the server needs nothing more.
import { schema, type ChangeOrigin } from "@seply/domain"
import { and, desc, eq, lt } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { requireUser, type AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { expeditionAccess } from "./access.ts"

const { changes, users } = schema

/** The most Changes one page carries. */
export const HISTORY_LIMIT = 200

/** One Change as History lists it. */
export type ChangeSummary = {
  id: string
  author: { id: string; name: string; image: string | null }
  origin: ChangeOrigin
  label: string
  /** When the Change started (ISO 8601). */
  at: string
  /** Its first and last ops' `serverSeq` (other Changes may sit in between). */
  firstSeq: number
  lastSeq: number
}

export type HistoryPage = {
  headSeq: number
  /** Newest first (by `firstSeq`). */
  changes: ChangeSummary[]
  /** Older Changes remain: ask again with `before` = the last one's `firstSeq`. */
  more: boolean
}

export const HistoryQuery = z.object({
  expedition: z.string().min(1),
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(HISTORY_LIMIT)
    .default(HISTORY_LIMIT),
})

/**
 * A page of an Expedition's Changes; 404 when `userId` can't view the
 * Expedition (or there is none), 403 when they can but may not see its
 * History (a viewer, or anyone else where Visibility lets them read).
 */
export async function readHistory(
  db: Db,
  args: {
    expeditionId: string
    userId: string
    before?: number
    limit?: number
  }
): Promise<HistoryPage | 403 | 404> {
  const { expeditionId, userId } = args
  const limit = args.limit ?? HISTORY_LIMIT
  const a = await expeditionAccess(db, expeditionId, userId)
  if (!a) return 404
  if (!a.may("viewHistory")) return 403
  const rows = await db
    .select({
      id: changes.id,
      authorId: changes.author,
      name: users.name,
      image: users.image,
      origin: changes.origin,
      label: changes.label,
      at: changes.at,
      firstSeq: changes.firstSeq,
      lastSeq: changes.lastSeq,
    })
    .from(changes)
    .leftJoin(users, eq(users.id, changes.author))
    .where(
      and(
        eq(changes.expeditionId, expeditionId),
        args.before === undefined
          ? undefined
          : lt(changes.firstSeq, args.before)
      )
    )
    .orderBy(desc(changes.firstSeq))
    .limit(limit + 1)
  return {
    headSeq: a.headSeq,
    changes: rows.slice(0, limit).map((r) => ({
      id: r.id,
      // A deleted account keeps its Changes; it shows as "Someone".
      author: { id: r.authorId, name: r.name ?? "Someone", image: r.image },
      origin: r.origin,
      label: r.label,
      at: r.at,
      firstSeq: r.firstSeq,
      lastSeq: r.lastSeq,
    })),
    more: rows.length > limit,
  }
}

export function historyRoutes() {
  const r = new Hono<AppEnv>()
  r.get("/history", requireUser(), async (c) => {
    const q = HistoryQuery.safeParse(c.req.query())
    if (!q.success)
      return c.json({ error: "invalid query", issues: q.error.issues }, 400)
    const page = await readHistory(await c.var.db(), {
      expeditionId: q.data.expedition,
      userId: c.var.user.id,
      before: q.data.before,
      limit: q.data.limit,
    })
    if (page === 404) return c.json({ error: "Expedition not found" }, 404)
    if (page === 403)
      return c.json({ error: "only owners and editors see History" }, 403)
    return c.json(page)
  })
  return r
}
