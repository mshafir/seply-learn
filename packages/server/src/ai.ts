// AI plumbing on the server (spec §5.6, §3.10): resolving whose key and which
// models a request or job uses, the reader's AI settings, and /api/ai.
//
// No response from here ever carries a key, whole or encrypted: a stored key
// is shown as its provider and last 4 characters (ai.test.ts checks every
// route).
import {
  BYOK_PROVIDERS,
  ByokProvider,
  DEFAULT_ASK_CAP_USD,
  DEFAULT_MODELS,
  ARTICLE_LENGTH_IDS,
  ARTICLE_LENGTHS,
  estimateArticle,
  estimateBuild,
  ModelOverrides,
  PROVIDER_LABELS,
  stageModels,
  testKey,
  ApiKey,
  type AiSetup,
  type Credentials,
  type ProviderId,
  type ProviderOptions,
  type StageModels,
} from "@seply/ai"
import { schema } from "@seply/domain"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { readAiConfig, type AiConfig, type AiKeyMode } from "./ai-config.ts"
import {
  deleteKey,
  importMasterKey,
  listKeys,
  loadKey,
  saveKey,
  type KeySummary,
} from "./ai-keys.ts"
import type { AppEnv } from "./app.ts"
import { ConfigError, type ServerEnv } from "./config.ts"
import type { BlobStore } from "./blobs.ts"
import type { Db } from "./db.ts"
import { access } from "./jobs/routes.ts"
import { readSegments } from "./sources/store.ts"

const { aiSettings } = schema

/** The most a reader may set the per-ask cap to, in USD. */
export const MAX_ASK_CAP_USD = 50

export type AiSettings = {
  /** Which of the reader's keys builds use (BYOK); null: the first they have. */
  provider: ByokProvider | null
  /** Model overrides per provider and stage (BYOK). */
  models: Partial<Record<ByokProvider, ModelOverrides>>
  askCapUsd: number
}

export async function readAiSettings(db: Db, userId: string): Promise<AiSettings> {
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.userId, userId))
  const provider = ByokProvider.safeParse(row?.provider)
  const models: AiSettings["models"] = {}
  for (const [p, o] of Object.entries(row?.models ?? {})) {
    const parsedP = ByokProvider.safeParse(p)
    const parsedO = ModelOverrides.safeParse(o)
    if (parsedP.success && parsedO.success) models[parsedP.data] = parsedO.data
  }
  return {
    provider: provider.success ? provider.data : null,
    models,
    askCapUsd:
      row?.askCapCents != null ? row.askCapCents / 100 : DEFAULT_ASK_CAP_USD,
  }
}

export type AiUnavailable = {
  ok: false
  /** no-key: BYOK and the reader has no key; not-configured: no instance key. */
  reason: "no-key" | "not-configured"
}

export type AiResolution =
  | { ok: true; setup: AiSetup; askCapUsd: number }
  | AiUnavailable

/**
 * Whose key and which models `userId`'s request or job uses. Instance mode:
 * the operator's key and models. BYOK: the reader's preferred provider (else
 * the first they have a key for, in BYOK_PROVIDERS order), their key
 * decrypted for this call only, and their model overrides.
 *
 * The returned setup holds a secret: keep it inside the request or job.
 */
export async function resolveAi(
  db: Db,
  env: ServerEnv,
  userId: string,
  options?: ProviderOptions
): Promise<AiResolution> {
  const config = readAiConfig(env)
  const settings = await readAiSettings(db, userId)
  if (config.mode === "instance") {
    if (!config.instance) return { ok: false, reason: "not-configured" }
    return {
      ok: true,
      setup: {
        keySource: "instance",
        credentials: config.instance,
        models: stageModels(config.instance.provider, config.instanceModels),
        options,
      },
      askCapUsd: settings.askCapUsd,
    }
  }
  const provider = await byokProvider(db, userId, settings)
  if (!provider) return { ok: false, reason: "no-key" }
  const apiKey = await loadKey(db, await masterKey(config), userId, provider)
  if (!apiKey) return { ok: false, reason: "no-key" }
  return {
    ok: true,
    setup: {
      keySource: "reader",
      credentials: { provider, apiKey },
      models: stageModels(provider, settings.models[provider]),
      options,
    },
    askCapUsd: settings.askCapUsd,
  }
}

