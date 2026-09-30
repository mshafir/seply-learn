// Providers, created per request (spec §5.1): the instance key or the
// reader's own key goes into a provider made for this request or job only,
// never into a module-level singleton, and never into env (so the AI SDK's
// default `gateway`, which reads AI_GATEWAY_API_KEY from env, is never used).
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogle } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModelV4 } from "@ai-sdk/provider"
import { createGateway } from "ai"
import { z } from "zod"
import type { ProviderId } from "./models.ts"

/** An API key and where it goes. Secret: never log, return or persist it in the clear. */
export type Credentials = {
  provider: ProviderId
  apiKey: string
  /** OpenAI-compatible endpoints only. */
  baseURL?: string
}

export type ProviderOptions = {
  /** For tests, or to route through a proxy. */
  fetch?: typeof globalThis.fetch
}

/** What a key must look like to be stored: printable, no whitespace. */
export const ApiKey = z
  .string()
  .trim()
  .min(8, "too short for an API key")
  .max(512)
  .regex(/^[\x21-\x7e]+$/, "an API key has no spaces or special characters")

/** The last 4 characters, the only part of a key ever shown again. */
export const last4 = (apiKey: string) => apiKey.slice(-4)

/** A language model for `modelId` on these credentials. */
export function languageModel(
  creds: Credentials,
  modelId: string,
  opts: ProviderOptions = {}
): LanguageModelV4 {
  const { apiKey, baseURL } = creds
  const { fetch } = opts
  switch (creds.provider) {
    case "gateway":
      return createGateway({ apiKey, fetch })(modelId)
    case "anthropic":
      return createAnthropic({ apiKey, fetch })(modelId)
    case "openai":
      return createOpenAI({ apiKey, fetch })(modelId)
    case "google":
      return createGoogle({ apiKey, fetch })(modelId)
    case "openai-compatible":
      if (!baseURL) throw new Error("an OpenAI-compatible provider needs a base URL")
      return createOpenAICompatible({
        name: "openai-compatible",
        baseURL,
        apiKey,
        fetch,
        includeUsage: true,
      })(modelId)
  }
}

export type KeyTest =
  | { ok: true }
  | { ok: false; reason: "rejected" | "unreachable" | "error"; status?: number }

/**
 * Checks a key without spending anything: lists the provider's models (or,
 * for the gateway, reads the credit balance). "rejected" means the provider
 * refused the key (401/403).
 */
export async function testKey(
  creds: Credentials,
  opts: ProviderOptions = {}
): Promise<KeyTest> {
  const fetch = opts.fetch ?? globalThis.fetch
  const { apiKey } = creds
  const outcome = (status: number): KeyTest =>
    status >= 200 && status < 300
      ? { ok: true }
      : { ok: false, reason: status === 401 || status === 403 ? "rejected" : "error", status }

  try {
    switch (creds.provider) {
      case "gateway": {
        try {
          await createGateway({ apiKey, fetch }).getCredits()
          return { ok: true }
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          if (status) return outcome(status)
          throw err
        }
      }
      case "anthropic":
        return outcome(
          (
            await fetch("https://api.anthropic.com/v1/models?limit=1", {
              headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            })
          ).status
        )
      case "openai":
        return outcome(
          (
            await fetch("https://api.openai.com/v1/models", {
              headers: { authorization: `Bearer ${apiKey}` },
            })
          ).status
        )
      case "google":
        return outcome(
          (
            await fetch(
              "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
              { headers: { "x-goog-api-key": apiKey } }
            )
          ).status
        )
      case "openai-compatible": {
        if (!creds.baseURL) return { ok: false, reason: "error" }
        return outcome(
          (
            await fetch(`${creds.baseURL.replace(/\/$/, "")}/models`, {
              headers: { authorization: `Bearer ${apiKey}` },
            })
          ).status
        )
      }
    }
  } catch {
    return { ok: false, reason: "unreachable" }
  }
}
