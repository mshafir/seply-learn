// Explore (spec §3.13): every public Expedition, for anyone, signed in or
// not. Public means "listed and searchable" (spec §1); unlisted and private
// Expeditions never appear, and neither do Trash or drafts. Cards carry no
// people: no owner, collaborators, names, emails or avatars.
import type { ViewTypeId } from "@seply/domain"
import { sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { cardDetails } from "./expeditions.ts"
import { expeditionMatch, parseQuery } from "./search.ts"

/** One Explore card: a Library card without people, role or status. */
export type ExploreCard = {
  id: string
  title: string
  summary: string
  tags: string[]
  counts: { concepts: number; views: number }
  bestViewType: ViewTypeId | null
  updatedAt: string
}

export type ExplorePage = {
  expeditions: ExploreCard[]
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null
  /** The Expedition Tags most used across Explore (first page only). */
  tags: { tag: string; count: number }[]
}

export const EXPLORE_PAGE_SIZE = 24
const TAG_LIMIT = 30

export type ExploreParams = {
  q?: string
  tag?: string
  cursor?: string
  limit?: number
}

/** `<ms>_<id>`: the last card's latest Change (epoch ms) and its id. */
const CURSOR = /^(\d{1,16})_([0-9A-Za-z]{1,64})$/

/** What every listed Expedition must be. */
const listed = sql`e.deleted_at IS NULL AND e.visibility = 'public' AND e.status <> 'draft'`

type Rows<T> = { rows: T[] }
const rows = async <T>(db: Db, q: SQL) =>
  ((await db.execute(q)) as unknown as Rows<T>).rows

/** One page of public Expeditions, latest Change first. */
export async function explore(
  db: Db,
  params: ExploreParams
): Promise<ExplorePage> {
  const { text, tags } = parseQuery(params.q ?? "")
  const tag = params.tag?.trim().replace(/^#/, "").toLowerCase()
  const allTags = [...new Set([...tags, ...(tag ? [tag] : [])])]
  const limit = Math.min(
    Math.max(1, params.limit ?? EXPLORE_PAGE_SIZE),
    EXPLORE_PAGE_SIZE
  )
  const cur = params.cursor ? CURSOR.exec(params.cursor) : null

  const tagMatch = allTags.length
    ? sql.join(
        allTags.map(
          (t) => sql`EXISTS (SELECT 1 FROM expedition_tags et
            WHERE et.expedition_id = e.id AND lower(et.tag) = ${t})`
        ),
        sql` AND `
      )
    : sql`true`
  const after = cur
    ? sql`(p.ms, p.id) < (${Number(cur[1])}::bigint, ${cur[2]})`
    : sql`true`

  // The latest Change's time, floored to ms, so the cursor compares exactly.
  const page = rows<{
    id: string
    title: string
    summary: string
    ms: string | number
  }>(
    db,
    sql`
    SELECT p.id, p.title, p.summary, p.ms FROM (
      SELECT e.id, e.title, e.summary,
        coalesce((SELECT floor(extract(epoch from max(ch.at)) * 1000)::bigint
          FROM changes ch WHERE ch.expedition_id = e.id), 0) AS ms
      FROM expeditions e
      WHERE ${listed} AND ${expeditionMatch(text)} AND ${tagMatch}
    ) p
    WHERE ${after}
    ORDER BY p.ms DESC, p.id DESC
    LIMIT ${limit + 1}`
  )
  const popular = cur
    ? Promise.resolve([])
    : rows<{ tag: string; count: number }>(
        db,
        sql`
        SELECT lower(et.tag) AS tag, count(*)::int AS count
        FROM expeditions e
        JOIN expedition_tags et ON et.expedition_id = e.id
        WHERE ${listed}
        GROUP BY lower(et.tag)
        ORDER BY count DESC, tag ASC
        LIMIT ${TAG_LIMIT}`
      )
  const [found, tagRows] = await Promise.all([page, popular])

  const shown = found.slice(0, limit)
  const details = await cardDetails(
    db,
    shown.map((r) => r.id)
  )
  const last = shown.at(-1)
  return {
    expeditions: shown.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      ...details.get(r.id)!,
    })),
    nextCursor: found.length > limit && last ? `${last.ms}_${last.id}` : null,
    tags: tagRows.map((t) => ({ tag: t.tag, count: Number(t.count) })),
  }
}

export const ExploreQuery = z.object({
  q: z.string().max(500).default(""),
  tag: z.string().max(100).optional(),
  cursor: z.string().regex(CURSOR).optional(),
})

/** GET /explore?q=&tag=&cursor=: no sign-in needed. */
export function exploreRoutes() {
  const r = new Hono<AppEnv>()
  r.get("/", async (c) => {
    const q = ExploreQuery.safeParse(c.req.query())
    if (!q.success)
      return c.json({ error: "invalid query", issues: q.error.issues }, 400)
    const db = await c.var.db()
    return c.json(await explore(db, q.data))
  })
  return r
}
