// Hosted access approval (spec §2.6, §3.12; WP-7.3): the guard, the request
// and admin routes, the emails and the migration. Which routes are gated is
// in permissions-matrix.test.ts.
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
import {
  ApprovalRequired,
  requireApproval,
  type AccessRequestsOverview,
  type AccessState,
} from "./approval.ts"
import { readConfig, type ServerEnv } from "./config.ts"
import type { Db } from "./db.ts"
import { memoryMailer } from "./mailer.ts"
import { signUp, TEST_ENV, testApp, testDb, type TestUser } from "./test-harness.ts"

const HOSTED: ServerEnv = {
  ...TEST_ENV,
  ACCESS_APPROVAL: "1",
  ADMIN_EMAILS: " Ada@Example.com , root@example.com",
  // An instance key (never called: the estimate doesn't reach the provider).
  AI_GATEWAY_API_KEY: "vck_instance_not_real_0000",
}
/** The hosted setup with readers' own keys too. */
const BOTH: ServerEnv = {
  ...HOSTED,
  AI_KEY_MODE: "both",
  AI_KEYS_MASTER_KEY: btoa(
    String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1))
  ),
}

async function setup(env: ServerEnv = HOSTED) {
  const db = await testDb()
  const mailer = memoryMailer()
  const app = testApp(env, db, undefined, { mailer })
  const ada = await signUp(app, "ada") // an admin
  const bob = await signUp(app, "bob")
  const me = async (u: TestUser) =>
    (
      (await (await app.request("/api/me", { headers: u.headers })).json()) as {
        access: AccessState
      }
    ).access
  const post = (u: TestUser, path: string, body: unknown = {}) =>
    app.request(path, {
      method: "POST",
      headers: u.headers,
      body: JSON.stringify(body),
    })
  const create = (u: TestUser) =>
    post(u, "/api/expeditions", { title: "Compute" })
  /** AI work on this server's key (the cheapest gated route). */
  const estimate = (u: TestUser) =>
    post(u, "/api/ai/estimate", { sourceChars: 1000 })
  const list = async (u: TestUser) =>
    app.request("/api/admin/access-requests", { headers: u.headers })
  return { db, app, mailer, ada, bob, me, post, create, estimate, list }
}

describe("readConfig: access approval", () => {
  it("is on only for ACCESS_APPROVAL=1, with admins lower-cased", () => {
    expect(readConfig(HOSTED).access).toEqual({
      approval: true,
      admins: ["ada@example.com", "root@example.com"],
    })
    expect(readConfig(TEST_ENV).access).toEqual({ approval: false, admins: [] })
    for (const v of ["0", "true", "yes", ""])
      expect(readConfig({ ...TEST_ENV, ACCESS_APPROVAL: v }).access.approval).toBe(
        false
      )
  })
})

