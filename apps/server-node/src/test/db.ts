// A fresh, migrated database per test file, next to TEST_DATABASE_URL (any
// Postgres the tests may create databases on). Without it, database tests skip.
import pg from "pg"
import { runMigrations } from "../migrate.ts"

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

export async function freshDatabase(suffix: string) {
  const base = new URL(TEST_DATABASE_URL!)
  const name = `${base.pathname.slice(1)}_${suffix}`
  const admin = async (sql: string) => {
    const c = new pg.Client({ connectionString: base.href })
    await c.connect()
    try {
      await c.query(sql)
    } finally {
      await c.end()
    }
  }
  await admin(`drop database if exists "${name}" with (force)`)
  await admin(`create database "${name}"`)
  const url = new URL(base.href)
  url.pathname = `/${name}`
  await runMigrations(url.href)
  return {
    url: url.href,
    drop: () => admin(`drop database if exists "${name}" with (force)`),
  }
}
