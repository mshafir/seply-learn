// The Hono app factory (spec §2.2): one app, mounted at /api by each runtime
// (the Worker now, the Node server later). Runtimes supply env and a
// per-request `connect`; nothing here holds state across requests.
import { sql } from "drizzle-orm"
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider"
import type { ProviderOptions, ViewReader } from "@seply/ai"
import {
  Hono,
  type Context,
  type ErrorHandler,
  type MiddlewareHandler,
} from "hono"
import { AccessDenied } from "./access.ts"
import { agentRoutes } from "./agents.ts"
import { aiRoutes } from "./ai.ts"
import { createAuth, type Auth } from "./auth.ts"
import { createFlowRoutes } from "./create.ts"
import type { BlobStore } from "./blobs.ts"
import {
  ConfigError,
  readConfig,
  type ServerConfig,
  type ServerEnv,
} from "./config.ts"
import type { Connect, Db, DbConnection } from "./db.ts"
import { expeditionRoutes } from "./expeditions.ts"
import { exportRoutes } from "./export.ts"
import { forkRoutes } from "./fork.ts"
import { historyRoutes } from "./history.ts"
import { importRoutes } from "./import.ts"
import { proposalRoutes } from "./proposals.ts"
import { askRoutes } from "./asks.ts"
import { jobRoutes } from "./jobs/routes.ts"
import type { JobRunner } from "./jobs/types.ts"
import { liveRoutes } from "./live.ts"
import { mcpRoutes } from "./mcp/routes.ts"
import { webPushRoutes } from "./push/index.ts"
import { readerRoutes } from "./reader.ts"
import { noopRelay, type Relay } from "./relay.ts"
import { logMailer, resendMailer, type Mailer } from "./mailer.ts"
import { searchRoutes } from "./search.ts"
import { inviteRoutes, sharingRoutes } from "./sharing.ts"
import { sourceRoutes } from "./sources/routes.ts"
import { syncRoutes } from "./sync.ts"
import { trashRoutes } from "./trash.ts"

export type SessionUser = { id: string; email: string; name: string }

export type AppVariables = {
  /** Connects on first call; the connection is closed after the response. */
  db: () => Promise<Db>
  /**
   * Keeps the connection open until `p` settles, for a response that goes on
   * after the handler returns (a stream).
   */
  hold: (p: Promise<unknown>) => void
  config: () => ServerConfig
  auth: () => Promise<Auth>
  /** The blob store (Source files and segments); throws when there is none. */
  blobs: () => BlobStore
  /** The invite Mailer (mailer.ts), or null: invites use the link and inbox only. */
  mailer: () => Mailer | null
  /** Set by `requireUser`. */
  user: SessionUser
}

/** Hono env of the app. Runtimes' own bindings (e.g. HYPERDRIVE) are opaque here. */
export type AppEnv = {
  Bindings: ServerEnv
  Variables: AppVariables
}

export type AppOptions<Env extends ServerEnv> = {
  connect: Connect<Env>
  /** Told about newly logged ops after each push commits. Default: `noopRelay`. */
  relay?: Relay
  /** Where Source files and segments go (R2, a volume, memory in tests); null: none. */
  blobs?: (env: Env) => BlobStore | null
  /** Provider options for AI calls made by routes (tests pass a fake `fetch`). */
  ai?: ProviderOptions
  /** Starts, cancels and retries jobs. Without one, the job routes answer 501. */
  jobs?: JobRunner
  /**
   * Called once, in the background, on the first request a fresh instance
   * serves, after the response (the Worker wakes jobs `wrangler dev` lost on
   * a restart). It opens its own connections.
   */
  onFirstRequest?: (env: Env) => Promise<void>
  /**
   * The invite Mailer. Default: from config (Resend with RESEND_API_KEY, a
   * log-only one under test credentials, else none). Tests pass a memory one.
   */
  mailer?: (env: Env) => Mailer | null
  /**
   * Renders Views (`@seply/views/inspect`'s `readView`) for MCP: `get_view`
   * in the View's own shape, and the checks `create_expedition` and proposed
   * Views must pass. Without it, `get_view` lists and agents can't create
   * Expeditions or propose Views.
   */
  views?: ViewReader
  /**
   * The Client ID Metadata Document fetch for MCP OAuth (see `AuthOptions`).
   * Without it, MCP clients can't register, and agents use API tokens.
   */
  cimdFetch?: ClientMetadataResourceFetch
}