describe("requireApproval (the guard on this server's AI)", () => {
  const guard = (db: Db, env: ServerEnv, userId: string) =>
    requireApproval(db, readConfig(env), userId, env)
  const approve = (db: Db, userId: string) =>
    db
      .update(schema.users)
      .set({ approvedAt: new Date() })
      .where(eq(schema.users.id, userId))

  it("lets everyone through with the flag off", async () => {
    const s = await setup(TEST_ENV)
    await expect(guard(s.db, TEST_ENV, s.bob.id)).resolves.toBeUndefined()
    await expect(
      guard(s.db, { ...TEST_ENV, AI_KEY_MODE: "both" }, s.bob.id)
    ).resolves.toBeUndefined()
  })

  it("instance mode: refuses an unapproved account, plainly, and lets approved ones and admins through", async () => {
    const s = await setup()
    const refused = guard(s.db, HOSTED, s.bob.id)
    await expect(refused).rejects.toBeInstanceOf(ApprovalRequired)
    await expect(refused).rejects.toThrow(/only for accounts an admin has enabled/)
    // Ada is an admin (ADMIN_EMAILS matches whatever the case).
    await expect(guard(s.db, HOSTED, s.ada.id)).resolves.toBeUndefined()
    await approve(s.db, s.bob.id)
    await expect(guard(s.db, HOSTED, s.bob.id)).resolves.toBeUndefined()
  })

  it("byok mode: never gates (everyone spends their own key)", async () => {
    const s = await setup()
    const byok = { ...HOSTED, AI_KEY_MODE: "byok" }
    await expect(guard(s.db, byok, s.bob.id)).resolves.toBeUndefined()
  })

  it("both mode: own key or approval; else needs-key", async () => {
    const s = await setup(BOTH)
    const refused = guard(s.db, BOTH, s.bob.id)
    await expect(refused).rejects.toBeInstanceOf(ApprovalRequired)
    await expect(refused).rejects.toMatchObject({ code: "needs-key", status: 409 })
    await expect(guard(s.db, BOTH, s.ada.id)).resolves.toBeUndefined()
    const put = await s.app.request("/api/ai/keys/anthropic", {
      method: "PUT",
      headers: s.bob.headers,
      body: JSON.stringify({ apiKey: "sk-ant-api03-bobs-own-key-1234" }),
    })
    expect(put.status).toBe(200)
    await expect(guard(s.db, BOTH, s.bob.id)).resolves.toBeUndefined()
  })

  it("answers an AI route with 403 approval_required (instance) or 409 needs-key (both)", async () => {
    const s = await setup()
    const res = await s.estimate(s.bob)
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, string>
    expect(body.code).toBe("approval_required")
    expect(body.error).toBe("approval_required")
    expect(body.message).toMatch(/ask to use it in Settings/)

    const b = await setup(BOTH)
    const both = await b.estimate(b.bob)
    expect(both.status).toBe(409)
    expect(await both.json()).toMatchObject({
      error: "needs-key",
      code: "needs-key",
      message: expect.stringMatching(/Add your own AI key in Settings/),
    })
  })
})

describe("creating is open to every account", () => {
  // Import and MCP create_expedition: permissions-matrix.test.ts.
  it("creates and Forks without approval, in every key mode", async () => {
    for (const env of [HOSTED, BOTH, { ...HOSTED, AI_KEY_MODE: "byok" }]) {
      const s = await setup(env)
      const created = await s.create(s.bob)
      expect(created.status).toBe(201)
      const { id } = (await created.json()) as { id: string }
      const fork = await s.post(s.bob, `/api/expeditions/${id}/fork`)
      expect(fork.status).toBe(201)
    }
  })
})

describe("GET /me", () => {
  it("says nothing changes with the flag off", async () => {
    const s = await setup(TEST_ENV)
    expect(await s.me(s.bob)).toEqual({
      approvalRequired: false,
      approved: true,
      admin: false,
      request: null,
    })
    expect(await s.me(s.ada)).toMatchObject({ admin: false })
  })

  it("reports the approval state, the admin flag and a pending request", async () => {
    const s = await setup()
    expect(await s.me(s.ada)).toEqual({
      approvalRequired: true,
      approved: true,
      admin: true,
      request: null,
    })
    expect(await s.me(s.bob)).toEqual({
      approvalRequired: true,
      approved: false,
      admin: false,
      request: null,
    })
    await s.post(s.bob, "/api/access-requests", { note: "For my reading group" })
    expect((await s.me(s.bob)).request).toMatchObject({
      note: "For my reading group",
      createdAt: expect.any(String),
    })
  })
})

