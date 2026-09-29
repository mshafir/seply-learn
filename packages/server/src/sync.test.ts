// The apply path: POST /push and GET /pull over PGlite.
import {
  applyAll,
  emptyState,
  makeOps,
  stateAt,
  sampleToState,
  schema,
  ulidSequence,
  type LoggedOp,
  type Op,
  type OpBody,
} from "@umbel/domain"
import { and, eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { ServerEnv } from "./config.ts"
import type { Db } from "./db.ts"
import { loadState } from "./projection.ts"
import type { Relay } from "./relay.ts"
import { Jar, testApp, testDb } from "./test-harness.ts"

const LOCAL = "http://localhost:8787"
const env: ServerEnv = {
  BETTER_AUTH_URL: LOCAL,
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!!",
  AUTH_TEST_CREDENTIALS: "1",
}

type App = ReturnType<typeof testApp>
type User = { id: string; headers: Record<string, string> }
type PushResponse = {
  headSeq: number
  results: { opId: string; serverSeq: number }[]
}
type PullResponse = { headSeq: number; ops: LoggedOp[]; more: boolean }

async function signUp(app: App, name: string): Promise<User> {
  const jar = new Jar()
  jar.take(
    await app.request(`${LOCAL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: LOCAL },
      body: JSON.stringify({
        email: `${name}@example.com`,
        password: "correct horse battery staple",
        name,
      }),
    })
  )
  const headers = {
    cookie: jar.header(),
    origin: LOCAL,
    "content-type": "application/json",
  }
  const me = (await (await app.request("/api/me", { headers })).json()) as {
    user: { id: string }
  }
  return { id: me.user.id, headers }
}

async function setup(relay?: Relay) {
  const db = await testDb()
  const app = testApp(env, db, relay)
  const ada = await signUp(app, "ada")
  const res = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id } = (await res.json()) as { id: string }
  let n = 0
  // Op ids strictly after the create's (which used the real clock).
  const nextOpId = ulidSequence(Date.now() + 1000)
  const opsFor = (user: User, bodies: OpBody[], changeId = `ch${++n}`) =>
    makeOps(bodies, { expeditionId: id, actor: user.id, changeId, nextOpId })
  const push = (user: User | null, body: unknown) =>
    app.request("/api/push", {
      method: "POST",
      headers: user?.headers ?? { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  const pull = async (user: User | null, since = 0) => {
    const res = await app.request(`/api/pull?expedition=${id}&since=${since}`, {
      headers: user?.headers ?? {},
    })
    return res
  }
  const pullOps = async (since = 0) =>
    (await (await pull(ada, since)).json()) as PullResponse
  return { db, app, ada, id, opsFor, push, pull, pullOps }
}

const concept = (id: string, title: string): OpBody => ({
  kind: "concept.create",
  target: id,
  value: { title, kind: "builtin:idea" },
})

async function counts(db: Db, id: string) {
  const [exp] = await db
    .select({ headSeq: schema.expeditions.headSeq })
    .from(schema.expeditions)
    .where(eq(schema.expeditions.id, id))
  const ops = await db
    .select()
    .from(schema.ops)
    .where(eq(schema.ops.expeditionId, id))
  const changes = await db
    .select()
    .from(schema.changes)
    .where(eq(schema.changes.expeditionId, id))
  const concepts = await db
    .select()
    .from(schema.concepts)
    .where(eq(schema.concepts.expeditionId, id))
  return {
    headSeq: exp!.headSeq,
    ops: ops.length,
    changes: changes.length,
    concepts: concepts.length,
  }
}

describe("create", () => {
  it("logs the title as the Expedition's first Change", async () => {
    const { db, id, ada, pullOps } = await setup()
    const { headSeq, ops } = await pullOps()
    expect(headSeq).toBe(1)
    expect(ops).toEqual([
      expect.objectContaining({
        serverSeq: 1,
        kind: "expedition.set",
        target: id,
        path: "title",
        value: "Compute",
        actor: ada.id,
      }),
    ])
    const [change] = await db
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.expeditionId, id))
    expect(change).toMatchObject({
      author: ada.id,
      origin: "human",
      label: "Created the Expedition",
      firstSeq: 1,
      lastSeq: 1,
    })
  })
})

describe("POST /push", () => {
  it("assigns server_seq in order, applies to the tables, and pull returns the ops", async () => {
    const { db, id, ada, opsFor, push, pullOps } = await setup()
    const ops = opsFor(ada, [
      concept("c1", "KV cache"),
      concept("c2", "Attention"),
      {
        kind: "relationship.add",
        target: "c2|builtin:prerequisite|c1",
        value: { note: "needs it" },
      },
      { kind: "concept.set", target: "c1", path: "summary", value: "Memo" },
    ])
    const res = await push(ada, {
      expeditionId: id,
      ops,
      changes: [{ id: ops[0]!.changeId, label: "Added two Concepts" }],
    })
    expect(res.status).toBe(200)
    const out = (await res.json()) as PushResponse
    expect(out.headSeq).toBe(5)
    expect(out.results).toEqual(
      ops.map((o, i) => ({ opId: o.opId, serverSeq: 2 + i }))
    )

    const state = (await loadState(db, id))!
    expect(state.concepts.c1).toMatchObject({
      title: "KV cache",
      summary: "Memo",
    })
    expect(state.relationships["c2|builtin:prerequisite|c1"]).toMatchObject({
      note: "needs it",
      deletedAt: null,
    })

    const pulled = await pullOps(1)
    expect(pulled.headSeq).toBe(5)
    expect(pulled.more).toBe(false)
    expect(pulled.ops).toEqual(ops.map((o, i) => ({ ...o, serverSeq: 2 + i })))
    expect((await pullOps(4)).ops.map((o) => o.serverSeq)).toEqual([5])
    expect((await pullOps(5)).ops).toEqual([])

    const [change] = await db
      .select()
      .from(schema.changes)
      .where(
        and(
          eq(schema.changes.expeditionId, id),
          eq(schema.changes.id, ops[0]!.changeId)
        )
      )
    expect(change).toMatchObject({
      label: "Added two Concepts",
      firstSeq: 2,
      lastSeq: 5,
    })
  })

  it("serializes concurrent pushes with gap-free server_seq", async () => {
    const { db, id, ada, opsFor, push, pullOps } = await setup()
    const batches = Array.from({ length: 5 }, (_, i) =>
      opsFor(ada, [concept(`c${i}`, `C${i}`), concept(`d${i}`, `D${i}`)])
    )
    const results = await Promise.all(
      batches.map((ops) => push(ada, { expeditionId: id, ops }))
    )
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    const { ops } = await pullOps()
    expect(ops.map((o) => o.serverSeq)).toEqual(
      Array.from({ length: 11 }, (_, i) => i + 1)
    )
    expect(await counts(db, id)).toMatchObject({ headSeq: 11, concepts: 10 })
  })

  it("last writer wins per field, in server order", async () => {
    const { db, id, ada, opsFor, push } = await setup()
    await push(ada, {
      expeditionId: id,
      ops: opsFor(ada, [concept("c1", "A")]),
    })
    const set = (value: string) =>
      opsFor(ada, [{ kind: "concept.set", target: "c1", path: "title", value }])
    await push(ada, { expeditionId: id, ops: set("B") })
    await push(ada, { expeditionId: id, ops: set("C") })
    expect((await loadState(db, id))!.concepts.c1!.title).toBe("C")
  })

  it("is idempotent on op id: a retry returns the same results and applies nothing", async () => {
    const calls: LoggedOp[][] = []
    const { db, id, ada, opsFor, push } = await setup({
      published: (_exp, batch) => {
        calls.push([...batch])
      },
    })
    const ops = opsFor(ada, [concept("c1", "A"), concept("c2", "B")])
    const first = (await (
      await push(ada, { expeditionId: id, ops })
    ).json()) as PushResponse
    const before = await counts(db, id)

    // Someone renames c1 in between; the retry must not undo that.
    await push(ada, {
      expeditionId: id,
      ops: opsFor(ada, [
        { kind: "concept.set", target: "c1", path: "title", value: "A2" },
      ]),
    })
    const retry = await push(ada, { expeditionId: id, ops })
    expect(retry.status).toBe(200)
    const again = (await retry.json()) as PushResponse
    expect(again.results).toEqual(first.results)
    expect(again.headSeq).toBe(4)
    expect(await counts(db, id)).toEqual({
      ...before,
      headSeq: 4,
      ops: before.ops + 1,
      changes: before.changes + 1,
    })
    expect((await loadState(db, id))!.concepts.c1!.title).toBe("A2")

    // A batch mixing logged and new ops applies only the new ones.
    const extra = opsFor(ada, [concept("c3", "C")])
    const mixed = (await (
      await push(ada, { expeditionId: id, ops: [...ops, ...extra] })
    ).json()) as PushResponse
    expect(mixed.results).toEqual([
      ...first.results,
      { opId: extra[0]!.opId, serverSeq: 5 },
    ])

    // The relay heard each op once, after commit, never for the retry.
    expect(calls.map((b) => b.map((o) => o.serverSeq))).toEqual([
      [1], // the create's
      [2, 3],
      [4],
      [5],
    ])
  })

  it("refuses viewers, non-collaborators and the signed-out, writing nothing", async () => {
    const { db, app, id, ada, opsFor, push } = await setup()
    const vic = await signUp(app, "vic")
    const eve = await signUp(app, "eve")
    await db
      .insert(schema.collaborators)
      .values({ expeditionId: id, userId: vic.id, role: "viewer" })
    const before = await counts(db, id)

    const asVic = await push(vic, {
      expeditionId: id,
      ops: opsFor(vic, [concept("c1", "A")]),
    })
    expect(asVic.status).toBe(403)
    // Private: someone who isn't a Collaborator can't tell it exists.
    const asEve = await push(eve, {
      expeditionId: id,
      ops: opsFor(eve, [concept("c1", "A")]),
    })
    expect(asEve.status).toBe(404)
    const signedOut = await push(null, {
      expeditionId: id,
      ops: opsFor(ada, [concept("c1", "A")]),
    })
    expect(signedOut.status).toBe(401)
    expect(await counts(db, id)).toEqual(before)

    // An editor may push.
    await db
      .update(schema.collaborators)
      .set({ role: "editor" })
      .where(eq(schema.collaborators.userId, vic.id))
    const asEditor = await push(vic, {
      expeditionId: id,
      ops: opsFor(vic, [concept("c1", "A")]),
    })
    expect(asEditor.status).toBe(200)
    // Even on a public Expedition, a reader who isn't an editor can't push.
    await db
      .update(schema.expeditions)
      .set({ visibility: "public" })
      .where(eq(schema.expeditions.id, id))
    expect(
      (
        await push(eve, {
          expeditionId: id,
          ops: opsFor(eve, [concept("c2", "B")]),
        })
      ).status
    ).toBe(403)
  })

  it("validates every op with the domain schemas and writes nothing on a bad one", async () => {
    const { app, db, id, ada, opsFor, push } = await setup()
    const before = await counts(db, id)
    const good = opsFor(ada, [concept("c1", "A")])[0]!
    const bad = async (ops: unknown[], message: RegExp) => {
      const res = await push(ada, { expeditionId: id, ops })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string; message: string }
      expect(body.message).toMatch(message)
    }
    const [noTitle] = opsFor(ada, [concept("c2", "B")])
    await bad(
      [good, { ...noTitle, value: { kind: "builtin:idea" } } as unknown as Op],
      /ops\[1\]/
    )
    await bad(
      [
        opsFor(ada, [
          { kind: "concept.set", target: "c1", path: "colour", value: "red" },
        ])[0],
      ],
      /unknown path/
    )
    await bad([{ ...good, opId: "not-a-ulid" }], /ULID/)
    const eve = await signUp(app, "eve")
    await bad([{ ...good, actor: eve.id }], /actor/)
    await bad([{ ...good, expeditionId: "other" }], /another Expedition/)
    await bad([{ ...good, schemaV: 99 }], /schema_v/)
    await bad([good, good], /duplicate/)
    expect((await push(ada, { expeditionId: id, ops: [] })).status).toBe(400)
    expect(await counts(db, id)).toEqual(before)
  })

  it("is one transaction: an op that doesn't apply leaves nothing behind", async () => {
    const { db, id, ada, opsFor, push, pullOps } = await setup()
    await push(ada, {
      expeditionId: id,
      ops: opsFor(ada, [concept("c0", "Z")]),
    })
    const before = await counts(db, id)
    const stateBefore = await loadState(db, id)

    const ops = opsFor(ada, [
      concept("c1", "A"),
      { kind: "expedition.set", target: id, path: "title", value: "Renamed" },
      { kind: "concept.tag.add", target: "c0", value: "core" },
      { kind: "concept.delete", target: "c0" },
      // Doesn't apply: no such Concept.
      { kind: "concept.set", target: "nope", path: "title", value: "X" },
    ])
    const res = await push(ada, { expeditionId: id, ops })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: "op does not apply",
      opId: ops[4]!.opId,
    })
    expect(await counts(db, id)).toEqual(before)
    expect(await loadState(db, id)).toEqual(stateBefore)
    expect((await pullOps(before.headSeq)).ops).toEqual([])
  })

  it("refuses to extend another author's Change", async () => {
    const { db, app, id, ada, opsFor, push } = await setup()
    const ed = await signUp(app, "ed")
    await db
      .insert(schema.collaborators)
      .values({ expeditionId: id, userId: ed.id, role: "editor" })
    await push(ada, {
      expeditionId: id,
      ops: opsFor(ada, [concept("c1", "A")], "shared"),
    })
    const res = await push(ed, {
      expeditionId: id,
      ops: opsFor(ed, [concept("c2", "B")], "shared"),
    })
    expect(res.status).toBe(409)
  })
})

describe("the tables are a projection of the log", () => {
  it("round-trips the compute sample, pushed in several batches of one Change", async () => {
    const { db, id, ada, push, pullOps } = await setup()
    const raw = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../prototypes/sample-graphs/src/graphs/compute.json",
            import.meta.url
          )
        ),
        "utf8"
      )
    ) as unknown
    const { state, ops } = sampleToState(raw, {
      expeditionId: id,
      actor: ada.id,
      changeId: "import",
      nextOpId: ulidSequence(Date.now() + 1000),
      at: "2026-06-17T00:00:00.000Z",
    })
    // Exercise tombstones, cascades, hides and removals too.
    const concepts = Object.keys(state.concepts)
    const more = makeOps(
      [
        { kind: "concept.delete", target: concepts[0]! },
        { kind: "concept.tag.add", target: concepts[1]!, value: "extra" },
        { kind: "kind.hide", target: "builtin:risk", value: true },
        { kind: "expedition.tag.add", target: id, value: "ml" },
      ],
      {
        expeditionId: id,
        actor: ada.id,
        changeId: "import",
        nextOpId: ulidSequence(Date.now() + 5_000_000),
        firstClientSeq: ops.length,
      }
    )
    const all = [...ops, ...more]
    for (let i = 0; i < all.length; i += 150) {
      const res = await push(ada, {
        expeditionId: id,
        ops: all.slice(i, i + 150),
      })
      expect(res.status).toBe(200)
    }
    const expected = applyAll(state, more)
    expect(await loadState(db, id)).toEqual(expected)

    // Replaying the pulled log from scratch gives the same state.
    const log: LoggedOp[] = []
    for (let hasMore = true; hasMore;) {
      const page = await pullOps(log.at(-1)?.serverSeq ?? 0)
      log.push(...page.ops)
      hasMore = page.more
    }
    expect(log).toHaveLength(all.length + 1)
    expect(stateAt(emptyState(id), log)).toEqual(expected)
    const [change] = await db
      .select()
      .from(schema.changes)
      .where(
        and(
          eq(schema.changes.expeditionId, id),
          eq(schema.changes.id, "import")
        )
      )
    expect(change).toMatchObject({ firstSeq: 2, lastSeq: all.length + 1 })
  })
})

describe("GET /pull", () => {
  it("is for those who can view the Expedition", async () => {
    const { db, app, id, pull } = await setup()
    const eve = await signUp(app, "eve")
    expect((await pull(null)).status).toBe(404)
    expect((await pull(eve)).status).toBe(404)
    await db
      .update(schema.expeditions)
      .set({ visibility: "unlisted" })
      .where(eq(schema.expeditions.id, id))
    const anon = await pull(null)
    expect(anon.status).toBe(200)
    expect(((await anon.json()) as PullResponse).ops).toHaveLength(1)
    expect((await pull(eve)).status).toBe(200)
  })

  it("pages with limit and reports more", async () => {
    const { id, ada, app, opsFor, push } = await setup()
    await push(ada, {
      expeditionId: id,
      ops: opsFor(ada, [
        concept("a", "A"),
        concept("b", "B"),
        concept("c", "C"),
      ]),
    })
    const page = async (since: number) =>
      (await (
        await app.request(`/api/pull?expedition=${id}&since=${since}&limit=2`, {
          headers: ada.headers,
        })
      ).json()) as PullResponse
    const p1 = await page(0)
    expect(p1.ops.map((o) => o.serverSeq)).toEqual([1, 2])
    expect(p1.more).toBe(true)
    const p2 = await page(2)
    expect(p2.ops.map((o) => o.serverSeq)).toEqual([3, 4])
    expect(p2.more).toBe(false)
    expect(
      (
        await app.request(`/api/pull?expedition=${id}&since=-1`, {
          headers: ada.headers,
        })
      ).status
    ).toBe(400)
  })
})