/** SMTP needs sockets: the runtime passes `mailer` (the Node entry does). */
let warnedSmtp = false
function smtpUnavailable(): null {
  if (!warnedSmtp)
    console.warn("mail: SMTP is configured but this runtime can't send it")
  warnedSmtp = true
  return null
}

class NoDatabase extends Error {}
class NoBlobStore extends Error {}

/** Runs `p` after the response on Workers; awaits it elsewhere (Node, tests). */
async function afterResponse(c: Context, p: Promise<unknown>) {
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined
  try {
    ctx = c.executionCtx
  } catch {
    ctx = undefined
  }
  if (ctx) ctx.waitUntil(p)
  else await p
}

function hasExecutionCtx(c: Context): boolean {
  try {
    return !!c.executionCtx
  } catch {
    return false
  }
}

function resources<Env extends ServerEnv>(
  opts: AppOptions<Env>
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let conn: Promise<DbConnection | null> | undefined
    let config: ServerConfig | undefined
    let auth: Promise<Auth> | undefined
    const held: Promise<unknown>[] = []
    const db = async () => {
      conn ??= opts.connect(c.env as Env)
      const got = await conn
      if (!got) throw new NoDatabase()
      return got.db
    }
    const getConfig = () => (config ??= readConfig(c.env ?? {}))
    c.set("db", db)
    c.set("hold", (p) => void held.push(p))
    c.set("config", getConfig)
    let store: BlobStore | null | undefined
    c.set("blobs", () => {
      store ??= opts.blobs?.(c.env as Env) ?? null
      if (!store) throw new NoBlobStore()
      return store
    })
    let mailer: Mailer | null | undefined
    c.set("mailer", () => {
      if (mailer !== undefined) return mailer
      if (opts.mailer) return (mailer = opts.mailer(c.env as Env))
      const mail = getConfig().mail
      return (mailer =
        mail?.kind === "resend"
          ? resendMailer({ apiKey: mail.apiKey, from: mail.from })
          : mail?.kind === "log"
            ? logMailer()
            : mail?.kind === "smtp"
              ? smtpUnavailable()
              : null)
    })
    c.set(
      "auth",
      () =>
        (auth ??= db().then((d) =>
          createAuth(getConfig(), d, { cimdFetch: opts.cimdFetch })
        ))
    )
    try {
      await next()
    } finally {
      if (conn) {
        const open = conn
        const close = () =>
          open
            .then((got) => got?.close())
            .catch((err) => console.error("db: close failed", err))
        if (held.length) {
          // A stream still reads: close when it ends, never before (and
          // never await it here, or the response waits for its own end).
          const closing = Promise.allSettled(held).then(close)
          if (hasExecutionCtx(c)) c.executionCtx.waitUntil(closing)
          else void closing
        } else await afterResponse(c, close())
      }
    }
  }
}

/** 401 unless the request carries a valid session; sets `c.var.user`. */
export function requireUser(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = await c.var.auth()
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: "sign in required" }, 401)
    const { id, email, name } = session.user
    c.set("user", { id, email, name })
    await next()
  }
}

const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AccessDenied)
    return c.json({ error: err.message }, err.status)
  if (err instanceof NoDatabase)
    return c.json({ error: "no database configured" }, 503)
  if (err instanceof NoBlobStore)
    return c.json({ error: "no file storage configured" }, 503)
  if (err instanceof ConfigError) {
    console.error("config:", err.message)
    return c.json({ error: "server not configured" }, 503)
  }
  console.error(err)
  return c.json({ error: "internal error" }, 500)
}

/**
 * The routes that live at the origin's root, not under /api (spec §6.1):
 * `/mcp` and the OAuth discovery documents under `/.well-known/`. Each
 * runtime mounts them at `/`, next to `createApp` at `/api`.
 */
export function createRootRoutes<Env extends ServerEnv>(opts: AppOptions<Env>) {
  const app = new Hono<AppEnv>()
  const res = resources(opts)
  app.use("/mcp", res)
  app.use("/.well-known/*", res)
  app.onError(onError)
  app.route("/", mcpRoutes(opts.relay ?? noopRelay, { views: opts.views }))
  return app
}

