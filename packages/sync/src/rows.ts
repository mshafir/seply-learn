// Row projection: DomainState → one keyed row map per table, and the row
// diffs the op engine emits. The spike projects two tables (Concepts and
// Relationships), live entities only; WP-1.3 adds the rest with drizzle-zod
// row types.
import {
  isLive,
  relKey,
  type Concept,
  type DomainState,
  type Relationship,
} from "@umbel/domain"

export type ConceptRow = Concept
export type RelationshipRow = Relationship & { key: string }

export type RowsByTable = {
  concepts: ConceptRow
  relationships: RelationshipRow
}
export type TableName = keyof RowsByTable
export const TABLES: readonly TableName[] = ["concepts", "relationships"]

export type RowChange = {
  table: TableName
  type: "insert" | "update" | "delete"
  key: string
  value: object
}
/** Every row change of one engine step: one begin/commit per table. */
export type RowDiff = RowChange[]

export function projectRows(
  state: DomainState
): Record<TableName, Map<string, object>> {
  const concepts = new Map<string, object>()
  for (const c of Object.values(state.concepts))
    if (isLive(c)) concepts.set(c.id, c)
  const relationships = new Map<string, object>()
  for (const r of Object.values(state.relationships)) {
    if (!isLive(r)) continue
    const key = relKey(r.from, r.type, r.to)
    relationships.set(key, { ...r, key })
  }
  return { concepts, relationships }
}
