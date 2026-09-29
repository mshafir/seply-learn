// Global search (spec §2.8): Postgres full-text over the maintained `search`
// columns (migration 0001), `websearch_to_tsquery` for the text and pg_trgm
// for fuzzy titles and aliases. Results come in three groups: Expeditions,
// Concepts (with their Expedition) and Tags. `#tag` in the query filters by
// Concept or Expedition Tags.
//
// Access is enforced in the SQL: an Expedition is searched only when the user
// collaborates on it (any role), or, with `includePublic`, when it is public.
// Unlisted Expeditions never appear to strangers, and Trash never appears.
import { sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"

/** A search box's text, split into free text and `#tag` filters. */
export type ParsedQuery = {
  /** Free text, for `websearch_to_tsquery` and the fuzzy title match. */
  text: string
  /** Tag filters, lower-cased, without `#`; a result must carry all of them. */
  tags: string[]
  /** What the Tags group suggests by prefix: the text, else the last `#tag`. */
  tagPrefix: string
}

export type SearchParams = {
  userId: string
  q: string
  includePublic?: boolean
  limit?: number
}

export type ExpeditionHit = {
  id: string
  title: string
  summary: string
  visibility: "private" | "unlisted" | "public"
  /** Mine (owner, editor, viewer), or null for someone else's public one. */
  role: "owner" | "editor" | "viewer" | null
}

export type ConceptHit = {
  id: string
  expeditionId: string
  expeditionTitle: string
  title: string
  kind: string
  summary: string | null
}

export type TagHit = {
  tag: string
  /** Concepts and Expeditions carrying it, among those searched. */
  count: number
}

export type SearchResults = {
  expeditions: ExpeditionHit[]
  concepts: ConceptHit[]
  tags: TagHit[]
}

export const SEARCH_MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

// Tags are free-form but never contain whitespace; trailing punctuation typed
// after a tag ("#gpu,") is not part of it.
const TAG = /^#([^\s#]+?)[.,;:!?]*$/

export function parseQuery(raw: string): ParsedQuery {
  const words = raw.trim().split(/\s+/).filter(Boolean)
  const text: string[] = []
  const tags: string[] = []
  for (const w of words) {
    const m = TAG.exec(w)
    if (m) tags.push(m[1]!.toLowerCase())
    else if (w !== "#") text.push(w)
  }
  const joined = text.join(" ")
  return {
    text: joined,
    tags: [...new Set(tags)],
    tagPrefix: joined ? joined.toLowerCase() : (tags.at(-1) ?? ""),
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * The Expeditions the user may search: theirs (any role), plus public ones
 * when `includePublic`; never Trash. A FROM item exposing `id`, `title`,
 * `summary`, `visibility`, `search` and `role`.
 */
export function searchableExpeditions(
  userId: string,
  includePublic: boolean
): SQL {
  return sql`(
    SELECT e.id, e.title, e.summary, e.visibility, e.search, col.role
    FROM expeditions e
    LEFT JOIN collaborators col
      ON col.expedition_id = e.id AND col.user_id = ${userId}
    WHERE e.deleted_at IS NULL
      AND (col.user_id IS NOT NULL
        OR (${includePublic}::boolean AND e.visibility = 'public'))
  )`
}

const tsquery = (text: string) => sql`websearch_to_tsquery('english', ${text})`

/** The row must carry every tag (`exists` tests one). */
function tagFilter(tags: string[], exists: (tag: string) => SQL): SQL {
  if (!tags.length) return sql`true`
  return sql.join(
    tags.map((t) => exists(t)),
    sql` AND `
  )
}

/** The three queries behind one search (null when there is nothing to search for). */
export function buildSearchQueries(
  params: SearchParams
): { expeditions: SQL; concepts: SQL; tags: SQL | null } | null {
  const { text, tags, tagPrefix } = parseQuery(params.q)
  if (!text && !tags.length) return null
  const limit = Math.min(
    Math.max(1, params.limit ?? DEFAULT_LIMIT),
    SEARCH_MAX_LIMIT
  )
  const access = searchableExpeditions(
    params.userId,
    params.includePublic ?? false
  )

  // Free text matches the full-text vector or, fuzzily, the title (and a
  // Concept's aliases): pg_trgm's similarity (`%`, a typo in a short title)
  // or word similarity (`<%`, a word within a long one), both GIN-indexed.
  // Rank: full-text rank plus title similarity.
  const expMatch = text
    ? sql`(e.search @@ ${tsquery(text)} OR ${text} % e.title OR ${text} <% e.title)`
    : sql`true`
  const expRank = text
    ? sql`ts_rank_cd(e.search, ${tsquery(text)}) + word_similarity(${text}, e.title) DESC,`
    : sql``
  const expeditions = sql`
    SELECT e.id, e.title, e.summary, e.visibility, e.role
    FROM ${access} e
    WHERE ${expMatch}
      AND ${tagFilter(
        tags,
        (t) => sql`EXISTS (SELECT 1 FROM expedition_tags et
          WHERE et.expedition_id = e.id AND lower(et.tag) = ${t})`
      )}
    ORDER BY ${expRank} e.id DESC
    LIMIT ${Math.min(limit, 10)}`

  const conceptMatch = text
    ? sql`(c.search @@ ${tsquery(text)} OR ${text} % c.search_title
        OR ${text} <% c.search_title)`
    : sql`true`
  const conceptRank = text
    ? sql`ts_rank_cd(c.search, ${tsquery(text)}) + word_similarity(${text}, c.search_title) DESC,`
    : sql``
  const concepts = sql`
    SELECT c.id, c.expedition_id, e.title AS expedition_title, c.title, c.kind, c.summary
    FROM ${access} e
    JOIN concepts c ON c.expedition_id = e.id AND c.deleted_at IS NULL
    WHERE ${conceptMatch}
      AND ${tagFilter(
        tags,
        (t) => sql`EXISTS (SELECT 1 FROM concept_tags ct
          WHERE ct.expedition_id = c.expedition_id AND ct.concept_id = c.id
            AND lower(ct.tag) = ${t})`
      )}
    ORDER BY ${conceptRank} c.title ASC, c.id ASC
    LIMIT ${limit}`

  // Tags by prefix, Concept and Expedition Tags together, most used first.
  const prefix = `${escapeLike(tagPrefix)}%`
  const tagsQuery = tagPrefix
    ? sql`
    SELECT tag, count(*)::int AS count FROM (
      SELECT lower(ct.tag) AS tag
      FROM ${access} e
      JOIN concept_tags ct ON ct.expedition_id = e.id
      JOIN concepts c ON c.expedition_id = ct.expedition_id
        AND c.id = ct.concept_id AND c.deleted_at IS NULL
      WHERE lower(ct.tag) LIKE ${prefix}
      UNION ALL
      SELECT lower(et.tag) AS tag
      FROM ${access} e
      JOIN expedition_tags et ON et.expedition_id = e.id
      WHERE lower(et.tag) LIKE ${prefix}
    ) t
    GROUP BY tag
    ORDER BY count DESC, tag ASC
    LIMIT 8`
    : null

  return { expeditions, concepts, tags: tagsQuery }
}

type Rows<T> = { rows: T[] }
const rows = async <T>(db: Db, q: SQL) =>
  ((await db.execute(q)) as unknown as Rows<T>).rows

/** Runs a global search for `params.userId` (see `buildSearchQueries`). */
export async function search(
  db: Db,
  params: SearchParams
): Promise<SearchResults> {
  const qs = buildSearchQueries(params)
  if (!qs) return { expeditions: [], concepts: [], tags: [] }
  const [exps, concepts, tags] = await Promise.all([
    rows<ExpeditionHit>(db, qs.expeditions),
    rows<{
      id: string
      expedition_id: string
      expedition_title: string
      title: string
      kind: string
      summary: string | null
    }>(db, qs.concepts),
    qs.tags ? rows<TagHit>(db, qs.tags) : Promise.resolve([]),
  ])
  return {
    expeditions: exps.map((e) => ({ ...e, role: e.role ?? null })),
    concepts: concepts.map((c) => ({
      id: c.id,
      expeditionId: c.expedition_id,
      expeditionTitle: c.expedition_title,
      title: c.title,
      kind: c.kind,
      summary: c.summary,
    })),
    tags: tags.map((t) => ({ tag: t.tag, count: Number(t.count) })),
  }
}

export const SearchQuery = z.object({
  q: z.string().max(500).default(""),
  public: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((v) => v === "1" || v === "true"),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
})

/** GET /search?q=&public=1&limit=: runs behind `requireUser`. */
export function searchRoutes() {
  const r = new Hono<AppEnv>()
  r.get("/", async (c) => {
    const q = SearchQuery.safeParse(c.req.query())
    if (!q.success)
      return c.json({ error: "invalid query", issues: q.error.issues }, 400)
    const db = await c.var.db()
    const results = await search(db, {
      userId: c.var.user.id,
      q: q.data.q,
      includePublic: q.data.public,
      limit: q.data.limit,
    })
    return c.json(results)
  })
  return r
}