async function byokProvider(
  db: Db,
  userId: string,
  settings: AiSettings
): Promise<ByokProvider | null> {
  const have = new Set((await listKeys(db, userId)).map((k) => k.provider))
  if (settings.provider && have.has(settings.provider)) return settings.provider
  return BYOK_PROVIDERS.find((p) => have.has(p)) ?? null
}

async function masterKey(config: AiConfig): Promise<CryptoKey> {
  if (!config.masterKey)
    throw new ConfigError("AI_KEYS_MASTER_KEY is not set (needed in byok mode)")
  return importMasterKey(config.masterKey)
}

// --- /api/ai ----------------------------------------------------------------

/** GET /api/ai: what the Settings screen shows. Never a key. */
export type AiOverview = {
  mode: AiKeyMode
  /** A build or ask can run now. */
  ready: boolean
  /** The provider builds use now, and its models per stage (null when not ready). */
  active: { provider: ProviderId; label: string; models: StageModels } | null
  /** BYOK: my stored keys (provider, last 4, when added). Empty in instance mode. */
  keys: KeySummary[]
  /** BYOK: the providers I can add a key for. */
  providers: { id: ByokProvider; label: string; defaults: StageModels }[]
  settings: AiSettings
  defaultAskCapUsd: number
}

async function overview(db: Db, env: ServerEnv, userId: string): Promise<AiOverview> {
  const config = readAiConfig(env)
  const settings = await readAiSettings(db, userId)
  const keys = config.mode === "byok" ? await listKeys(db, userId) : []
  let active: AiOverview["active"] = null
  if (config.mode === "instance" && config.instance) {
    const p = config.instance.provider
    active = {
      provider: p,
      label: PROVIDER_LABELS[p],
      models: stageModels(p, config.instanceModels),
    }
  } else if (config.mode === "byok") {
    const p = await byokProvider(db, userId, settings)
    if (p)
      active = {
        provider: p,
        label: PROVIDER_LABELS[p],
        models: stageModels(p, settings.models[p]),
      }
  }
  return {
    mode: config.mode,
    ready: active !== null,
    active,
    keys,
    providers:
      config.mode === "byok"
        ? BYOK_PROVIDERS.map((id) => ({
            id,
            label: PROVIDER_LABELS[id],
            defaults: DEFAULT_MODELS[id],
          }))
        : [],
    settings,
    defaultAskCapUsd: DEFAULT_ASK_CAP_USD,
  }
}

const SaveKeyBody = z.object({ apiKey: ApiKey })

const SettingsBody = z
  .object({
    provider: ByokProvider.nullable(),
    models: z.partialRecord(ByokProvider, ModelOverrides),
    askCapUsd: z.number().positive().max(MAX_ASK_CAP_USD).nullable(),
  })
  .partial()
  .strict()

const ArticleEstimateBody = z.object({ expeditionId: z.string().min(1).max(64) })

/** Characters of Source text across an Expedition's Sources. */
async function expeditionSourceChars(db: Db, blobs: BlobStore, expeditionId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(eq(schema.sources.expeditionId, expeditionId))
  let chars = 0
  for (const { id } of rows) {
    const r = await readSegments(db, blobs, expeditionId, id)
    if (r) chars += r.segments.chars
  }
  return chars
}

const EstimateBody = z
  .object({
    sourceChars: z.number().int().nonnegative(),
    views: z.number().int().min(1).max(12).optional(),
  })
  .strict()


