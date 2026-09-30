// The build estimate shown before Create (spec §5.6): the skim, the curator
// agent's reads (with prompt caching) and tool loop, and the writers, priced
// per stage model. The spending cap is 2× the estimate.
//
// The per-step shapes below (how many tool steps, how many tokens each writes)
// are the pipeline's design figures from spec §5.2 and the seeding prototype.
// The token and price arithmetic under them is checked against real calls on
// the fixtures (estimate.test.ts). Re-fit the step figures once the curator
// (WP-3.5b) and writers (WP-3.6) record real builds.
import type { ProviderId, Stage, StageModels } from "./models.ts"
import {
  addUsage,
  costOf,
  priceOf,
  ZERO_USAGE,
  type TokenUsage,
} from "./pricing.ts"
import {
  tokenizerFamily,
  tokensForChars,
  type TokenizerFamily,
} from "./tokens.ts"

/** Default spending cap on a build: this many times its estimate. */
export const BUILD_CAP_MULTIPLIER = 2
/** Default per-ask spending cap (Grow, spec §5.5), in USD. */
export const DEFAULT_ASK_CAP_USD = 0.5
/**
 * Per-Expedition cap on Source tokens (spec §5.6), shown up front. The
 * curator reads the whole Source set in one context, so it stays well
 * inside a 1M-token window with the playbook and the tool loop's history.
 */
export const SOURCE_TOKEN_CAP = 500_000

/** The understanding-note step, as scripts/measure-estimate.ts runs it. */
export const NOTE_INSTRUCTIONS = [
  "You are the curator of an Expedition: a body of knowledge on one subject,",
  "built from the Source below. Before building anything, write an",
  "understanding note for yourself: what the reader wanted, what they decided,",
  "and what is still open. Plain prose, at most 300 words.",
].join(" ")

/** Design figures, in tokens unless noted. */
export const STEP = {
  /** The playbook the curator carries: contract, extract and build-view. */
  curatorPrompt: 12_000,
  /** The skim prompt plus the View Type catalog. */
  skimPrompt: 6_000,
  /** The skim reads a sample: first and last segments, user turns, headings. */
  skimSampleMax: 20_000,
  skimOutput: 2_000,
  /** One Concept per this many Source tokens, within the bounds below. */
  sourceTokensPerConcept: 600,
  minConcepts: 25,
  maxConcepts: 200,
  /** Concepts created per curator tool step. */
  conceptsPerStep: 8,
  /** Output per curator tool step (tool calls, with reasoning). */
  outputPerStep: 1_200,
  /** A tool result the next step reads uncached. */
  toolResult: 800,
  /** Steps per View: build, inspect, fix, commit. */
  stepsPerView: 4,
  /** The writer prompt (write.md) and the batch's Concepts. */
  writerPrompt: 5_000,
  conceptsPerWriterBatch: 10,
  /** Summary and overview of one Concept. */
  overviewOutput: 350,
  /** Share of Concepts that are core and get an article. */
  coreShare: 0.15,
  articleOutput: 1_800,
} as const

export type StageEstimate = {
  model: string
  /** False when the model's price isn't known and a fallback was used. */
  priced: boolean
  usage: TokenUsage
  usd: number
}

export type BuildEstimate = {
  sourceTokens: number
  /** Over SOURCE_TOKEN_CAP: the reader picks Sources or sections. */
  overCap: boolean
  concepts: number
  views: number
  stages: Record<Stage, StageEstimate>
  usd: number
  /** The default spending cap: BUILD_CAP_MULTIPLIER × usd. */
  capUsd: number
}

export type BuildEstimateInput = {
  provider: ProviderId
  models: StageModels
  /** Characters of Source text (normalized markdown), across all Sources. */
  sourceChars: number
  /** Views the build will make (4–8 are proposed). Default 6. */
  views?: number
}

function stage(
  provider: ProviderId,
  model: string,
  usage: TokenUsage
): StageEstimate {
  const { price, known } = priceOf(provider, model)
  return { model, priced: known, usage, usd: costOf(usage, price) }
}

