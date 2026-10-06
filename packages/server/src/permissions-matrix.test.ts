// The permissions matrix (spec §1.8) against the API routes (WP-5.1): every
// route that touches an Expedition, as each kind of caller, on a private
// Expedition. Each cell is the status the route must answer, or ALLOWED: the
// route let the caller through, and what it answers next (a missing AI key,
// no Sources yet) isn't about permissions.
//
// The callers: the owner, an editor, a viewer, a signed-in stranger (not a
// Collaborator) and an anonymous reader. Private Expeditions are 404 to
// whoever can't read them, so a stranger can't tell one exists.
import { makeOps, schema, ulidSequence, type Visibility } from "@seply/domain"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import { memoryBlobStore } from "./blobs.ts"
import type { Db } from "./db.ts"
import { createInlineEngine } from "./jobs/inline.ts"
import { JOB_KINDS } from "./jobs/registry.ts"
import { createJobRunner } from "./jobs/runner.ts"
import { memoryMailer } from "./mailer.ts"
import type { Relay } from "./relay.ts"
import {
  signUp,
  TEST_ENV,
  testApp,
  testDb,
  type TestUser,
} from "./test-harness.ts"

const ALLOWED = "allowed" as const
type Cell = number | typeof ALLOWED
type Caller = "owner" | "editor" | "viewer" | "stranger" | "anonymous"
const CALLERS: Caller[] = ["owner", "editor", "viewer", "stranger", "anonymous"]

type Ctx = {
  exp: string
  users: Record<Exclude<Caller, "anonymous"> | "extra", TestUser>
  /** Filled by `prepare`. */
  sourceId?: string
  inviteId?: string
  jobId?: string
}

type Route = {
  name: string
  /** On a private Expedition: [owner, editor, viewer, stranger, anonymous] */
  expect: [Cell, Cell, Cell, Cell, Cell]
  /**
   * On an unlisted or a public one (WP-5.2), for those who aren't
   * Collaborators: [stranger, anonymous]. Collaborators are as above.
   */
  link: [Cell, Cell]
  prepare?: (ctx: Ctx, s: Setup) => Promise<void>
  request: (ctx: Ctx, as: TestUser | null) => [string, RequestInit?]
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
})

