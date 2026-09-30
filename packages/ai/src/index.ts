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
  BUILD_CAP_MULTIPLIER,
  DEFAULT_ASK_CAP_USD,
  estimateBuild,
  NOTE_OUTPUT,
  noteStepUsage,
  SOURCE_TOKEN_CAP,
  STEP,
  type BuildEstimate,
  type BuildEstimateInput,
  type StageEstimate,
} from "./estimate.ts"
export {
  meteredModel,
  SpendingCapReached,
  SpendMeter,
  type SpendKind,
  type SpendState,
} from "./spend.ts"
export { estimateFor, modelFor, type AiSetup } from "./setup.ts"
