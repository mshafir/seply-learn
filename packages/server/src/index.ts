// @seply/server: see README.md for this package's contract.
export {
  createApp,
  requireUser,
  type AppEnv,
  type AppOptions,
  type AppVariables,
  type SessionUser,
} from "./app.ts"
export { createAuth, AUTH_BASE_PATH, type Auth } from "./auth.ts"
export {
  readConfig,
  isLocalURL,
  ConfigError,
  type ServerConfig,
  type ServerEnv,
} from "./config.ts"
export {
  connectPg,
  type Connect,
  type Db,
  type DbConnection,
  type Schema,
} from "./db.ts"
export {
  CreateExpedition,
  createExpedition,
  type ExpeditionSummary,
  type CardCollaborator,
  type LibraryCard,
  libraryCards,
} from "./expeditions.ts"
export {
  importExpedition,
  IMPORT_MAX_BYTES,
  type ImportCounts,
  type ImportResponse,
} from "./import.ts"
export { noopRelay, type Relay } from "./relay.ts"
export {
  readReaderState,
  recentPositions,
  saveReaderMarks,
  type ContinueReadingItem,
  type ReaderSnapshot,
} from "./reader.ts"
export {
  appendOps,
  readOps,
  PushError,
  type AppendResult,
  type ChangeInfo,
  type OpResult,
} from "./oplog.ts"
export { loadState, writeState } from "./projection.ts"
export {
  buildSearchQueries,
  parseQuery,
  search,
  searchableExpeditions,
  SearchQuery,
  SEARCH_MAX_LIMIT,
  type ConceptHit,
  type ExpeditionHit,
  type ParsedQuery,
  type SearchParams,
  type SearchResults,
  type TagHit,
} from "./search.ts"
export { PushBody, PullQuery, PUSH_LIMIT } from "./sync.ts"
export {
  aiRoutes,
  MAX_ASK_CAP_USD,
  readAiSettings,
  resolveAi,
  type AiOverview,
  type AiResolution,
  type AiSettings,
  type AiUnavailable,
} from "./ai.ts"
export { readAiConfig, type AiConfig, type AiKeyMode } from "./ai-config.ts"
export {
  deleteKey,
  importMasterKey,
  listKeys,
  loadKey,
  openKey,
  saveKey,
  sealKey,
  type KeySummary,
  type Sealed,
} from "./ai-keys.ts"
