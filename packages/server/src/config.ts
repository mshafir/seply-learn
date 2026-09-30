// Server configuration, read from env vars (Worker vars and secrets, or
// process.env on Node). See README.md for the list.

/** The env vars the app reads. Every runtime passes these through. */
export type ServerEnv = {
  /** This deploy's own origin, e.g. https://seply-pr-12.<subdomain>.workers.dev. */
  BETTER_AUTH_URL?: string
  /** Signs sessions and encrypts the OAuth proxy payload. Same on every deploy. */
  BETTER_AUTH_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /**
   * The deploy registered with Google (production). When it differs from
   * BETTER_AUTH_URL, Google sign-in goes through it (Better Auth's OAuth
   * proxy plugin). Unset locally: localhost is registered with Google.
   */
  AUTH_PROXY_URL?: string
  /** Extra trusted origins, comma-separated; `*` wildcards allowed (the previews). */
  AUTH_TRUSTED_ORIGINS?: string
  /**
   * "1" enables email + password sign-in for tests. Honoured only when
   * BETTER_AUTH_URL is a localhost URL, so it can never turn on in a deployed
   * Worker, whatever its vars say.
   */
  AUTH_TEST_CREDENTIALS?: string
  /** The Neon branch this deploy reads from (reported by /api/health). */
  DB_BRANCH?: string

  // --- AI (spec §5.6; see ai-config.ts) ---
  /** "instance" (default): the operator's key serves everyone. "byok": each reader adds their own. */
  AI_KEY_MODE?: string
  /** Instance key: a Vercel AI Gateway key (the hosted instance). */
  AI_GATEWAY_API_KEY?: string
  /** Instance key alternatives (self-host), used when no gateway key is set. */
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  GOOGLE_GENERATIVE_AI_API_KEY?: string
  OPENAI_COMPATIBLE_BASE_URL?: string
  OPENAI_COMPATIBLE_API_KEY?: string
  /** Instance mode: the model per stage, over the provider's defaults. */
  AI_MODEL_SKIM?: string
  AI_MODEL_CURATOR?: string
  AI_MODEL_WRITER?: string
  /** BYOK mode: 32 random bytes, base64. Readers' keys are AES-GCM encrypted under it. */
  AI_KEYS_MASTER_KEY?: string
  /**
   * Our VAPID key pair for web push (base64url: the 65-byte public point and
   * the 32-byte private scalar) and a contact for push services
   * (`mailto:` or `https:`). Web push is off without the keys.
   */
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export type ServerConfig = {
  baseURL: string
  secret: string
  google?: { clientId: string; clientSecret: string }
  /**
   * The production origin, when the OAuth proxy is on. On production itself
   * it equals baseURL: the plugin then only unwraps proxied callbacks.
   */
  proxyURL?: string
  trustedOrigins: string[]
  testCredentials: boolean
  dbBranch?: string
}

export class ConfigError extends Error {}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/** Whether a URL points at this machine (tests and local dev only). */
export function isLocalURL(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

function origin(url: string, name: string): string {
  try {
    return new URL(url).origin
  } catch {
    throw new ConfigError(`${name} is not a URL: ${url}`)
  }
}

export function readConfig(env: ServerEnv): ServerConfig {
  if (!env.BETTER_AUTH_URL) throw new ConfigError("BETTER_AUTH_URL is not set")
  if (!env.BETTER_AUTH_SECRET)
    throw new ConfigError("BETTER_AUTH_SECRET is not set")
  const baseURL = origin(env.BETTER_AUTH_URL, "BETTER_AUTH_URL")

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        }
      : undefined

  const proxy = env.AUTH_PROXY_URL
    ? origin(env.AUTH_PROXY_URL, "AUTH_PROXY_URL")
    : undefined

  const trustedOrigins = (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  // The proxy target must trust us, and we must trust it.
  if (proxy && !trustedOrigins.includes(proxy)) trustedOrigins.push(proxy)

  return {
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    google,
    proxyURL: proxy,
    trustedOrigins,
    testCredentials: env.AUTH_TEST_CREDENTIALS === "1" && isLocalURL(baseURL),
    dbBranch: env.DB_BRANCH,
  }
}
