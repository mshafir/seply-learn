// AI configuration from env (spec §2.6, §5.6): the key mode, the instance's
// key, and the master key BYOK keys are encrypted under. Read per request or
// job, like the rest of the config; nothing here is cached at module scope.
import {
  ModelOverrides,
  type Credentials,
  type ProviderId,
} from "@seply/ai"
import { ConfigError, type ServerEnv } from "./config.ts"

export type AiKeyMode = "instance" | "byok"

export type AiConfig = {
  mode: AiKeyMode
  /** Instance mode: the operator's key, if one is set. Secret. */
  instance: Credentials | null
  /** Instance mode: the operator's model per stage, over the provider's defaults. */
  instanceModels: ModelOverrides
  /** BYOK mode: the master key, base64 (32 bytes). Secret. */
  masterKey: string | null
}

/**
 * The instance key, first found wins: the AI Gateway (the hosted instance),
 * then a direct provider key, then an OpenAI-compatible endpoint (self-host).
 */
function instanceCredentials(env: ServerEnv): Credentials | null {
  const direct: [ProviderId, string | undefined][] = [
    ["gateway", env.AI_GATEWAY_API_KEY],
    ["anthropic", env.ANTHROPIC_API_KEY],
    ["openai", env.OPENAI_API_KEY],
    ["google", env.GOOGLE_GENERATIVE_AI_API_KEY],
  ]
  for (const [provider, apiKey] of direct)
    if (apiKey?.trim()) return { provider, apiKey: apiKey.trim() }
  if (env.OPENAI_COMPATIBLE_BASE_URL?.trim())
    return {
      provider: "openai-compatible",
      baseURL: env.OPENAI_COMPATIBLE_BASE_URL.trim(),
      // Local endpoints (Ollama, LM Studio) take any key.
      apiKey: env.OPENAI_COMPATIBLE_API_KEY?.trim() || "none",
    }
  return null
}

export function readAiConfig(env: ServerEnv): AiConfig {
  const raw = (env.AI_KEY_MODE ?? "instance").trim() || "instance"
  if (raw !== "instance" && raw !== "byok")
    throw new ConfigError(`AI_KEY_MODE must be "instance" or "byok", not "${raw}"`)

  const models = ModelOverrides.safeParse({
    skim: env.AI_MODEL_SKIM || undefined,
    curator: env.AI_MODEL_CURATOR || undefined,
    writer: env.AI_MODEL_WRITER || undefined,
  })
  if (!models.success) throw new ConfigError("AI_MODEL_* is not a model id")

  return {
    mode: raw,
    instance: raw === "instance" ? instanceCredentials(env) : null,
    instanceModels: models.data,
    masterKey: env.AI_KEYS_MASTER_KEY?.trim() || null,
  }
}
