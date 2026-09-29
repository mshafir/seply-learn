// @umbel/sync: see README.md for this package's contract.
// The flicker tests' simulator and detector live in src/spike/ and are not
// exported.
export {
  OpEngine,
  type ChangeMeta,
  type ClientOrigin,
  type EngineListener,
  type EngineOptions,
  type OpenChange,
  type PendingSnapshot,
  type ProposeOptions,
} from "./engine.ts"
export {
  createEngineCollections,
  type EngineCollections,
  type EngineCollectionsOptions,
  type MutationFn,
  type TableCollections,
} from "./collections.ts"
export {
  mutationsToOps,
  UnsupportedEditError,
  type RowMutation,
} from "./mutations.ts"
export {
  openSyncClient,
  PUSH_LIMIT,
  SyncClient,
  type SyncClientOptions,
  type SyncStatus,
} from "./client.ts"
export {
  fetchTransport,
  SyncHttpError,
  type FetchTransportOptions,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncTransport,
} from "./transport.ts"
export {
  IndexedDbPendingStore,
  MemoryPendingStore,
  type IndexedDbPendingStoreOptions,
  type PendingScope,
  type PendingStore,
} from "./store.ts"
export { monotonicUlid } from "./ids.ts"
export {
  projectRows,
  rowOf,
  RowProjection,
  TABLES,
  type ArticleSectionRow,
  type AttributeDefRow,
  type ConceptRow,
  type ExpeditionRow,
  type KindDefRow,
  type RelationshipRow,
  type RelTypeDefRow,
  type RowChange,
  type RowDiff,
  type RowsByTable,
  type SourceRow,
  type TableName,
  type ViewRow,
} from "./rows.ts"
