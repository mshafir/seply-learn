// Providers, stages and default models (spec §5.1, §5.6).
//
// A stage is one kind of AI work; each runs on a model tier:
//   skim     fast model: reads a sample of the Sources, proposes Views
//   curator  strong model: the curator agent (builds, and Grow asks)
//   writer   mid-tier model: summaries, overviews and articles
import { z } from "zod"

export const PROVIDERS = [
  "gateway",
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
] as const
export type ProviderId = (typeof PROVIDERS)[number]
export const ProviderId = z.enum(PROVIDERS)

/** Providers a reader can add a key for in bring-your-own-key mode. */
export const BYOK_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "gateway",
] as const satisfies readonly ProviderId[]
export type ByokProvider = (typeof BYOK_PROVIDERS)[number]
export const ByokProvider = z.enum(BYOK_PROVIDERS)

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gateway: "Vercel AI Gateway",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "openai-compatible": "OpenAI-compatible",
}

export const STAGES = ["skim", "curator", "writer"] as const
export type Stage = (typeof STAGES)[number]
export const Stage = z.enum(STAGES)

export type Tier = "fast" | "strong" | "mid"
export const STAGE_TIER: Record<Stage, Tier> = {
  skim: "fast",
  curator: "strong",
  writer: "mid",
}

export type StageModels = Record<Stage, string>

/**
 * Tested defaults per provider and stage. Model ids are each provider's own:
 * the gateway's are `creator/model`. Claude is the default family; the
 * OpenAI and Google tiers are matched by price and capability, not yet tried
 * on a real build (see the README). An OpenAI-compatible endpoint has no
 * defaults: its operator names the models in env.
 */
export const DEFAULT_MODELS: Record<
  Exclude<ProviderId, "openai-compatible">,
  StageModels
> = {
  gateway: {
    skim: "anthropic/claude-haiku-4.5",
    curator: "anthropic/claude-opus-5.5",
    writer: "anthropic/claude-sonnet-5.5",
  },
  anthropic: {
    skim: "claude-haiku-4-5",
    curator: "claude-opus-5-5",
    writer: "claude-sonnet-5-5",
  },
  openai: {
    skim: "gpt-6-luna",
    curator: "gpt-6-astra",
    writer: "gpt-6.1-sol",
  },
  google: {
    skim: "gemini-3.5-flash-lite",
    curator: "gemini-3.1-pro-preview",
    writer: "gemini-3.8-flash",
  },
}

/** A model id as a reader or operator may type it: short, no whitespace. */
export const ModelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\w.:/@-]+$/, "not a model id")

export const ModelOverrides = z
  .object({ skim: ModelId, curator: ModelId, writer: ModelId })
  .partial()
export type ModelOverrides = z.infer<typeof ModelOverrides>

/**
 * The model for each stage: the override when set, else the provider's
 * default. Throws for a stage with neither (an OpenAI-compatible endpoint
 * whose operator named no model for it).
 */
export function stageModels(
  provider: ProviderId,
  overrides: ModelOverrides = {}
): StageModels {
  const defaults =
    provider === "openai-compatible" ? undefined : DEFAULT_MODELS[provider]
  const out = {} as StageModels
  for (const stage of STAGES) {
    const id = overrides[stage] ?? defaults?.[stage]
    if (!id) throw new Error(`no model for the ${stage} stage on ${provider}`)
    out[stage] = id
  }
  return out
}
