// @umbel/worker: see README.md for this package's contract.
// Static assets (the SPA) are served by Cloudflare before this code runs;
// only /api/* reaches the Worker (see run_worker_first in wrangler.jsonc).
import { Hono } from "hono"
import { Client } from "pg"

export type Bindings = {
  HYPERDRIVE?: Hyperdrive
  /** The Neon branch this deploy reads from, set by CI. */
  DB_BRANCH?: string
}

export const app = new Hono<{ Bindings: Bindings }>()

app.get("/api/health", async (c) => {
  const branch = c.env?.DB_BRANCH
  const hyperdrive = c.env?.HYPERDRIVE
  if (!hyperdrive) return c.json({ ok: true, db: "unconfigured", branch })

  // Hyperdrive holds the real pool: create a client per request.
  const client = new Client({ connectionString: hyperdrive.connectionString })
  try {
    await client.connect()
    const { rows } = await client.query<{ db: string }>(
      "select current_database() as db"
    )
    return c.json({ ok: true, db: rows[0]?.db, branch })
  } catch (err) {
    console.error("health: database check failed", err)
    return c.json({ ok: false, db: "error", branch }, 503)
  } finally {
    c.executionCtx.waitUntil(client.end())
  }
})

app.notFound((c) => c.json({ error: "not found" }, 404))

export default app
