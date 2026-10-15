// The welcome step (spec §3.1): `welcomed` on GET /me, POST /me/welcomed,
// and the migration that marked every account that existed then.
import { PGlite } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { schema } from "@seply/domain"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { signUp, TEST_ENV, testApp, testDb, type TestUser } from "./test-harness.ts"

async function setup() {
  const db = await testDb()
  const app = testApp(TEST_ENV, db)
  const ada = await signUp(app, "ada")
  const me = async (u: TestUser) =>
    (await (await app.request("/api/me", { headers: u.headers })).json()) as {
      welcomed: boolean
    }
  const mark = (u: TestUser) =>
    app.request("/api/me/welcomed", { method: "POST", headers: u.headers })
  const welcomedAt = async (u: TestUser) =>
    (
      await db
        .select({ at: schema.users.welcomedAt })
        .from(schema.users)
        .where(eq(schema.users.id, u.id))
    )[0]?.at
  return { app, ada, me, mark, welcomedAt }
}

describe("the welcome step", () => {
  it("is not seen by a new account", async () => {
    const s = await setup()
    expect(await s.me(s.ada)).toMatchObject({ welcomed: false })
    expect(await s.welcomedAt(s.ada)).toBeNull()
  })

  it("is marked once, and marking again keeps the first time", async () => {
    const s = await setup()
    const first = await s.mark(s.ada)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ welcomed: true })
    expect(await s.me(s.ada)).toMatchObject({ welcomed: true })
    const at = await s.welcomedAt(s.ada)
    expect(at).toBeInstanceOf(Date)

    const again = await s.mark(s.ada)
    expect(again.status).toBe(200)
    expect(await s.welcomedAt(s.ada)).toEqual(at)
  })

  it("marks only the caller", async () => {
    const s = await setup()
    const bob = await signUp(s.app, "bob")
    await s.mark(s.ada)
    expect(await s.me(bob)).toMatchObject({ welcomed: false })
  })

  it("needs a signed-in account", async () => {
    const s = await setup()
    const res = await s.app.request("/api/me/welcomed", { method: "POST" })
    expect(res.status).toBe(401)
  })
})

describe("the migration", () => {
  it("marks every account that exists when it runs, and no later one", async () => {
    const full = fileURLToPath(new URL("../drizzle", import.meta.url))
    const dir = mkdtempSync(join(tmpdir(), "seply-migrations-"))
    try {
      // The migrations before the welcome step.
      cpSync(full, dir, { recursive: true })
      const journalPath = join(dir, "meta/_journal.json")
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { tag: string }[]
      }
      const at = journal.entries.findIndex((e) => e.tag === "0010_welcomed")
      expect(at).toBeGreaterThan(0)
      journal.entries = journal.entries.slice(0, at)
      writeFileSync(journalPath, JSON.stringify(journal))

      const db = drizzle(new PGlite({ extensions: { pg_trgm } }), { schema })
      await migrate(db, { migrationsFolder: dir })
      await db.execute(
        `insert into users (id, name, email, created_at)
         values ('old', 'Old', 'old@example.com', '2026-01-02T03:04:05Z')`
      )
      await migrate(db, { migrationsFolder: full })
      await db.execute(
        `insert into users (id, name, email) values ('new', 'New', 'new@example.com')`
      )
      const rows = await db
        .select({ id: schema.users.id, welcomedAt: schema.users.welcomedAt })
        .from(schema.users)
      const by = Object.fromEntries(rows.map((r) => [r.id, r.welcomedAt]))
      expect(by.old).toEqual(new Date("2026-01-02T03:04:05Z"))
      expect(by.new).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
