// The Node entry, composed (spec §2.2): the same `@seply/server` app as the
// Worker, at /api, with /mcp and /.well-known/* at the root and the SPA for
// everything else; in-process rooms over `ws`; pg-boss jobs; blobs on a
// volume or S3; the invite Mailer; the daily Trash purge. `startServer`
// returns a handle whose `close` shuts it all down in order.
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { serve, type ServerType } from "@hono/node-server"
import { fetchClientMetadataResource } from "@better-auth/cimd/node"
import {
  createApp,
  createJobRunner,
  createRootRoutes,
  JOB_KINDS,
  notifyUser,
  purgeTrash,
  readVapid,
  type AppOptions,
  type JobDeps,
  type JobRunner,
  type Relay,
  type ServerEnv,
} from "@seply/server"
import { readView } from "@seply/views/inspect"
import { Hono } from "hono"
import { PgBoss } from "pg-boss"
import { WebSocketServer } from "ws"
import { blobStoreFor } from "./blobs.ts"
import { connectPool, createPool } from "./db.ts"
import type { NodeConfig } from "./env.ts"
import { createPgBossEngine } from "./jobs.ts"
import { createNodeRooms, type NodeRooms } from "./live.ts"
import { mailerFor } from "./mailer.ts"
import { runMigrations } from "./migrate.ts"
import { serveSpa } from "./static.ts"

export const TRASH_QUEUE = "seply-trash-purge"

export type RunningServer = {
  port: number
  rooms: NodeRooms
  jobs: JobRunner
  /** Graceful: stops taking requests and jobs, says goodbye to sockets, waits for work. */
  close(): Promise<void>
}

/** A WebSocket upgrade waiting for the app to authorise it. */
type PendingUpgrade = {
  incoming: IncomingMessage
  socket: Duplex
  head: Buffer
  upgraded: boolean
}

