// @seply/ai: see README.md for this package's contract.
export {
  BYOK_PROVIDERS,
  ByokProvider,
  DEFAULT_MODELS,
  ModelId,
  ModelOverrides,
  PROVIDER_LABELS,
  PROVIDERS,
  ProviderId,
  Stage,
  STAGE_TIER,
  STAGES,
  stageModels,
  type StageModels,
  type Tier,
} from "./models.ts"
export {
  ApiKey,
  languageModel,
  last4,
  testKey,
  type Credentials,
  type KeyTest,
  type ProviderOptions,
} from "./providers.ts"
export {
  addUsage,
  canonicalModelId,
  costOf,
  costOfCall,
  FALLBACK_PRICE,
  gatewayCost,
  priceOf,
  PRICES,
  tokenUsage,
  ZERO_USAGE,
  type Price,
  type PriceLookup,
  type TokenUsage,
} from "./pricing.ts"
export {
  CHARS_PER_TOKEN,
  estimateTokens,
  tokenizerFamily,
  tokensForChars,
  type TokenizerFamily,
} from "./tokens.ts"
export {
  ARTICLE_LENGTH_IDS,
  ARTICLE_LENGTHS,
  ARTICLE_TOKENS_PER_WORD,
  BUILD_CAP_MULTIPLIER,
  DEFAULT_ASK_CAP_USD,
  estimateArticle,
  estimateBuild,
  NOTE_OUTPUT,
  noteStepUsage,
  SOURCE_TOKEN_CAP,
  STEP,
  type ArticleLength,
  type BuildEstimate,
  type BuildEstimateInput,
  type StageEstimate,
} from "./estimate.ts"
export {
  combineSpend,
  meteredModel,
  SpendingCapReached,
  SpendMeter,
  type SpendKind,
  type SpendState,
} from "./spend.ts"
export { estimateFor, modelFor, type AiSetup } from "./setup.ts"

// The curator's tools and checks (spec §5.3)
export {
  createCuratorTools,
  TOOL_NAMES,
  type CommitResult,
  type CuratorCommit,
  type CuratorTool,
  type CuratorToolSet,
  type CuratorToolsOptions,
  type ToolResult,
} from "./tools.ts"
export { StagingArea, type StagingResult } from "./stage.ts"
export { inspectView, type ViewInspection } from "./inspect.ts"
export {
  checkExpedition,
  checkView,
  MIN_FILL,
  MIN_ROWS,
  type Finding,
} from "./checks/index.ts"
export { normalizeTitle, searchExisting, type SearchHit } from "./search.ts"
export {
  memorySourceReader,
  type LayoutReport,
  type Segment,
  type SourceReader,
  type ViewReader,
  type ViewReading,
} from "./ports.ts"

// The curator's build stages (spec §5.2) and the playbook (spec §5.4)
export {
  applyBodies,
  autoMerge,
  buildView,
  conceptCount,
  conceptSetLabel,
  describeConcepts,
  duplicateCandidates,
  extractConcepts,
  MAX_STEPS,
  mergeConceptSet,
  previewNodes,
  understand,
  type ConceptStageResult,
  type StageOptions,
  type ViewPlan,
  type ViewStageResult,
} from "./curator/curator.ts"
export {
  CHUNK_TOKENS,
  chunkFilter,
  planSources,
  renderSourceIndex,
  renderSources,
  WHOLE_SOURCE_MAX_TOKENS,
  type CuratorSource,
  type SourcePlan,
} from "./curator/sources.ts"
export { rollCache, runLoop, type LoopOptions, type LoopResult } from "./curator/loop.ts"
export { playbook, viewTypeDoc } from "./curator/playbook.ts"
export { PLAYBOOK_FILES, VIEW_TYPE_DOCS } from "./playbook/generated.ts"
export type { LanguageModelV4 } from "@ai-sdk/provider"
// The skim (spec §5.2 step 2) and the playbook it reads
export {
  GOAL_LABELS,
  Goal,
  GOALS,
  normalizeSkim,
  ProposedView,
  runSkim,
  SKIM_COUNTS,
  SKIM_SAMPLE,
  SKIM_VIEW_TYPES,
  SkimOutput,
  skimPrompt,
  SkimResult,
  skimSample,
  skimSystem,
  VIEW_TYPE_CATALOG,
  type CatalogEntry,
  type ExistingView,
  type SkimRequest,
  type SkimRun,
  type SkimSource,
} from "./skim.ts"
export { startingSettings, UNSET_ATTRIBUTE } from "./plan.ts"
// The writers (spec §5.2 step 4)
export {
  ArticleOutput,
  CORE_FALLBACK,
  coreConcepts,
  OverviewOutput,
  planWriters,
  unresolvedProv,
  writeArticles,
  writeBatch,
  writeOverviews,
  writerInstructions,
  writerLabel,
  WRITER_BATCH,
  type ProvRepair,
  type WriteOptions,
  type WriteResult,
  type WriterMode,
  type WriterPlan,
} from "./writers/writers.ts"
