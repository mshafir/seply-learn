// An AiSetup is everything a request or job needs to call a model: whose key
// (the instance's or the reader's), which provider, and which model per stage.
// @seply/server resolves one per request or job (`resolveAi`); the stages ask
// it for their model here.
import type { LanguageModelV4 } from "@ai-sdk/provider"
import { estimateBuild, type BuildEstimate } from "./estimate.ts"
import type { Stage, StageModels } from "./models.ts"
import {
  languageModel,
  type Credentials,
  type ProviderOptions,
} from "./providers.ts"
import { meteredModel, type SpendMeter } from "./spend.ts"

export type AiSetup = {
  /** Whose key: the instance's, or the reader's own (BYOK). */
  keySource: "instance" | "reader"
  /** Secret. Lives only as long as the request or job that resolved it. */
  credentials: Credentials
  models: StageModels
  options?: ProviderOptions
}

/**
 * The model for `stage`. With a meter, every call is checked against the
 * spending cap and recorded (see spend.ts).
 */
export function modelFor(
  setup: AiSetup,
  stage: Stage,
  meter?: SpendMeter
): LanguageModelV4 {
  const modelId = setup.models[stage]
  const model = languageModel(setup.credentials, modelId, setup.options)
  if (!meter) return model
  return meteredModel(model, meter, {
    provider: setup.credentials.provider,
    modelId,
  })
}

/** The build estimate on this setup's provider and models. */
export function estimateFor(
  setup: Pick<AiSetup, "credentials" | "models">,
  sourceChars: number,
  views?: number
): BuildEstimate {
  return estimateBuild({
    provider: setup.credentials.provider,
    models: setup.models,
    sourceChars,
    views,
  })
}
