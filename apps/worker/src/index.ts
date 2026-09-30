// @seply/worker: see README.md for this package's contract.
// Static assets (the SPA) are served by Cloudflare before this code runs;
// only /api/* reaches the Worker (see run_worker_first in wrangler.jsonc).
import {
  connectPg,
  createApp,
  r2BlobStore,
  type JobRunner,
  type Relay,
} from "@seply/server"
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
const relay: Relay = {
  published: (id, batch) =>
    roomRelay(bindings().EXPEDITION_ROOM).published(id, batch),
  build: (id, evt) => roomRelay(bindings().EXPEDITION_ROOM).build!(id, evt),
  handleUpgrade: (req, join) =>
    roomRelay(bindings().EXPEDITION_ROOM).handleUpgrade!(req, join),
}
const runner = (): JobRunner => workerJobRunner(bindings(), relay)
const jobs: JobRunner = {
  get registry() {
    return runner().registry
  },
  start: (db, req) => runner().start(db, req),
  cancel: (db, id) => runner().cancel(db, id),
  retry: (db, id) => runner().retry(db, id),
  wake: (db) => runner().wake(db),
}

export const app = new Hono<{ Bindings: Bindings }>()

app.route(
  "/api",
  createApp<Bindings>({
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
  })
)

app.notFound((c) => c.json({ error: "not found" }, 404))

export default app
