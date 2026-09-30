// The tables as a materialized projection of the op log (spec §1.1, §1.2).
// `loadState` reads one Expedition's logged tables into @seply/domain's
// `DomainState`; `writeState` writes back what changed between two states.
// `apply` is copy-on-write, so an entity whose object is unchanged (`===`)
// was not touched and is not rewritten.
import {
  emptyState,
  relKey,
  schema,
  type ArticleSection,
  type AttributeDef,
  type Concept,
  type DomainState,
  type KindDefState,
  type Relationship,
  type RelTypeDefState,
  type Source,
  type View,
} from "@seply/domain"
import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import type { Db } from "./db.ts"

const {
  expeditions,
  expeditionTags,
  sources,
  concepts,
  conceptTags,
  articleSections,
  relationships,
  kindDefs,
  relTypeDefs,
  attributeDefs,
  views,
} = schema

/** Drops null (and undefined) values: optional fields are absent in the state. */
function present<T extends object>(row: T): T {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(row))
    if (v !== null && v !== undefined) out[k] = v
  return out as T
}

/** Postgres returns timestamps in its own format; the state holds ISO strings. */
const iso = (t: string | null) =>
  t === null ? null : new Date(t).toISOString()

/** Reads one Expedition's shared, logged state. Null when there is no such Expedition. */
export async function loadState(
  db: Db,
  expeditionId: string
): Promise<DomainState | null> {
  const [exp] = await db
    .select({
      title: expeditions.title,
      summary: expeditions.summary,
      status: expeditions.status,
      bestViewId: expeditions.bestViewId,
    })
    .from(expeditions)
    .where(eq(expeditions.id, expeditionId))
  if (!exp) return null
  const state = emptyState(expeditionId)

  const expTags = await db
    .select({ tag: expeditionTags.tag })
    .from(expeditionTags)
    .where(eq(expeditionTags.expeditionId, expeditionId))
  state.expedition = {
    ...state.expedition,
    ...exp,
    tags: expTags.map((t) => t.tag).sort(),
  }

  const tagsByConcept = new Map<string, string[]>()
  for (const t of await db
    .select({ conceptId: conceptTags.conceptId, tag: conceptTags.tag })
    .from(conceptTags)
    .where(eq(conceptTags.expeditionId, expeditionId))) {
    const list = tagsByConcept.get(t.conceptId) ?? []
    list.push(t.tag)
    tagsByConcept.set(t.conceptId, list)
  }
  for (const { expeditionId: _e, deletedAt, ...row } of await db
    .select()
    .from(concepts)
    .where(eq(concepts.expeditionId, expeditionId))) {
    void _e
    state.concepts[row.id] = {
      ...present(row),
      tags: (tagsByConcept.get(row.id) ?? []).sort(),
      deletedAt: iso(deletedAt),
    } as Concept
  }

  for (const { expeditionId: _e, deletedAt, ...row } of await db
    .select()
    .from(articleSections)
    .where(eq(articleSections.expeditionId, expeditionId))) {
    void _e
    state.sections[row.id] = {
      ...row,
      deletedAt: iso(deletedAt),
    } satisfies ArticleSection
  }

  for (const { expeditionId: _e, deletedAt, ...row } of await db
    .select()
    .from(relationships)
    .where(eq(relationships.expeditionId, expeditionId))) {
    void _e
    state.relationships[relKey(row.from, row.type, row.to)] = {
      ...present(row),
      deletedAt: iso(deletedAt),
    } as Relationship
  }

  for (const { expeditionId: _e, ...row } of await db
    .select()
    .from(kindDefs)
    .where(eq(kindDefs.expeditionId, expeditionId))) {
    void _e
    state.kinds[row.id] = present(row) as KindDefState
  }
  for (const { expeditionId: _e, ...row } of await db
    .select()
    .from(relTypeDefs)
    .where(eq(relTypeDefs.expeditionId, expeditionId))) {
    void _e
    state.relTypes[row.id] = present(row) as RelTypeDefState
  }
  for (const { expeditionId: _e, deletedAt, ...row } of await db
    .select()
    .from(attributeDefs)
    .where(eq(attributeDefs.expeditionId, expeditionId))) {
    void _e
    state.attributes[row.id] = {
      ...present(row),
      deletedAt: iso(deletedAt),
    } as AttributeDef
  }
  for (const { expeditionId: _e, deletedAt, ...row } of await db
    .select()
    .from(views)
    .where(eq(views.expeditionId, expeditionId))) {
    void _e
    state.views[row.id] = { ...present(row), deletedAt: iso(deletedAt) } as View
  }
  for (const { expeditionId: _e, addedAt, ...row } of await db
    .select()
    .from(sources)
    .where(eq(sources.expeditionId, expeditionId))) {
    void _e
    state.sources[row.id] = {
      ...present(row),
      addedAt: iso(addedAt)!,
    } as Source
  }
  return state
}

