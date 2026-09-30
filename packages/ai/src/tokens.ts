// Token estimation without a tokenizer (spec §5.6): characters per token by
// tokenizer family, measured on the committed fixtures through the AI Gateway
// (scripts/measure-estimate.ts; the figures are in estimate-actuals.json).
// Each ratio is the geometric mean of the two fixtures', which differ by up
// to 19% (the research doc's links and tables tokenize denser than the
// compute sample's prose), so an estimate is good to about ±10% on English
// prose and markdown. Code and non-Latin scripts tokenize denser still.
// `other` (unknown models) takes the densest ratio, erring high.
import { canonicalModelId } from "./pricing.ts"
import type { ProviderId } from "./models.ts"

export type TokenizerFamily =
  | "claude" // Claude Opus 4.7+, Sonnet 5+, Fable (the newer tokenizer)
  | "claude-legacy" // Claude Haiku 4.5 and older Claude models
  | "openai"
  | "gemini"
  | "other"

/** Characters per token, per family. */
export const CHARS_PER_TOKEN: Record<TokenizerFamily, number> = {
  claude: 2.6,
  "claude-legacy": 3.5,
  openai: 4.0,
  gemini: 3.75,
  other: 2.6,
}

export function tokenizerFamily(
  provider: ProviderId,
  modelId: string
): TokenizerFamily {
  const id = canonicalModelId(provider, modelId)
  if (id.startsWith("anthropic/")) {
    const m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:\.(\d+))?/.exec(id)
    if (!m) return "claude"
    const [, line, major, minor = "0"] = m
    const v = Number(major) + Number(minor) / 10
    if (line === "fable" || line === "mythos") return "claude"
    if (line === "opus") return v >= 4.7 ? "claude" : "claude-legacy"
    if (line === "sonnet") return v >= 5 ? "claude" : "claude-legacy"
    return "claude-legacy"
  }
  if (id.startsWith("openai/")) return "openai"
  if (id.startsWith("google/")) return "gemini"
  return "other"
}

/** Estimated tokens in `chars` characters of prose for this family. */
export function tokensForChars(chars: number, family: TokenizerFamily): number {
  return Math.ceil(chars / CHARS_PER_TOKEN[family])
}

/** Estimated tokens of `text` on this provider's model. */
export function estimateTokens(
  text: string,
  provider: ProviderId,
  modelId: string
): number {
  return tokensForChars(text.length, tokenizerFamily(provider, modelId))
}
