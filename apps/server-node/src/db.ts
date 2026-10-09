// Postgres on Node: one `pg` Pool per instance (spec §2.2). The app's
// `connect` checks a client out per request and returns it after the
// response; jobs do the same per use.
import { schema } from "@seply/domain"
import type { Db, DbConnection } from "@seply/server"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

export function createPool(connectionString: string, max: number): pg.Pool {
  const pool = new pg.Pool({ connectionString, max })
  // An idle client's error (the server restarted) must not crash the process.
  pool.on("error", (err) => console.error("db: idle client error", err.message))
  return pool
}

/** One pooled client, wrapped in Drizzle; `close` returns it to the pool. */
export async function connectPool(pool: pg.Pool): Promise<DbConnection> {
  const client = await pool.connect()
  let released = false
  return {
    db: drizzle(client, { schema }) as unknown as Db,
    close: async () => {
      if (released) return
      released = true
      client.release()
    },
  }
}
