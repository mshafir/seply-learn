#!/usr/bin/env node
// Applies the committed drizzle-kit migrations (../drizzle) to $DATABASE_URL.
// CI runs it before each deploy, against the Neon branch's direct (non-pooled)
// connection string: see docs/ops/deploy.md. Safe to re-run; applied
// migrations are recorded in drizzle.__drizzle_migrations.
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("migrate: DATABASE_URL is not set")
  process.exit(2)
}

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle"
)
const client = new pg.Client({ connectionString: url })
try {
  await client.connect()
  await migrate(drizzle(client), { migrationsFolder })
  console.log(`migrate: up to date (${client.database})`)
} catch (err) {
  // Never print the connection string.
  console.error(`::error::migrate failed: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
