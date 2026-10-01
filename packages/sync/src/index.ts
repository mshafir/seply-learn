// @seply/sync: see README.md for this package's contract.
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
  HistoryError,
  restoreInEngine,
  stateAsOfIn,
  undoInEngine,
  type HistoryActionOptions,
  type HistoryActionResult,
  type HistoryErrorReason,
} from "./history.ts"
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
export {
  ANONYMOUS_SCOPE,
  fetchReaderTransport,
  ReaderClient,
  type PositionInput,
  type ReaderChannel,
  type ReaderClientOptions,
  type ReaderSaveResult,
  type ReaderSnapshot,
  type ReaderTransport,
} from "./reader.ts"
export {
  IndexedDbReaderStore,
  MemoryReaderStore,
  recordKey,
  type IndexedDbReaderStoreOptions,
  type MarkRecord,
  type ReaderStore,
} from "./reader-store.ts"
export {
  RoomClient,
  roomUrl,
  type RoomClientOptions,
  type RoomListener,
  type RoomStatus,
} from "./room.ts"
export {
  fetchSnapshot,
  IndexedDbOfflineCacheStore,
  MemoryOfflineCacheStore,
  OFFLINE_KEEP,
  OfflineCache,
  openCachedClient,
  toEvict,
  type IndexedDbOfflineCacheStoreOptions,
  type OfflineCacheOptions,
  type OfflineCacheStore,
  type OfflineEntry,
  type OfflineSnapshot,
} from "./offline-cache.ts"