// --- writing ----------------------------------------------------------------

type Changed<T> = { upserts: T[]; removed: string[] }

/** Entities added or replaced in `after`, and keys gone from it. */
function changed<T>(
  before: Record<string, T>,
  after: Record<string, T>
): Changed<T> {
  const upserts: T[] = []
  const removed: string[] = []
  for (const [k, v] of Object.entries(after))
    if (before[k] !== v) upserts.push(v)
  for (const k of Object.keys(before)) if (!(k in after)) removed.push(k)
  return { upserts, removed }
}

const CHUNK = 500
function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}

/** `set` for ON CONFLICT DO UPDATE: every column except the key, from `excluded`. */
function excludedAll(
  table: PgTable,
  key: readonly string[]
): Record<string, SQL> {
  const set: Record<string, SQL> = {}
  for (const [prop, col] of Object.entries(getTableColumns(table))) {
    if (key.includes(prop)) continue
    set[prop] = sql.raw(`excluded."${col.name}"`)
  }
  return set
}

async function upsert<T extends PgTable>(
  db: Db,
  table: T,
  key: readonly (keyof T["$inferInsert"] & string)[],
  rows: T["$inferInsert"][]
) {
  if (!rows.length) return
  const cols = getTableColumns(table) as Record<
    string,
    PgTable["_"]["columns"][string]
  >
  const target = key.map((k) => cols[k]!)
  const set = excludedAll(table, key)
  for (const part of chunks(rows)) {
    await db
      .insert(table)
      .values(part as never)
      .onConflictDoUpdate({ target: target as never, set: set as never })
  }
}

const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v)