export function createApp<Env extends ServerEnv>(opts: AppOptions<Env>) {
  const app = new Hono<AppEnv>()
  const relay = opts.relay ?? noopRelay
  app.use(resources(opts))
  let first = !!opts.onFirstRequest
  app.use(async (c, next) => {
    if (first && opts.onFirstRequest) {
      first = false
      const run = opts
        .onFirstRequest(c.env as Env)
        .catch((err) => console.error("first request hook failed", err))
      await afterResponse(c, run)
    }
    await next()
  })

  app.onError(onError)

  app.get("/health", async (c) => {
    const branch = c.env?.DB_BRANCH
    let db: Db
    try {
      db = await c.var.db()
    } catch (err) {
      if (err instanceof NoDatabase)
        return c.json({ ok: true, db: "unconfigured", branch })
      console.error("health: database connect failed", err)
      return c.json({ ok: false, db: "error", branch }, 503)
    }
    try {
      const res = (await db.execute(
        sql`select current_database() as db`
      )) as unknown as { rows: { db: string }[] }
      return c.json({ ok: true, db: res.rows[0]?.db, branch })
    } catch (err) {
      console.error("health: database check failed", err)
      return c.json({ ok: false, db: "error", branch }, 503)
    }
  })

  // How the sign-in screen offers sign-in (WP-6.1). Google shows whenever
  // email + password isn't on, as hosted. Test credentials have no UI.
  app.get("/sign-in-options", (c) => {
    const config = c.var.config()
    const emailPassword = config.emailPassword
    return c.json({
      google: !!config.google || !emailPassword,
      emailPassword,
      signUp: emailPassword && config.emailSignUp,
    })
  })

  // Where the Map View's basemap comes from, when the runtime sets it
  // (self-host: MAP_TILES_URL or the Node entry's MAP_TILES_FILE). The web
  // build's own VITE_MAP_* values apply to whatever this leaves out.
  app.get("/map-config", (c) => {
    const { tiles, assets } = c.var.config().map
    return c.json({ tiles: tiles ?? null, assets: assets ?? null })
  })

  // Better Auth's routes: sign-in, callbacks (and the OAuth proxy's), session, sign-out.
  app.on(["GET", "POST"], "/auth/*", async (c) => {
    const auth = await c.var.auth()
    return auth.handler(c.req.raw)
  })

  const signedIn = requireUser()
  app.get("/me", signedIn, (c) => c.json({ user: c.var.user }))
  // The live room lets anonymous readers of a link in: before sign-in is required.
  app.route("/", liveRoutes(relay))
  app.use("/expeditions", signedIn)
  app.use("/expeditions/*", signedIn)
  app.route("/expeditions", expeditionRoutes(relay))
  app.route("/expeditions", createFlowRoutes(relay, opts.ai, opts.jobs))
  app.route("/expeditions", proposalRoutes(relay))
  app.route("/expeditions", askRoutes())
  app.route("/expeditions", sharingRoutes(relay))
  app.route("/expeditions", forkRoutes(relay))
  app.route("/expeditions", trashRoutes(relay))
  app.route("/invites", inviteRoutes())
  app.use("/agents", signedIn)
  app.use("/agents/*", signedIn)
  app.route("/agents", agentRoutes())
  app.use("/import", signedIn)
  app.route("/import", importRoutes(relay))
  app.use("/reader", signedIn)
  app.use("/reader/*", signedIn)
  app.route("/reader", readerRoutes(relay))
  app.use("/search", signedIn)
  app.route("/search", searchRoutes())
  app.route("/sources", sourceRoutes(relay))
  // Like Sources, export needs no sign-in where Visibility allows (export.ts).
  app.route("/export", exportRoutes())
  app.use("/ai", signedIn)
  app.use("/ai/*", signedIn)
  app.route("/ai", aiRoutes(opts.ai))
  app.use("/jobs/*", signedIn)
  app.route("/", jobRoutes(opts.jobs))
  app.route("/web-push", webPushRoutes())
  app.route("/", syncRoutes(relay))
  app.route("/", historyRoutes())

  app.notFound((c) => c.json({ error: "not found" }, 404))
  return app
}
