// Row projection: DomainState → one keyed row map per table, the row diffs
// the op engine emits, and the way back (a row written into a state, which is
// how collection mutations become ops; see mutations.ts).
//
// One table per logged table of the domain schema (spec §1.2), named like its
// `schema.*` export. Tags are fields of their Concept or Expedition row
// (`concept_tags` / `expedition_tags` fold into `tags`). Tombstoned entities
// are not rows: the collections show live state only.
import {
  deepEqual,
  isLive,
  type ArticleSection,
  type AttributeDef,
  type Concept,
  type DomainState,
  type EntityType,
  type ExpeditionState,
  type KindDefState,
  type RelTypeDefState,
  type Relationship,
  type Source,
  type View,
} from "@seply/domain"

export type ExpeditionRow = ExpeditionState
export type ConceptRow = Concept
export type ArticleSectionRow = ArticleSection
/** Keyed by `relKey(from, type, to)`, which never changes for a row. */
export type RelationshipRow = Relationship & { key: string }
/** Custom Kinds, and rows that hide a built-in (no label). */
export type KindDefRow = KindDefState
export type RelTypeDefRow = RelTypeDefState
export type AttributeDefRow = AttributeDef
export type ViewRow = View
export type SourceRow = Source

export type RowsByTable = {
  expeditions: ExpeditionRow
  concepts: ConceptRow
  articleSections: ArticleSectionRow
  relationships: RelationshipRow
  kindDefs: KindDefRow
  relTypeDefs: RelTypeDefRow
  attributeDefs: AttributeDefRow
  views: ViewRow
  sources: SourceRow
}
export type TableName = keyof RowsByTable
export const TABLES = [
  "expeditions",
  "concepts",
  "articleSections",
  "relationships",
  "kindDefs",
  "relTypeDefs",
  "attributeDefs",
  "views",
  "sources",
] as const satisfies readonly TableName[]

/** The DomainState record behind each table (the Expedition is one record). */
type StateKey = Exclude<keyof DomainState, "expedition">
const STATE_KEY: Record<Exclude<TableName, "expeditions">, StateKey> = {
  concepts: "concepts",
  articleSections: "sections",
  relationships: "relationships",
  kindDefs: "kinds",
  relTypeDefs: "relTypes",
  attributeDefs: "attributes",
  views: "views",
  sources: "sources",
}
/** The @seply/domain field-level entity type of each table (for `opsToReach`). */
export const ENTITY: Record<TableName, EntityType> = {
  expeditions: "exp",
  concepts: "concept",
  articleSections: "section",
  relationships: "rel",
  kindDefs: "kind",
  relTypeDefs: "reltype",
  attributeDefs: "attr",
  views: "view",
  sources: "source",
}

export type RowChange = {
  table: TableName
  type: "insert" | "update" | "delete"
  key: string
  value: object
}
/** Every row change of one engine step: one begin/commit per table. */
export type RowDiff = RowChange[]

type Entities = Readonly<Record<string, object>>

function entitiesOf(state: DomainState, table: TableName): Entities {
  if (table === "expeditions")
    return { [state.expedition.id]: state.expedition }
  return state[STATE_KEY[table]] as Entities
}
/** Identity of a table's entities: unchanged identity means unchanged rows. */
const identityOf = (state: DomainState, table: TableName): object =>
  table === "expeditions" ? state.expedition : state[STATE_KEY[table]]

/** One entity as a row, or undefined when it isn't live. */
function toRow(table: TableName, key: string, e: object): object | undefined {
  if ("deletedAt" in e && !isLive(e as { deletedAt: string | null }))
    return undefined
  if (table === "relationships") return { ...e, key }
  return e
}

/** One row of a state, or undefined. */
export function rowOf<T extends TableName>(
  state: DomainState,
  table: T,
  key: string
): RowsByTable[T] | undefined {
  const e = entitiesOf(state, table)[key]
  return e ? (toRow(table, key, e) as RowsByTable[T] | undefined) : undefined
}

/** Every table's rows (live entities only). */
export function projectRows(
  state: DomainState
): Record<TableName, Map<string, object>> {
  const out = {} as Record<TableName, Map<string, object>>
  for (const table of TABLES) {
    const rows = new Map<string, object>()
    for (const [key, e] of Object.entries(entitiesOf(state, table))) {
      const row = toRow(table, key, e)
      if (row) rows.set(key, row)
    }
    out[table] = rows
  }
  return out
}

/**
 * Keeps the rows of the last published state and diffs the next one against
 * them. `apply` copies on write, so an entity (or a whole table) whose
 * identity didn't change is skipped; changed entities are compared by value,
 * so a rebase that rebuilds an entity with the same values emits nothing.
 */
export class RowProjection {
  private rows: Record<TableName, Map<string, object>>
  private entities: Map<TableName, Entities>
  private identity: Map<TableName, object>

  constructor(state: DomainState) {
    this.rows = projectRows(state)
    this.entities = new Map(TABLES.map((t) => [t, entitiesOf(state, t)]))
    this.identity = new Map(TABLES.map((t) => [t, identityOf(state, t)]))
  }

  rowsOf(table: TableName): ReadonlyMap<string, object> {
    return this.rows[table]
  }

  update(state: DomainState): RowDiff {
    const diff: RowDiff = []
    for (const table of TABLES) {
      const id = identityOf(state, table)
      if (this.identity.get(table) === id) continue
      const prev = this.entities.get(table)!
      const next = entitiesOf(state, table)
      const rows = this.rows[table]
      for (const [key, e] of Object.entries(next)) {
        if (prev[key] === e) continue
        const row = toRow(table, key, e)
        const old = rows.get(key)
        if (!row) {
          if (old) {
            rows.delete(key)
            diff.push({ table, type: "delete", key, value: old })
          }
        } else if (!old) {
          rows.set(key, row)
          diff.push({ table, type: "insert", key, value: row })
        } else if (!deepEqual(old, row)) {
          rows.set(key, row)
          diff.push({ table, type: "update", key, value: row })
        }
      }
      for (const key of Object.keys(prev)) {
        if (key in next) continue
        const old = rows.get(key)
        if (old) {
          rows.delete(key)
          diff.push({ table, type: "delete", key, value: old })
        }
      }
      this.entities.set(table, next)
      this.identity.set(table, id)
    }
    return diff
  }
}

const TOMBSTONE = "1970-01-01T00:00:00.000Z"

/**
 * Writes one row into a state (a sketch of the wanted state, for turning
 * mutations into ops): `undefined` deletes it the way the table deletes
 * (a tombstone, or gone for Sources, Kinds and Relationship Types).
 */
export function writeRow(
  state: DomainState,
  table: TableName,
  key: string,
  row: object | undefined
): DomainState {
  if (table === "expeditions") {
    if (key !== state.expedition.id || !row)
      throw new Error("the Expedition row can only be updated")
    const { id, title, summary, status, bestViewId, tags } =
      row as ExpeditionRow
    return {
      ...state,
      expedition: { id, title, summary, status, bestViewId, tags },
    }
  }
  const stateKey = STATE_KEY[table]
  const rec = { ...(state[stateKey] as Record<string, object>) }
  if (row) {
    let entity: object = row
    if (table === "relationships") {
      const { key: _k, ...rel } = row as RelationshipRow
      void _k
      entity = rel
    }
    rec[key] = entity
  } else {
    const cur = rec[key]
    if (cur && "deletedAt" in cur) rec[key] = { ...cur, deletedAt: TOMBSTONE }
    else delete rec[key]
  }
  return { ...state, [stateKey]: rec }
}
