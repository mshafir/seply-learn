// The Hono app factory (spec §2.2): one app, mounted at /api by each runtime
// (the Worker now, the Node server later). Runtimes supply env and a
// per-request `connect`; nothing here holds state across requests.
import { sql } from "drizzle-orm"
import { Hono, type Context, type MiddlewareHandler } from "hono"
import { createAuth, type Auth } from "./auth.ts"
import {
  ConfigError,
  readConfig,
  type ServerConfig,
  type ServerEnv,
} from "./config.ts"
import type { Connect, Db, DbConnection } from "./db.ts"
import { expeditionRoutes } from "./expeditions.ts"
import { importRoutes } from "./import.ts"
import { noopRelay, type Relay } from "./relay.ts"
import { searchRoutes } from "./search.ts"
import { syncRoutes } from "./sync.ts"

export type SessionUser = { id: string; email: string; name: string }

export type AppVariables = {
  /** Connects on first call; the connection is closed after the response. */
  db: () => Promise<Db>
  config: () => ServerConfig
  auth: () => Promise<Auth>
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
}

class NoDatabase extends Error {}

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

function resources<Env extends ServerEnv>(
  opts: AppOptions<Env>
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let conn: Promise<DbConnection | null> | undefined
    let config: ServerConfig | undefined
    let auth: Promise<Auth> | undefined
    const db = async () => {
      conn ??= opts.connect(c.env as Env)
      const got = await conn
      if (!got) throw new NoDatabase()
      return got.db
    }
    const getConfig = () => (config ??= readConfig(c.env ?? {}))
    c.set("db", db)
    c.set("config", getConfig)
    c.set("auth", () => (auth ??= db().then((d) => createAuth(getConfig(), d))))
    try {
      await next()
    } finally {
      if (conn) {
        const closing = conn
          .then((got) => got?.close())
          .catch((err) => console.error("db: close failed", err))
        await afterResponse(c, closing)
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

export function createApp<Env extends ServerEnv>(opts: AppOptions<Env>) {
  const app = new Hono<AppEnv>()
  const relay = opts.relay ?? noopRelay
  app.use(resources(opts))

  app.onError((err, c) => {
    if (err instanceof NoDatabase)
      return c.json({ error: "no database configured" }, 503)
    if (err instanceof ConfigError) {
      console.error("config:", err.message)
      return c.json({ error: "server not configured" }, 503)
    }
    console.error(err)
    return c.json({ error: "internal error" }, 500)
  })

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

  // Better Auth's routes: sign-in, callbacks (and the OAuth proxy's), session, sign-out.
  app.on(["GET", "POST"], "/auth/*", async (c) => {
    const auth = await c.var.auth()
    return auth.handler(c.req.raw)
  })

  const signedIn = requireUser()
  app.get("/me", signedIn, (c) => c.json({ user: c.var.user }))
  app.use("/expeditions", signedIn)
  app.use("/expeditions/*", signedIn)
  app.route("/expeditions", expeditionRoutes(relay))
  app.use("/import", signedIn)
  app.route("/import", importRoutes(relay))
  app.use("/search", signedIn)
  app.route("/search", searchRoutes())
  app.route("/", syncRoutes(relay))

  app.notFound((c) => c.json({ error: "not found" }, 404))
  return app
}
