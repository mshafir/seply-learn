// @umbel/sync: see README.md for this package's contract.
// Spike state (WP-0.5): the op engine and the TanStack DB wiring; WP-1.3
// builds the rest. The spike's simulator and flicker detector live in
// src/spike/ and are not exported.
export { OpEngine, type EngineListener, type EngineOptions } from "./engine.ts"
export {
  createEngineCollections,
  conceptEditToOps,
  type EngineCollections,
  type EngineCollectionsOptions,
} from "./collections.ts"
export {
  projectRows,
  TABLES,
  type ConceptRow,
  type RelationshipRow,
  type RowChange,
  type RowDiff,
  type TableName,
} from "./rows.ts"
