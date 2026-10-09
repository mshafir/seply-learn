// Server configuration, read from env vars (Worker vars and secrets, or
// process.env on Node). See README.md for the list.
import { DEFAULT_EMAIL_FROM } from "./mailer.ts"

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
  /**
   * "1" turns on email + password sign-in (self-host: the Node entry's
   * default; WP-6.1). Hosted, Google is the only way in.
   */
  AUTH_EMAIL_PASSWORD?: string
  /**
   * "0" closes email sign-up: existing accounts still sign in, and invites
   * reach people who already have one. Default: open.
   */
  AUTH_EMAIL_SIGNUP?: string
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

  // --- Email (invites only; mailer.ts) ---
  /** Resend's API key (a sending-only key). Invite emails are off without it. */
  RESEND_API_KEY?: string
  /** The sender, e.g. `Seply Learn <invites@mail.seply.app>` (the default). A var, not a secret. */
  EMAIL_FROM?: string
  /**
   * Self-host SMTP (WP-6.1; the Node entry sends through it). With
   * SMTP_HOST set, EMAIL_FROM is required. SMTP_PORT defaults to 587 (465
   * when SMTP_SECURE is "1": TLS from the start; otherwise STARTTLS when the
   * server offers it). SMTP_USER and SMTP_PASS are optional.
   */
  SMTP_HOST?: string
  SMTP_PORT?: string
  SMTP_SECURE?: string
  SMTP_USER?: string
  SMTP_PASS?: string

  // --- The Map View's basemap (docs/ops/basemap-tiles.md) ---
  /**
   * Our PMTiles archive: a URL, or a path on this origin (the Node entry's
   * MAP_TILES_FILE is served at /tiles/basemap.pmtiles). Read at runtime and
   * served by GET /api/map-config, over the web build's VITE_MAP_TILES_URL.
   */
  MAP_TILES_URL?: string
  /** A copy of Protomaps' fonts and sprites (basemaps-assets), likewise. */
  MAP_ASSETS_URL?: string
}

/** An SMTP server (self-host). */
export type SmtpConfig = {
  host: string
  port: number
  /** TLS from the start (port 465); otherwise STARTTLS when offered. */
  secure: boolean
  user?: string
  pass?: string
}

/**
 * How invite emails go out: through Resend, through SMTP (self-host; the
 * runtime supplies the Mailer, since SMTP needs sockets), only logged (tests
 * and local e2e, whatever keys are set), or not at all (the link and the
 * inbox only).
 */
export type MailConfig =
  | { kind: "resend"; apiKey: string; from: string }
  | { kind: "smtp"; smtp: SmtpConfig; from: string }
  | { kind: "log" }
  | null

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
  /** Email + password sign-in (AUTH_EMAIL_PASSWORD); test credentials also turn it on, without UI. */
  emailPassword: boolean
  /** Whether email + password sign-up is open (AUTH_EMAIL_SIGNUP). */
  emailSignUp: boolean
  dbBranch?: string
  mail: MailConfig
  /** The Map View's basemap, when set at runtime (MAP_TILES_URL, MAP_ASSETS_URL). */
  map: { tiles?: string; assets?: string }
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

  const testCredentials =
    env.AUTH_TEST_CREDENTIALS === "1" && isLocalURL(baseURL)
  const emailPassword = flag(env.AUTH_EMAIL_PASSWORD)
  const emailSignUp = env.AUTH_EMAIL_SIGNUP?.trim() !== "0"
  const smtp = readSmtp(env)
  // Tests never send real email, even with a Resend key in .dev.vars.
  const mail: MailConfig = testCredentials
    ? { kind: "log" }
    : env.RESEND_API_KEY
      ? {
          kind: "resend",
          apiKey: env.RESEND_API_KEY,
          from: env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM,
        }
      : smtp
        ? { kind: "smtp", smtp, from: env.EMAIL_FROM!.trim() }
        : null

  return {
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    google,
    proxyURL: proxy,
    trustedOrigins,
    testCredentials,
    emailPassword,
    emailSignUp,
    dbBranch: env.DB_BRANCH,
    mail,
    map: {
      tiles: env.MAP_TILES_URL?.trim() || undefined,
      assets: env.MAP_ASSETS_URL?.trim() || undefined,
    },
  }
}

const flag = (v: string | undefined) =>
  v?.trim() === "1" || v?.trim() === "true"

/** SMTP_* (self-host), validated; undefined without SMTP_HOST. */
function readSmtp(env: ServerEnv): SmtpConfig | undefined {
  const host = env.SMTP_HOST?.trim()
  if (!host) return undefined
  if (!env.EMAIL_FROM?.trim())
    throw new ConfigError(
      "EMAIL_FROM is not set (SMTP_HOST needs a sender, e.g. Seply Learn <learn@example.com>)"
    )
  const secure = flag(env.SMTP_SECURE)
  const rawPort = env.SMTP_PORT?.trim()
  const port = rawPort ? Number(rawPort) : secure ? 465 : 587
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new ConfigError(`SMTP_PORT is not a port number: ${rawPort}`)
  const user = env.SMTP_USER?.trim() || undefined
  if (env.SMTP_PASS && !user)
    throw new ConfigError("SMTP_PASS is set without SMTP_USER")
  return { host, port, secure, user, pass: env.SMTP_PASS || undefined }
}