describe("access requests", () => {
  it("takes one pending request per account and emails every admin", async () => {
    const s = await setup()
    const first = await s.post(s.bob, "/api/access-requests", {
      note: "  For my reading group ",
    })
    expect(first.status).toBe(201)
    expect(
      ((await first.json()) as { request: { note: string } }).request.note
    ).toBe("For my reading group")
    const again = await s.post(s.bob, "/api/access-requests")
    expect(again.status).toBe(409)
    expect(((await again.json()) as { error: string }).error).toBe(
      "already-requested"
    )
    expect(s.mailer.sent.map((m) => m.to)).toEqual([
      "ada@example.com",
      "root@example.com",
    ])
    const mail = s.mailer.sent[0]!
    expect(mail.subject).toBe("bob asked to use the AI on Seply Learn")
    expect(mail.text).toContain(
      "bob (bob@example.com) asked to use this server's AI"
    )
    expect(mail.text).toContain("Their note: For my reading group")
    expect(mail.text).toContain("/settings/access-requests")
  })

  it("refuses a request from an approved account, and the note's length", async () => {
    const s = await setup()
    expect((await s.post(s.ada, "/api/access-requests")).status).toBe(409)
    expect(
      (await s.post(s.bob, "/api/access-requests", { note: "x".repeat(1001) }))
        .status
    ).toBe(400)
  })

  it("lists pending requests for admins only; approving lets the account use the server's AI and emails it", async () => {
    const s = await setup()
    await s.post(s.bob, "/api/access-requests", { note: "Please" })
    expect((await s.list(s.bob)).status).toBe(403)
    const before = (await (await s.list(s.ada)).json()) as AccessRequestsOverview
    expect(before.pending).toEqual([
      {
        id: expect.any(String),
        user: { id: s.bob.id, name: "bob", email: "bob@example.com" },
        note: "Please",
        createdAt: expect.any(String),
      },
    ])
    expect(before.approved.map((a) => a.id)).not.toContain(s.bob.id)

    const id = before.pending[0]!.id
    expect((await s.post(s.bob, `/api/admin/access-requests/${id}/approve`)).status).toBe(403)
    s.mailer.sent.length = 0
    const ok = await s.post(s.ada, `/api/admin/access-requests/${id}/approve`)
    expect(ok.status).toBe(200)
    expect(s.mailer.sent).toHaveLength(1)
    expect(s.mailer.sent[0]).toMatchObject({
      to: "bob@example.com",
      subject: "You can now use the AI on Seply Learn",
    })
    expect((await s.me(s.bob)).approved).toBe(true)
    expect((await s.estimate(s.bob)).status).toBe(200)

    const after = (await (await s.list(s.ada)).json()) as AccessRequestsOverview
    expect(after.pending).toEqual([])
    expect(after.approved.find((a) => a.id === s.bob.id)).toMatchObject({
      email: "bob@example.com",
      approvedAt: expect.any(String),
    })
    // Decided once.
    expect((await s.post(s.ada, `/api/admin/access-requests/${id}/decline`)).status).toBe(404)
  })

  it("declines without approving or emailing; the account may ask again", async () => {
    const s = await setup()
    await s.post(s.bob, "/api/access-requests")
    const { pending } = (await (await s.list(s.ada)).json()) as AccessRequestsOverview
    s.mailer.sent.length = 0
    const res = await s.post(s.ada, `/api/admin/access-requests/${pending[0]!.id}/decline`)
    expect(res.status).toBe(200)
    expect(s.mailer.sent).toEqual([])
    expect(await s.me(s.bob)).toMatchObject({ approved: false, request: null })
    expect((await s.estimate(s.bob)).status).toBe(403)
    expect((await s.post(s.bob, "/api/access-requests")).status).toBe(201)
  })

  it("doesn't exist with the flag off", async () => {
    const s = await setup(TEST_ENV)
    expect((await s.post(s.bob, "/api/access-requests")).status).toBe(404)
    expect((await s.list(s.ada)).status).toBe(404)
    expect((await s.create(s.bob)).status).toBe(201)
  })

  it("needs a session", async () => {
    const s = await setup()
    const res = await s.app.request("/api/access-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    expect(res.status).toBe(401)
  })
})

describe("the migration", () => {
  it("approves every account that exists when it runs, and no later one", async () => {
    const full = fileURLToPath(new URL("../drizzle", import.meta.url))
    const dir = mkdtempSync(join(tmpdir(), "seply-migrations-"))
    try {
      // The migrations before access approval.
      cpSync(full, dir, { recursive: true })
      const journalPath = join(dir, "meta/_journal.json")
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { tag: string }[]
      }
      const at = journal.entries.findIndex((e) => e.tag === "0009_access_approval")
      expect(at).toBeGreaterThan(0)
      journal.entries = journal.entries.slice(0, at)
      writeFileSync(journalPath, JSON.stringify(journal))

      const db = drizzle(new PGlite({ extensions: { pg_trgm } }), { schema })
      await migrate(db, { migrationsFolder: dir })
      await db.execute(
        `insert into users (id, name, email) values ('old', 'Old', 'old@example.com')`
      )
      await migrate(db, { migrationsFolder: full })
      await db.execute(
        `insert into users (id, name, email) values ('new', 'New', 'new@example.com')`
      )
      const rows = await db
        .select({ id: schema.users.id, approvedAt: schema.users.approvedAt })
        .from(schema.users)
      const by = Object.fromEntries(rows.map((r) => [r.id, r.approvedAt]))
      expect(by.old).toBeInstanceOf(Date)
      expect(by.new).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
