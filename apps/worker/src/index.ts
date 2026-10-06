// @seply/worker: see README.md for this package's contract.
// Static assets (the SPA) are served by Cloudflare before this code runs;
// only /api/*, /mcp and /.well-known/* reach the Worker (see
// run_worker_first in wrangler.jsonc).
import {
  connectPg,
  createApp,
  createRootRoutes,
  r2BlobStore,
  type AppOptions,
  type JobRunner,
  type Relay,
} from "@seply/server"
import { readView } from "@seply/views/inspect"
import { env } from "cloudflare:workers"
import { Hono } from "hono"
import type { Bindings } from "./bindings.ts"
import { workerJobRunner } from "./jobs.ts"
import { roomRelay } from "./relay.ts"

export type { Bindings } from "./bindings.ts"
export { ExpeditionRoom } from "./room.ts"
export { JobWorkflow } from "./jobs.ts"

const bindings = () => env as unknown as Bindings

// The app is built once per isolate; the relay and runner reach the bindings
// when they are called.
const rooms = () => roomRelay(bindings().EXPEDITION_ROOM)
const relay: Relay = {
  published: (id, batch) => rooms().published(id, batch),
  build: (id, evt) => rooms().build!(id, evt),
  poke: (id, headSeq) => rooms().poke!(id, headSeq),
  kick: (id, userId, reason) => rooms().kick!(id, userId, reason),
  agentPresence: (id, agent) => rooms().agentPresence!(id, agent),
  handleUpgrade: (req, join) => rooms().handleUpgrade!(req, join),
}
const runner = (): JobRunner => workerJobRunner(bindings(), relay)
const jobs: JobRunner = {
  get registry() {
    return runner().registry
  },
  start: (db, req) => runner().start(db, req),
  cancel: (db, id) => runner().cancel(db, id),
  retry: (db, id) => runner().retry(db, id),
  continue: (db, id) => runner().continue(db, id),
  wake: (db) => runner().wake(db),
}

/**
 * The CIMD metadata fetch (spec §6.1): Workers' outbound fetches can't reach
 * private or loopback addresses, so refusing redirects is what's left to do
 * (`@better-auth/cimd` validates the URL and the document).
 */
const cimdFetch: AppOptions<Bindings>["cimdFetch"] = (input, init) =>
  fetch(input, { ...init, redirect: "manual" })

export const app = new Hono<{ Bindings: Bindings }>()

const options: AppOptions<Bindings> = {
  // Hyperdrive holds the real pool: a client per request, never at module scope.
  connect: async (env) =>
    env?.HYPERDRIVE ? connectPg(env.HYPERDRIVE.connectionString) : null,
  relay,
  jobs,
  // wrangler dev doesn't resume running Workflows after a restart; wake them.
  onFirstRequest: async (env) => {
    if (env?.JOBS_WAKE_ON_START !== "1" || !env.HYPERDRIVE) return
    const conn = await connectPg(env.HYPERDRIVE.connectionString)
    try {
      const n = await jobs.wake(conn.db)
      if (n) console.log(`jobs: woke ${n} running job(s)`)
    } finally {
      await conn.close()
    }
  },
  blobs: (env) => (env?.SOURCES ? r2BlobStore(env.SOURCES) : null),
  // MCP (WP-5.4): Views read as a reader sees them, and checked.
  views: { read: readView },
  cimdFetch,
}

app.route("/api", createApp<Bindings>(options))
// /mcp and the OAuth discovery documents live at the origin's root.
app.route("/", createRootRoutes<Bindings>(options))

app.notFound((c) => c.json({ error: "not found" }, 404))

export default app
