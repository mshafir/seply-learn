// Database access. Runtimes hand the app a `connect` function; the app calls
// it at most once per request and closes the connection when the response is
// done. Workers must never hold a client across requests (Hyperdrive pools).
import { schema } from "@seply/domain"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

export type Schema = typeof schema
/** Any Drizzle Postgres database over the domain schema (node-postgres, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>

export type DbConnection = {
  db: Db
  close(): Promise<void>
}

/** Returns null when this deploy has no database configured. */
export type Connect<Env> = (env: Env) => Promise<DbConnection | null>

/** One `pg` client for one request, wrapped in Drizzle. */
export async function connectPg(
  connectionString: string
): Promise<DbConnection> {
  const client = new pg.Client({ connectionString })
  await client.connect()
  return {
    db: drizzle(client, { schema }) as unknown as Db,
    close: () => client.end(),
  }
}
