// @umbel/worker: see README.md for this package's contract.
// Static assets (the SPA) are served by Cloudflare before this code runs;
// only /api/* reaches the Worker (see run_worker_first in wrangler.jsonc).
import { connectPg, createApp, type ServerEnv } from "@umbel/server"
import { Hono } from "hono"

export type Bindings = ServerEnv & {
  HYPERDRIVE?: Hyperdrive
}

export const app = new Hono<{ Bindings: Bindings }>()

app.route(
  "/api",
  createApp<Bindings>({
    // Hyperdrive holds the real pool: a client per request, never at module scope.
    connect: async (env) =>
      env?.HYPERDRIVE ? connectPg(env.HYPERDRIVE.connectionString) : null,
  })
)

app.notFound((c) => c.json({ error: "not found" }, 404))

export default app