export async function startServer(config: NodeConfig): Promise<RunningServer> {
  if (config.migrateOnStart) {
    await runMigrations(config.databaseUrl)
    console.log("migrate: up to date")
  }

  const pool = createPool(config.databaseUrl, config.poolMax)
  const env: ServerEnv = config.env

  // --- Live rooms ---------------------------------------------------------
  const rooms = createNodeRooms({
    databaseUrl: config.databaseUrl,
    notify: async (channel, payload) => {
      await pool.query("select pg_notify($1, $2)", [channel, payload])
    },
    headSeq: async (id) => {
      const { rows } = await pool.query<{ head_seq: number }>(
        "select head_seq from expeditions where id = $1",
        [id]
      )
      return rows[0]?.head_seq ?? null
    },
    openBuilds: async (id) => {
      const { rows } = await pool.query<{
        id: string
        kind: string
        status: "queued" | "running" | "paused"
        step: string | null
        progress: number
        updated_at: Date
      }>(
        `select id, kind, status, step, progress, updated_at from jobs
         where expedition_id = $1 and status in ('queued', 'running', 'paused')`,
        [id]
      )
      return rows.map((j) => ({
        jobId: j.id,
        kind: j.kind,
        status: j.status,
        step: j.step ?? "",
        progress: j.progress,
        at: new Date(j.updated_at).toISOString(),
      }))
    },
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  const upgrades = new WeakMap<Request, PendingUpgrade>()
  const relay: Relay = {
    ...rooms.relay,
    // The live route has checked access: upgrade the socket it came on.
    handleUpgrade(req, join) {
      const pending = upgrades.get(req)
      if (!pending || pending.upgraded)
        return new Response("expected a WebSocket upgrade", { status: 426 })
      pending.upgraded = true
      wss.handleUpgrade(
        pending.incoming,
        pending.socket,
        pending.head,
        (ws) => {
          rooms.accept(ws, join).catch((err) => {
            console.error("live: join failed", err)
            ws.close(1011, "join failed")
          })
        }
      )
      // Never written: the socket is the ws library's now.
      return new Response(null, { status: 200 })
    },
  }

  // --- Blobs, mail, jobs --------------------------------------------------
  const blobs = blobStoreFor(config.blobs)
  const mailer = mailerFor(config.server.mail)
  const vapid = readVapid(env)
  const deps: JobDeps = {
    connect: () => connectPool(pool),
    relay,
    notify: (db, userId, note) =>
      notifyUser(db, userId, note, { vapid }).then(() => {}),
    services: { env, blobs, views: { read: readView } },
  }
  // Supervision finds attempts whose instance stopped heartbeating.
  const supervise = Math.max(5, Math.floor(config.jobHeartbeatSeconds / 2))
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    max: 4,
    superviseIntervalSeconds: supervise,
    monitorIntervalSeconds: supervise,
    schema: "pgboss",
    application_name: "seply-learn-jobs",
  })
  boss.on("error", (err) => console.error("jobs: pg-boss", err))
  await boss.start()
  const engine = createPgBossEngine({
    boss,
    pool,
    deps,
    registry: JOB_KINDS,
    concurrency: config.jobConcurrency,
    heartbeatSeconds: config.jobHeartbeatSeconds,
  })
  const jobs = createJobRunner({ engine, registry: JOB_KINDS, relay })

  // The daily Trash purge (WP-5.2): one pg-boss schedule, so one instance runs it.
  if (!(await boss.getQueue(TRASH_QUEUE))) await boss.createQueue(TRASH_QUEUE)
  if (config.trashPurgeCron) {
    await boss.schedule(TRASH_QUEUE, config.trashPurgeCron, null, { tz: "UTC" })
    await boss.work(TRASH_QUEUE, async () => {
      const conn = await connectPool(pool)
      try {
        const purged = await purgeTrash(conn.db, blobs)
        if (purged.length) console.log(`trash: purged ${purged.length}`)
      } finally {
        await conn.close()
      }
    })
  } else await boss.unschedule(TRASH_QUEUE).catch(() => {})

  // --- HTTP ---------------------------------------------------------------
  const options: AppOptions<ServerEnv> = {
    connect: async () => connectPool(pool),
    relay,
    jobs,
    blobs: () => blobs,
    mailer: () => mailer,
    views: { read: readView },
    // Resolves the host once and refuses private addresses and redirects.
    cimdFetch: fetchClientMetadataResource,
  }
  const app = new Hono<{ Bindings: ServerEnv }>()
  app.route("/api", createApp<ServerEnv>(options))
  app.route("/", createRootRoutes<ServerEnv>(options))
  if (config.webDist) {
    const spa = serveSpa(config.webDist)
    app.use("*", async (c, next) => {
      const path = c.req.path
      if (
        path.startsWith("/api/") ||
        path === "/mcp" ||
        path.startsWith("/.well-known/")
      )
        return next()
      return spa(c, next)
    })
  }
  app.notFound((c) => c.json({ error: "not found" }, 404))

  await rooms.start()
  await engine.start()

  const server: ServerType = await new Promise((ok) => {
    const s = serve(
      {
        fetch: (req) => app.fetch(req, env),
        port: config.port,
        hostname: config.host,
      },
      () => ok(s)
    )
  })
  server.on(
    "upgrade",
    (incoming: IncomingMessage, socket: Duplex, head: Buffer) => {
      void upgrade(incoming, socket, head)
    }
  )
  const upgrade = async (
    incoming: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ) => {
    socket.on("error", () => {})
    // Only the live route takes upgrades.
    if (!incoming.url?.startsWith("/api/")) {
      socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n")
      return
    }
    const headers = new Headers()
    for (const [k, v] of Object.entries(incoming.headers))
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v)
    const req = new Request(
      `http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`,
      {
        method: incoming.method,
        headers,
      }
    )
    const pending: PendingUpgrade = { incoming, socket, head, upgraded: false }
    upgrades.set(req, pending)
    let res: Response
    try {
      res = await app.fetch(req, env)
    } catch (err) {
      console.error("live: upgrade failed", err)
      res = new Response("internal error", { status: 500 })
    }
    if (pending.upgraded) return
    // Refused (404, 401, 501…): answer over plain HTTP and hang up.
    const body = Buffer.from(await res.arrayBuffer())
    socket.end(
      `HTTP/1.1 ${res.status} ${res.statusText || "Error"}\r\n` +
        `content-type: ${res.headers.get("content-type") ?? "text/plain"}\r\n` +
        `content-length: ${body.length}\r\nconnection: close\r\n\r\n` +
        body.toString("utf8")
    )
  }

  const address = server.address()
  const port =
    typeof address === "object" && address ? address.port : config.port

  let closing: Promise<void> | null = null
  const close = () =>
    (closing ??= (async () => {
      const grace = config.shutdownGraceMs
      // No new requests or jobs; open requests finish.
      const httpClosed = new Promise<void>((ok) => server.close(() => ok()))
      if ("closeIdleConnections" in server) server.closeIdleConnections()
      await engine.stop()
      await rooms.stop()
      wss.close()
      // Running jobs get the grace period; any still running are picked up
      // again (by another instance, or this one restarted) from their last step.
      await boss
        .stop({ graceful: true, timeout: grace, close: true })
        .catch(() => {})
      await Promise.race([httpClosed, sleep(Math.min(grace, 5000))])
      if ("closeAllConnections" in server) server.closeAllConnections()
      await pool.end().catch(() => {})
    })())

  return { port, rooms, jobs, close }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