export function aiRoutes(options?: ProviderOptions) {
  const r = new Hono<AppEnv>()
  const byokOnly = (mode: AiKeyMode) => mode === "byok"

  r.get("/", async (c) => {
    return c.json(await overview(await c.var.db(), c.env ?? {}, c.var.user.id))
  })

  r.put("/keys/:provider", async (c) => {
    const config = readAiConfig(c.env ?? {})
    if (!byokOnly(config.mode))
      return c.json({ error: "this instance doesn't take your own keys" }, 409)
    const provider = ByokProvider.safeParse(c.req.param("provider"))
    if (!provider.success) return c.json({ error: "unknown provider" }, 404)
    const body = SaveKeyBody.safeParse(await c.req.json().catch(() => null))
    // Issues are left out: zod's would echo the key back.
    if (!body.success) return c.json({ error: "that doesn't look like an API key" }, 400)
    const key = await saveKey(await c.var.db(), await masterKey(config), {
      userId: c.var.user.id,
      provider: provider.data,
      apiKey: body.data.apiKey,
    })
    return c.json({ key })
  })

  r.post("/keys/:provider/test", async (c) => {
    const config = readAiConfig(c.env ?? {})
    if (!byokOnly(config.mode))
      return c.json({ error: "this instance doesn't take your own keys" }, 409)
    const provider = ByokProvider.safeParse(c.req.param("provider"))
    if (!provider.success) return c.json({ error: "unknown provider" }, 404)
    const apiKey = await loadKey(
      await c.var.db(),
      await masterKey(config),
      c.var.user.id,
      provider.data
    )
    if (!apiKey) return c.json({ error: "no key for this provider" }, 404)
    const creds: Credentials = { provider: provider.data, apiKey }
    return c.json(await testKey(creds, options))
  })

  r.delete("/keys/:provider", async (c) => {
    const provider = ByokProvider.safeParse(c.req.param("provider"))
    if (!provider.success) return c.json({ error: "unknown provider" }, 404)
    const gone = await deleteKey(await c.var.db(), c.var.user.id, provider.data)
    return gone ? c.body(null, 204) : c.json({ error: "no key for this provider" }, 404)
  })

  r.patch("/settings", async (c) => {
    const body = SettingsBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const userId = c.var.user.id
    const set: Partial<typeof aiSettings.$inferInsert> = { updatedAt: new Date() }
    if (body.data.provider !== undefined) set.provider = body.data.provider
    if (body.data.models !== undefined) set.models = body.data.models
    if (body.data.askCapUsd !== undefined)
      set.askCapCents =
        body.data.askCapUsd === null ? null : Math.round(body.data.askCapUsd * 100)
    await db
      .insert(aiSettings)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: aiSettings.userId, set })
    return c.json(await overview(db, c.env ?? {}, userId))
  })

  r.post("/estimate", async (c) => {
    const body = EstimateBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    // The provider and models are enough: no key is decrypted for an estimate.
    const { mode, active } = await overview(await c.var.db(), c.env ?? {}, c.var.user.id)
    if (!active)
      return c.json({ error: mode === "byok" ? "no-key" : "not-configured" }, 409)
    const estimate = estimateBuild({
      provider: active.provider,
      models: active.models,
      sourceChars: body.data.sourceChars,
      views: body.data.views,
    })
    return c.json({ estimate })
  })

  // "Write the article" asks first (spec §3.7): what each length would cost
  // on this Expedition's Sources, and the reader's per-ask cap.
  r.post("/estimate/article", async (c) => {
    const body = ArticleEstimateBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const a = await access(db, body.data.expeditionId, c.var.user.id)
    if (!a) return c.json({ error: "Expedition not found" }, 404)
    if (!a.may("useAi")) return c.json({ error: "not allowed" }, 403)
    const { mode, active, settings, defaultAskCapUsd } = await overview(db, c.env ?? {}, c.var.user.id)
    if (!active)
      return c.json({ error: mode === "byok" ? "no-key" : "not-configured" }, 409)
    const sourceChars = await expeditionSourceChars(db, c.var.blobs(), body.data.expeditionId)
    const lengths = Object.fromEntries(
      ARTICLE_LENGTH_IDS.map((length) => {
        const e = estimateArticle({ provider: active.provider, models: active.models, sourceChars, length })
        return [length, { words: ARTICLE_LENGTHS[length], usd: e.usd, model: e.model }]
      })
    )
    return c.json({ lengths, sourceChars, askCapUsd: settings.askCapUsd ?? defaultAskCapUsd })
  })

  return r
}
