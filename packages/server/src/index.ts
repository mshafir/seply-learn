// @seply/server: see README.md for this package's contract.
export {
  createApp,
  requireUser,
  type AppEnv,
  type AppOptions,
  type AppVariables,
  type SessionUser,
} from "./app.ts"
export {
  memoryBlobStore,
  r2BlobStore,
  sourceBlobKeys,
  type BlobMeta,
  type BlobStore,
  type R2BucketLike,
  type StoredBlob,
} from "./blobs.ts"
export {
  parseFile,
  parsePaste,
  parsePrompt,
  SourceError,
  type ParsedSource,
} from "./sources/parse.ts"
export {
  addSource,
  readSegments,
  removeSource,
  type AddedSource,
} from "./sources/store.ts"
export { PasteBody } from "./sources/routes.ts"
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
export {
  noopRelay,
  publishBuild,
  publishCommitted,
  type Relay,
  type RoomJoin,
} from "./relay.ts"
export {
  instanceId,
  jobRegistry,
  STEP_DEFAULTS,
  type Job,
  type JobContext,
  type JobDefinition,
  type JobDeps,
  type JobEngine,
  type JobNotification,
  type JobPayload,
  type JobRegistry,
  type JobRunner,
  type Json,
  type Progress,
  type StepOptions,
  type Steps,
} from "./jobs/types.ts"
export { failureReason, runJob } from "./jobs/host.ts"
export { createJobRunner, JobError } from "./jobs/runner.ts"
export { createInlineEngine, type InlineEngine } from "./jobs/inline.ts"
export { fakeJob, fakeViewLabel, FakeJobInput } from "./jobs/fake.ts"
export { JOB_KINDS } from "./jobs/registry.ts"
export {
  encryptPayload,
  notifyUser,
  readVapid,
  saveSubscription,
  sendPush,
  vapidAuthorization,
  type PushResult,
  type PushSubscriptionJson,
  type VapidKeys,
} from "./push/index.ts"
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
export {
  BuildBody,
  createFlowRoutes,
  MAX_PLAN_VIEWS,
  PlanBody,
  SkimBody,
  SKIM_TIMEOUT_MS,
  startBuild,
  type BuildRequest,
  type BuildStart,
  type Draft,
  type DraftSource,
  type DraftView,
} from "./create.ts"