const ROUTES: Route[] = [
  // --- reading ---
  {
    name: "GET /pull",
    expect: [200, 200, 200, 404, 404],
    link: [200, 200],
    request: (x) => [`/api/pull?expedition=${x.exp}&since=0`],
  },
  {
    name: "GET /expeditions/:id/live",
    expect: [200, 200, 200, 404, 404],
    link: [200, 200],
    request: (x) => [`/api/expeditions/${x.exp}/live`],
  },
  {
    name: "GET /reader/expeditions/:id",
    expect: [200, 200, 200, 404, 401],
    link: [200, 401],
    request: (x) => [`/api/reader/expeditions/${x.exp}`],
  },
  {
    // The draft is for Collaborators only (the create flow), whatever the link.
    name: "GET /expeditions/:id/draft",
    expect: [200, 200, 200, 404, 401],
    link: [404, 401],
    request: (x) => [`/api/expeditions/${x.exp}/draft`],
  },
  {
    name: "GET /sources/:id/:sourceId",
    expect: [200, 200, 200, 404, 404],
    link: [200, 200],
    prepare: addSource,
    request: (x) => [`/api/sources/${x.exp}/${x.sourceId}`],
  },
  {
    name: "GET /sources/:id/:sourceId/file",
    expect: [200, 200, 200, 404, 404],
    link: [200, 200],
    prepare: addSource,
    request: (x) => [`/api/sources/${x.exp}/${x.sourceId}/file`],
  },
  {
    name: "GET /export/:id",
    expect: [200, 200, 200, 404, 404],
    link: [200, 200],
    request: (x) => [`/api/export/${x.exp}?format=markdown`],
  },
  {
    name: "GET /expeditions/:id/jobs",
    expect: [200, 200, 200, 404, 401],
    link: [200, 401],
    request: (x) => [`/api/expeditions/${x.exp}/jobs`],
  },
  {
    name: "GET /jobs/:id",
    expect: [200, 200, 200, 404, 401],
    link: [200, 401],
    prepare: startJob,
    request: (x) => [`/api/jobs/${x.jobId}`],
  },
  {
    name: "GET /expeditions/:id/sharing",
    expect: [200, 200, 200, 404, 401],
    link: [200, 401],
    request: (x) => [`/api/expeditions/${x.exp}/sharing`],
  },
  {
    name: "POST /expeditions/:id/seen",
    expect: [204, 204, 204, 404, 401],
    link: [204, 401],
    request: (x) => [`/api/expeditions/${x.exp}/seen`, { method: "POST" }],
  },

  // --- editing (owners and editors) ---
  {
    name: "POST /push",
    expect: [200, 200, 403, 404, 401],
    link: [403, 401],
    request: (x, as) => [
      "/api/push",
      json("POST", {
        expeditionId: x.exp,
        ops: makeOps(
          [
            {
              kind: "concept.create",
              target: `c-${Math.random().toString(36).slice(2)}`,
              value: { title: "Attention", kind: "builtin:idea" },
            },
          ],
          {
            expeditionId: x.exp,
            actor: as?.id ?? "nobody",
            changeId: "ch-matrix",
            nextOpId: ulidSequence(Date.now() + 5000),
          }
        ),
        changes: [{ id: "ch-matrix", label: "Added Attention" }],
      }),
    ],
  },
  {
    name: "PUT /expeditions/:id/plan",
    expect: [ALLOWED, ALLOWED, 403, 404, 401],
    link: [404, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/plan`,
      json("PUT", { title: "Compute", views: [] }),
    ],
  },
  {
    name: "POST /sources/:id",
    expect: [201, 201, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/sources/${x.exp}`,
      json("POST", { type: "paste", text: "User: what is attention?" }),
    ],
  },
  {
    name: "DELETE /sources/:id/:sourceId",
    expect: [204, 204, 403, 404, 401],
    link: [403, 401],
    prepare: addSource,
    request: (x) => [
      `/api/sources/${x.exp}/${x.sourceId}`,
      { method: "DELETE" },
    ],
  },
  {
    name: "GET /history",
    expect: [200, 200, 403, 404, 401],
    link: [403, 401],
    request: (x) => [`/api/history?expedition=${x.exp}`],
  },

  // --- Proposals and in-app AI (owners and editors) ---
  {
    name: "GET /expeditions/:id/proposals",
    expect: [200, 200, 403, 404, 401],
    link: [403, 401],
    request: (x) => [`/api/expeditions/${x.exp}/proposals`],
  },
  {
    name: "POST /expeditions/:id/proposals/review",
    expect: [ALLOWED, ALLOWED, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/proposals/review`,
      json("POST", { dismiss: ["nope"] }),
    ],
  },
  {
    name: "POST /expeditions/:id/proposals/reopen",
    expect: [ALLOWED, ALLOWED, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/proposals/reopen`,
      json("POST", { itemIds: ["nope"] }),
    ],
  },
  {
    name: "GET /expeditions/:id/asks",
    expect: [200, 200, 403, 404, 401],
    link: [403, 401],
    request: (x) => [`/api/expeditions/${x.exp}/asks`],
  },
  {
    name: "POST /expeditions/:id/skim",
    expect: [ALLOWED, ALLOWED, 403, 404, 401],
    link: [403, 401],
    request: (x) => [`/api/expeditions/${x.exp}/skim`, json("POST", {})],
  },
  {
    name: "POST /expeditions/:id/build",
    expect: [ALLOWED, ALLOWED, 403, 404, 401],
    link: [403, 401],
    request: (x) => [`/api/expeditions/${x.exp}/build`, json("POST", {})],
  },
  {
    name: "POST /expeditions/:id/jobs",
    expect: [201, 201, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/jobs`,
      json("POST", { kind: "fake", input: { views: 1 } }),
    ],
  },
  {
    name: "POST /jobs/:id/cancel",
    expect: [ALLOWED, ALLOWED, 403, 404, 401],
    link: [403, 401],
    prepare: startJob,
    request: (x) => [`/api/jobs/${x.jobId}/cancel`, { method: "POST" }],
  },
  {
    name: "POST /ai/estimate/article",
    expect: [ALLOWED, ALLOWED, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      "/api/ai/estimate/article",
      json("POST", { expeditionId: x.exp }),
    ],
  },
  {
    name: "POST /ai/estimate/ask",
    expect: [ALLOWED, ALLOWED, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      "/api/ai/estimate/ask",
      json("POST", { expeditionId: x.exp }),
    ],
  },

  // --- sharing ---
  {
    name: "POST /expeditions/:id/invites",
    expect: [201, 201, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/invites`,
      json("POST", { email: "newcomer@example.com", role: "viewer" }),
    ],
  },
  {
    // Editors invite, but revoke only their own invites (this is the owner's).
    name: "DELETE /expeditions/:id/invites/:inviteId",
    expect: [204, 403, 403, 404, 401],
    link: [403, 401],
    prepare: invite,
    request: (x) => [
      `/api/expeditions/${x.exp}/invites/${x.inviteId}`,
      { method: "DELETE" },
    ],
  },
  {
    name: "PATCH /expeditions/:id/collaborators/:userId",
    expect: [200, 403, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/collaborators/${x.users.extra.id}`,
      json("PATCH", { role: "editor" }),
    ],
  },
  {
    name: "DELETE /expeditions/:id/collaborators/:userId",
    expect: [204, 403, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/collaborators/${x.users.extra.id}`,
      { method: "DELETE" },
    ],
  },
  {
    name: "POST /expeditions/:id/transfer",
    expect: [200, 403, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/transfer`,
      json("POST", { userId: x.users.editor.id }),
    ],
  },
  // --- Visibility, Fork and Trash (WP-5.2) ---
  {
    name: "PATCH /expeditions/:id/visibility",
    expect: [200, 403, 403, 404, 401],
    link: [403, 401],
    request: (x) => [
      `/api/expeditions/${x.exp}/visibility`,
      json("PATCH", { visibility: "unlisted" }),
    ],
  },
  {
    name: "POST /expeditions/:id/fork",
    expect: [201, 201, 201, 404, 401],
    link: [201, 401],
    request: (x) => [`/api/expeditions/${x.exp}/fork`, json("POST", {})],
  },
  {
    name: "DELETE /expeditions/:id",
    expect: [200, 403, 403, 404, 401],
    link: [403, 401],
    request: (x) => [`/api/expeditions/${x.exp}`, { method: "DELETE" }],
  },
  {
    // In Trash, it is unreadable to everyone but its owner, who restores it.
    name: "POST /expeditions/:id/restore",
    expect: [200, 404, 404, 404, 401],
    link: [404, 401],
    prepare: trash,
    request: (x) => [`/api/expeditions/${x.exp}/restore`, { method: "POST" }],
  },
]

type Setup = {
  db: Db
  app: ReturnType<typeof testApp>
  users: Ctx["users"]
  kicks: { exp: string; userId: string | null; reason: string }[]
}

async function addSource(ctx: Ctx, s: Setup) {
  const res = await s.app.request(`/api/sources/${ctx.exp}`, {
    method: "POST",
    headers: s.users.owner.headers,
    body: JSON.stringify({ type: "paste", text: "User: what is MLA?" }),
  })
  expect(res.status).toBe(201)
  ctx.sourceId = ((await res.json()) as { source: { id: string } }).source.id
}

async function invite(ctx: Ctx, s: Setup) {
  const res = await s.app.request(`/api/expeditions/${ctx.exp}/invites`, {
    method: "POST",
    headers: s.users.owner.headers,
    body: JSON.stringify({ email: "pending@example.com", role: "editor" }),
  })
  expect(res.status).toBe(201)
  ctx.inviteId = ((await res.json()) as { invite: { id: string } }).invite.id
}

async function trash(ctx: Ctx, s: Setup) {
  const res = await s.app.request(`/api/expeditions/${ctx.exp}`, {
    method: "DELETE",
    headers: s.users.owner.headers,
  })
  expect(res.status).toBe(200)
}

async function startJob(ctx: Ctx, s: Setup) {
  const res = await s.app.request(`/api/expeditions/${ctx.exp}/jobs`, {
    method: "POST",
    headers: s.users.owner.headers,
    body: JSON.stringify({ kind: "fake", input: { views: 1 } }),
  })
  expect(res.status).toBe(201)
  ctx.jobId = ((await res.json()) as { job: { id: string } }).job.id
}

let s: Setup

beforeAll(async () => {
  const db = await testDb()
  const kicks: Setup["kicks"] = []
  const relay: Relay = {
    published() {},
    kick: (exp, userId, reason) => void kicks.push({ exp, userId, reason }),
    handleUpgrade: () => new Response("upgraded"),
  }
  const engine = createInlineEngine({
    deps: {
      connect: async () => ({ db, close: async () => {} }),
      relay,
      notify: async () => {},
    },
    registry: JOB_KINDS,
  })
  const jobs = createJobRunner({ engine, registry: JOB_KINDS, relay })
  const app = testApp(TEST_ENV, db, relay, {
    jobs,
    blobs: memoryBlobStore(),
    mailer: memoryMailer(),
  })
  const users = {
    owner: await signUp(app, "olive"),
    editor: await signUp(app, "eddie"),
    viewer: await signUp(app, "vera"),
    extra: await signUp(app, "xavi"),
    stranger: await signUp(app, "stan"),
  }
  s = { db, app, users, kicks }
}, 60_000)

/**
 * A fresh Expedition (private by default): olive owns it; eddie edits; vera
 * and xavi view.
 */
async function fresh(visibility: Visibility = "private"): Promise<Ctx> {
  const res = await s.app.request("/api/expeditions", {
    method: "POST",
    headers: s.users.owner.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id: exp } = (await res.json()) as { id: string }
  const seenAt = new Date().toISOString()
  await s.db.insert(schema.collaborators).values([
    { expeditionId: exp, userId: s.users.editor.id, role: "editor", seenAt },
    { expeditionId: exp, userId: s.users.viewer.id, role: "viewer", seenAt },
    { expeditionId: exp, userId: s.users.extra.id, role: "viewer", seenAt },
  ])
  if (visibility !== "private")
    await s.db
      .update(schema.expeditions)
      .set({ visibility })
      .where(eq(schema.expeditions.id, exp))
  return { exp, users: s.users }
}

async function check(
  route: Route,
  caller: Caller,
  cell: Cell,
  visibility: Visibility
) {
  const ctx = await fresh(visibility)
  await route.prepare?.(ctx, s)
  const as = caller === "anonymous" ? null : s.users[caller]
  const [path, init = {}] = route.request(ctx, as)
  const headers: Record<string, string> = as
    ? { ...as.headers }
    : { "content-type": "application/json" }
  if (path.endsWith("/live")) headers.upgrade = "websocket"
  const res = await s.app.request(path, { ...init, headers })
  if (cell === ALLOWED)
    expect([401, 403, 404], `${caller}: ${await res.text()}`).not.toContain(
      res.status
    )
  else expect(res.status, `${caller}: ${await res.clone().text()}`).toBe(cell)
}

describe("the permissions matrix against the API routes", () => {
  describe.each(ROUTES)("$name", (route) => {
    it.each(CALLERS.map((c, i) => [c, route.expect[i]!] as const))(
      "%s → %s",
      (caller, cell) => check(route, caller, cell, "private")
    )
  })

  // Unlisted and public links (WP-5.2): anyone may read, signed in or not;
  // only Collaborators do more. Search is the only place they differ.
  describe.each(["unlisted", "public"] as const)("on a %s link", (vis) => {
    describe.each(ROUTES)("$name", (route) => {
      it.each([
        ["stranger", route.link[0]],
        ["anonymous", route.link[1]],
        ["viewer", route.expect[2]],
      ] as const)("%s → %s", (caller, cell) => check(route, caller, cell, vis))
    })
  })

  it("covers every Expedition route the app serves", () => {
    // Routes that act on one Expedition (or its jobs) must be in the table.
    const tested = new Set(ROUTES.map((r) => r.name))
    const exempt = new Set([
      // Not about one Expedition, or per-reader only.
      "GET /me",
      "GET /health",
      "POST /expeditions",
      "GET /expeditions",
      "GET /expeditions/trash", // mine, as owner
      "POST /import",
      "GET /search",
      "POST /reader",
      "GET /reader/recent",
      "POST /jobs/:id/retry", // as cancel (useAi)
      "POST /jobs/:id/continue", // as cancel (useAi)
      "GET /expeditions/:id/asks/:jobId/stream", // as GET asks
      "GET /invites/:token", // the link itself is the credential
      "POST /invites/:token/accept",
    ])
    const served = s.app.routes
      .filter((r) => r.method !== "ALL")
      .map((r) => `${r.method} ${r.path.replace(/^\/api/, "")}`)
      .map((n) => n.replace(/:expeditionId/g, ":id"))
      .filter(
        (n) =>
          /\/(expeditions|sources|export|jobs|pull|push|history|ai\/estimate\/(article|ask)|reader\/expeditions)/.test(
            n
          ) && !exempt.has(n)
      )
    const missing = [...new Set(served)].filter((n) => !tested.has(n))
    expect(missing).toEqual([])
    expect(new Set(served).size).toBe(ROUTES.length)
  })
})

describe("sharing side effects", () => {
  it("kicks a removed or re-roled Collaborator from the live room", async () => {
    const ctx = await fresh()
    const before = s.kicks.length
    const owner = s.users.owner.headers
    let res = await s.app.request(
      `/api/expeditions/${ctx.exp}/collaborators/${s.users.editor.id}`,
      {
        method: "PATCH",
        headers: owner,
        body: JSON.stringify({ role: "viewer" }),
      }
    )
    expect(res.status).toBe(200)
    res = await s.app.request(
      `/api/expeditions/${ctx.exp}/collaborators/${s.users.extra.id}`,
      { method: "DELETE", headers: owner }
    )
    expect(res.status).toBe(204)
    expect(s.kicks.slice(before)).toEqual([
      {
        exp: ctx.exp,
        userId: s.users.editor.id,
        reason: "The owner made you a viewer",
      },
      {
        exp: ctx.exp,
        userId: s.users.extra.id,
        reason: "The owner removed you",
      },
    ])
    // The downgraded editor can't push any more; the removed viewer can't read.
    const push = await s.app.request("/api/push", {
      method: "POST",
      headers: s.users.editor.headers,
      body: JSON.stringify({
        expeditionId: ctx.exp,
        ops: makeOps(
          [
            {
              kind: "expedition.set",
              target: ctx.exp,
              path: "title",
              value: "X",
            },
          ],
          {
            expeditionId: ctx.exp,
            actor: s.users.editor.id,
            changeId: "ch-x",
            nextOpId: ulidSequence(Date.now() + 9000),
          }
        ),
        changes: [{ id: "ch-x" }],
      }),
    })
    expect(push.status).toBe(403)
    const pull = await s.app.request(
      `/api/pull?expedition=${ctx.exp}&since=0`,
      { headers: s.users.extra.headers }
    )
    expect(pull.status).toBe(404)
  })

  it("lets a viewer leave, but never the owner", async () => {
    const ctx = await fresh()
    const leave = await s.app.request(
      `/api/expeditions/${ctx.exp}/collaborators/${s.users.viewer.id}`,
      { method: "DELETE", headers: s.users.viewer.headers }
    )
    expect(leave.status).toBe(204)
    const owner = await s.app.request(
      `/api/expeditions/${ctx.exp}/collaborators/${s.users.owner.id}`,
      { method: "DELETE", headers: s.users.owner.headers }
    )
    expect(owner.status).toBe(409)
  })

  it("transfers ownership only to an existing editor; the old owner edits", async () => {
    const ctx = await fresh()
    const toViewer = await s.app.request(
      `/api/expeditions/${ctx.exp}/transfer`,
      {
        method: "POST",
        headers: s.users.owner.headers,
        body: JSON.stringify({ userId: s.users.viewer.id }),
      }
    )
    expect(toViewer.status).toBe(409)
    const ok = await s.app.request(`/api/expeditions/${ctx.exp}/transfer`, {
      method: "POST",
      headers: s.users.owner.headers,
      body: JSON.stringify({ userId: s.users.editor.id }),
    })
    expect(ok.status).toBe(200)
    const sharing = (await (
      await s.app.request(`/api/expeditions/${ctx.exp}/sharing`, {
        headers: s.users.editor.headers,
      })
    ).json()) as { role: string; collaborators: { id: string; role: string }[] }
    expect(sharing.role).toBe("owner")
    expect(
      sharing.collaborators.find((p) => p.id === s.users.owner.id)?.role
    ).toBe("editor")
    // The old owner can no longer change roles.
    const patch = await s.app.request(
      `/api/expeditions/${ctx.exp}/collaborators/${s.users.viewer.id}`,
      {
        method: "PATCH",
        headers: s.users.owner.headers,
        body: JSON.stringify({ role: "editor" }),
      }
    )
    expect(patch.status).toBe(403)
  })
})
