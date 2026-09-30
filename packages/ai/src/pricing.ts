// Model prices and the cost of a call (spec §5.6).
//
// Prices are USD per million tokens, from the AI Gateway's model list
// (`getAvailableModels()`, 2026-09-30), which matches the providers' own list
// prices. The gateway also reports each call's cost; `costOfCall` prefers it.
import type { ProviderId } from "./models.ts"

export type Price = {
  /** USD per million uncached input tokens. */
  input: number
  /** USD per million output tokens (reasoning included). */
  output: number
  /** USD per million cached input tokens read; default: input. */
  cacheRead?: number
  /** USD per million input tokens written to the cache; default: input. */
  cacheWrite?: number
}

/** Keyed by the gateway's `creator/model` id. */
export const PRICES: Record<string, Price> = {
  "anthropic/claude-haiku-4.5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "anthropic/claude-opus-5.5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "openai/gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "openai/gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "openai/gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "openai/gpt-6-astra": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03 },
  "google/gemini-3.8-flash": { input: 0.75, output: 3.75, cacheRead: 0.075 },
  "google/gemini-3.1-pro-preview": { input: 2, output: 12, cacheRead: 0.2 },
}

/**
 * The price used for a model not in the table (an override, or an
 * OpenAI-compatible endpoint): Opus-class list prices, so caps err on the
 * side of stopping early rather than overspending.
 */
export const FALLBACK_PRICE: Price = {
  input: 5,
  output: 25,
  cacheRead: 0.5,
  cacheWrite: 6.25,
}

/**
 * The gateway-style `creator/model` id for a provider's own model id:
 * Anthropic's `claude-opus-5-5` is `anthropic/claude-opus-5.5`; OpenAI's and
 * Google's ids gain their creator prefix. Other ids come back unchanged.
 */
export function canonicalModelId(provider: ProviderId, modelId: string): string {
  switch (provider) {
    case "anthropic":
      // Drop a date suffix, then turn the trailing -X-Y version into -X.Y.
      return (
        "anthropic/" +
        modelId.replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)$/, "-$1.$2")
      )
    case "openai":
      return `openai/${modelId}`
    case "google":
      return `google/${modelId.replace(/^models\//, "")}`
    default:
      return modelId
  }
}

export type PriceLookup = { price: Price; known: boolean }

export function priceOf(provider: ProviderId, modelId: string): PriceLookup {
  const price = PRICES[canonicalModelId(provider, modelId)]
  return price ? { price, known: true } : { price: FALLBACK_PRICE, known: false }
}

/** Token counts of one call (or a sum of calls), as the estimate and meter use them. */
export type TokenUsage = {
  /** Uncached input tokens. */
  input: number
  cacheRead: number
  cacheWrite: number
  /** Output tokens, reasoning included. */
  output: number
}

export const ZERO_USAGE: TokenUsage = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  }
}

/** USD for `usage` at `price`. */
export function costOf(usage: TokenUsage, price: Price): number {
  return (
    (usage.input * price.input +
      usage.cacheRead * (price.cacheRead ?? price.input) +
      usage.cacheWrite * (price.cacheWrite ?? price.input) +
      usage.output * price.output) /
    1_000_000
  )
}

/**
 * The AI SDK's usage (a `LanguageModelV4Usage` from a model call, or the
 * `LanguageModelUsage` of a `generateText` result) as `TokenUsage`.
 */
export function tokenUsage(
  usage:
    | {
        inputTokens: {
          total: number | undefined
          noCache: number | undefined
          cacheRead: number | undefined
          cacheWrite: number | undefined
        }
        outputTokens: { total: number | undefined }
      }
    | {
        inputTokens: number | undefined
        inputTokenDetails: {
          noCacheTokens: number | undefined
          cacheReadTokens: number | undefined
          cacheWriteTokens: number | undefined
        }
        outputTokens: number | undefined
      }
): TokenUsage {
  let total: number, noCache: number | undefined, read: number, write: number
  let output: number
  if (typeof usage.inputTokens === "object") {
    const u = usage as Extract<typeof usage, { inputTokens: object }>
    total = u.inputTokens.total ?? 0
    noCache = u.inputTokens.noCache
    read = u.inputTokens.cacheRead ?? 0
    write = u.inputTokens.cacheWrite ?? 0
    output = u.outputTokens.total ?? 0
  } else {
    const u = usage as Extract<typeof usage, { inputTokenDetails: object }>
    total = u.inputTokens ?? 0
    noCache = u.inputTokenDetails.noCacheTokens
    read = u.inputTokenDetails.cacheReadTokens ?? 0
    write = u.inputTokenDetails.cacheWriteTokens ?? 0
    output = u.outputTokens ?? 0
  }
  return {
    input: noCache ?? Math.max(0, total - read - write),
    cacheRead: read,
    cacheWrite: write,
    output,
  }
}

/** The cost the AI Gateway reported for a call, when there is one. */
export function gatewayCost(providerMetadata: unknown): number | undefined {
  const cost = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)
    ?.gateway?.cost
  const n = typeof cost === "string" || typeof cost === "number" ? Number(cost) : NaN
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** A call's cost: the gateway's figure when reported, else from the price table. */
export function costOfCall(
  usage: TokenUsage,
  price: Price,
  providerMetadata?: unknown
): number {
  return gatewayCost(providerMetadata) ?? costOf(usage, price)
}