/** Writes the difference between two states of one Expedition to the tables. */
export async function writeState(
  db: Db,
  before: DomainState,
  after: DomainState
): Promise<void> {
  const exp = after.expedition.id
  const e0 = before.expedition
  const e1 = after.expedition
  if (e0 !== e1) {
    if (
      e0.title !== e1.title ||
      e0.summary !== e1.summary ||
      e0.status !== e1.status ||
      e0.bestViewId !== e1.bestViewId
    ) {
      await db
        .update(expeditions)
        .set({
          title: e1.title,
          summary: e1.summary,
          status: e1.status,
          bestViewId: e1.bestViewId,
        })
        .where(eq(expeditions.id, exp))
    }
    const gone = e0.tags.filter((t) => !e1.tags.includes(t))
    const added = e1.tags.filter((t) => !e0.tags.includes(t))
    if (gone.length)
      await db
        .delete(expeditionTags)
        .where(
          and(
            eq(expeditionTags.expeditionId, exp),
            inArray(expeditionTags.tag, gone)
          )
        )
    if (added.length)
      await db
        .insert(expeditionTags)
        .values(added.map((tag) => ({ expeditionId: exp, tag })))
        .onConflictDoNothing()
  }

  // Concepts, and their Tags.
  const c = changed(before.concepts, after.concepts)
  await upsert(
    db,
    concepts,
    ["expeditionId", "id"],
    c.upserts.map((x) => ({
      expeditionId: exp,
      id: x.id,
      title: x.title,
      aliases: x.aliases,
      kind: x.kind,
      summary: nul(x.summary),
      overview: nul(x.overview),
      overviewProv: x.overviewProv,
      attributes: x.attributes,
      date: nul(x.date),
      dateEnd: nul(x.dateEnd),
      dateApprox: nul(x.dateApprox),
      lane: nul(x.lane),
      lat: nul(x.lat),
      lon: nul(x.lon),
      weightPin: nul(x.weightPin),
      prov: x.prov,
      deletedAt: x.deletedAt,
    }))
  )
  const tagsGone: SQL[] = []
  const tagsAdded: { expeditionId: string; conceptId: string; tag: string }[] =
    []
  for (const x of c.upserts) {
    const prev = before.concepts[x.id]?.tags ?? []
    const gone = prev.filter((t) => !x.tags.includes(t))
    if (gone.length)
      tagsGone.push(
        and(eq(conceptTags.conceptId, x.id), inArray(conceptTags.tag, gone))!
      )
    for (const tag of x.tags)
      if (!prev.includes(tag))
        tagsAdded.push({ expeditionId: exp, conceptId: x.id, tag })
  }
  for (const cond of tagsGone)
    await db
      .delete(conceptTags)
      .where(and(eq(conceptTags.expeditionId, exp), cond))
  for (const part of chunks(tagsAdded))
    await db.insert(conceptTags).values(part).onConflictDoNothing()

  await upsert(
    db,
    articleSections,
    ["expeditionId", "id"],
    changed(before.sections, after.sections).upserts.map((x) => ({
      expeditionId: exp,
      ...x,
    }))
  )

  await upsert(
    db,
    relationships,
    ["expeditionId", "from", "type", "to"],
    changed(before.relationships, after.relationships).upserts.map((x) => ({
      expeditionId: exp,
      from: x.from,
      type: x.type,
      to: x.to,
      note: nul(x.note),
      prov: x.prov,
      deletedAt: x.deletedAt,
      deletedWith: nul(x.deletedWith),
    }))
  )

  // Kinds and Relationship Types: a built-in that is shown again loses its row.
  const k = changed(before.kinds, after.kinds)
  await upsert(
    db,
    kindDefs,
    ["expeditionId", "id"],
    k.upserts.map((x) => ({
      expeditionId: exp,
      id: x.id,
      label: nul(x.label),
      color: nul(x.color),
      icon: nul(x.icon),
      hidden: x.hidden,
    }))
  )
  if (k.removed.length)
    await db
      .delete(kindDefs)
      .where(
        and(eq(kindDefs.expeditionId, exp), inArray(kindDefs.id, k.removed))
      )
  const rt = changed(before.relTypes, after.relTypes)
  await upsert(
    db,
    relTypeDefs,
    ["expeditionId", "id"],
    rt.upserts.map((x) => ({
      expeditionId: exp,
      id: x.id,
      label: nul(x.label),
      inverseLabel: nul(x.inverseLabel),
      color: nul(x.color),
      dashed: nul(x.dashed),
      hidden: x.hidden,
    }))
  )
  if (rt.removed.length)
    await db
      .delete(relTypeDefs)
      .where(
        and(
          eq(relTypeDefs.expeditionId, exp),
          inArray(relTypeDefs.id, rt.removed)
        )
      )

  await upsert(
    db,
    attributeDefs,
    ["expeditionId", "id"],
    changed(before.attributes, after.attributes).upserts.map((x) => ({
      expeditionId: exp,
      id: x.id,
      label: x.label,
      type: x.type,
      unit: nul(x.unit),
      enumValues: nul(x.enumValues),
      deletedAt: x.deletedAt,
    }))
  )

  await upsert(
    db,
    views,
    ["expeditionId", "id"],
    changed(before.views, after.views).upserts.map((x) => ({
      expeditionId: exp,
      id: x.id,
      viewType: x.viewType,
      label: x.label,
      question: nul(x.question),
      orderKey: x.orderKey,
      settings: x.settings,
      settingsVersion: x.settingsVersion,
      status: x.status,
      failReason: nul(x.failReason),
      deletedAt: x.deletedAt,
    }))
  )

  // Sources are removed outright (`source.remove`); the blob outlives the row.
  const s = changed(before.sources, after.sources)
  await upsert(
    db,
    sources,
    ["expeditionId", "id"],
    s.upserts.map((x) => ({
      expeditionId: exp,
      id: x.id,
      kind: x.kind,
      title: x.title,
      blobKey: nul(x.blobKey),
      segmentsKey: nul(x.segmentsKey),
      mime: nul(x.mime),
      size: nul(x.size),
      addedBy: x.addedBy,
      addedAt: x.addedAt,
    }))
  )
  if (s.removed.length)
    await db
      .delete(sources)
      .where(and(eq(sources.expeditionId, exp), inArray(sources.id, s.removed)))
}