/**
 * Output tokens of the understanding note, reasoning included, by family:
 * Claude writes it longer and reasons first; measured on the fixtures.
 */
export const NOTE_OUTPUT: Record<TokenizerFamily, number> = {
  claude: 1_000,
  "claude-legacy": 800,
  openai: 400,
  gemini: 300,
  other: 1_000,
}

/**
 * The curator's first step: read the whole Source and write the note. The
 * first run writes the prompt cache; a rerun within its lifetime (a resumed
 * job) reads it.
 */
export function noteStepUsage(
  provider: ProviderId,
  model: string,
  sourceChars: number,
  { promptChars = NOTE_INSTRUCTIONS.length, cached = false } = {}
): TokenUsage {
  const family = tokenizerFamily(provider, model)
  const prefix = tokensForChars(promptChars + sourceChars, family)
  return {
    ...ZERO_USAGE,
    ...(cached ? { cacheRead: prefix } : { cacheWrite: prefix }),
    output: NOTE_OUTPUT[family],
  }
}

export function estimateBuild(input: BuildEstimateInput): BuildEstimate {
  const { provider, models } = input
  const views = input.views ?? 6

  // Source tokens on the curator's tokenizer: it reads everything.
  const sourceTokens = tokensForChars(
    input.sourceChars,
    tokenizerFamily(provider, models.curator)
  )
  const perModel = (model: string) =>
    tokensForChars(input.sourceChars, tokenizerFamily(provider, model))

  const concepts = Math.min(
    STEP.maxConcepts,
    Math.max(STEP.minConcepts, Math.round(sourceTokens / STEP.sourceTokensPerConcept))
  )

  // Skim: one call over a sample.
  const skim: TokenUsage = {
    ...ZERO_USAGE,
    input: STEP.skimPrompt + Math.min(perModel(models.skim), STEP.skimSampleMax),
    output: STEP.skimOutput,
  }

  // Curator: the first call writes the playbook + Sources to the cache; every
  // later step reads it back, plus the loop's history so far (cached as it
  // grows), and pays full price only for the newest tool result.
  const prefix = STEP.curatorPrompt + sourceTokens
  const steps = Math.ceil(concepts / STEP.conceptsPerStep) + views * STEP.stepsPerView
  const note = NOTE_OUTPUT[tokenizerFamily(provider, models.curator)]
  let curator: TokenUsage = { ...ZERO_USAGE, cacheWrite: prefix, output: note }
  let history = note
  for (let i = 0; i < steps; i++) {
    curator = addUsage(curator, {
      input: STEP.toolResult,
      cacheRead: prefix + history,
      cacheWrite: STEP.outputPerStep,
      output: STEP.outputPerStep,
    })
    history += STEP.outputPerStep + STEP.toolResult
  }

  // Writers: batches of Concepts, each reading the Sources from the cache;
  // then one call per core Concept's article.
  const writerSource = perModel(models.writer)
  const batches = Math.ceil(concepts / STEP.conceptsPerWriterBatch)
  const articles = Math.round(concepts * STEP.coreShare)
  const calls = batches + articles
  const writer: TokenUsage = {
    input: calls * STEP.writerPrompt,
    cacheWrite: writerSource,
    cacheRead: Math.max(0, calls - 1) * writerSource,
    output: concepts * STEP.overviewOutput + articles * STEP.articleOutput,
  }

  const stages = {
    skim: stage(provider, models.skim, skim),
    curator: stage(provider, models.curator, curator),
    writer: stage(provider, models.writer, writer),
  }
  const usd = stages.skim.usd + stages.curator.usd + stages.writer.usd
  return {
    sourceTokens,
    overCap: sourceTokens > SOURCE_TOKEN_CAP,
    concepts,
    views,
    stages,
    usd,
    capUsd: usd * BUILD_CAP_MULTIPLIER,
  }
}
