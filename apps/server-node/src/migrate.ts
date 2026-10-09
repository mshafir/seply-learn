// Applies the committed migrations (@seply/server's drizzle folder), under a
// Postgres advisory lock so instances starting together take turns.
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

/** @seply/server's `drizzle/` (its `./migrations` export). */
export const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  join(
    dirname(fileURLToPath(import.meta.resolve("@seply/server"))),
    "..",
    "drizzle"
  )

/** Any number that's ours: "seply" in ASCII. */
const LOCK = 0x7365706c79

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK])
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR })
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK]).catch(() => {})
    await client.end()
  }
}
