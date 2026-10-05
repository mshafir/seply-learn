// Proposals (WP-4.3): list, review (one Change per action, a Relationship
// refused until its Concepts are in the map or accepted with it, stale
// refused unless overwritten), dismiss (cascading to what depends on it) and
// reopen.
import {
  makeOps,
  relKey,
  schema,
  ulidSequence,
  type LoggedOp,
  type OpBody,
  type ProposalView,
} from "@seply/domain"
import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import type { HistoryPage } from "./history.ts"
import { loadState } from "./projection.ts"
import { addProposalItems, createProposal } from "./proposals.ts"
import type { Relay } from "./relay.ts"
import {
  signUp,
  TEST_ENV,
  testApp,
  testDb,
  type TestUser,
} from "./test-harness.ts"

const PART_OF = "builtin:part-of"
const concept = (id: string, title: string): OpBody => ({
  kind: "concept.create",
  target: id,
  value: { title, kind: "builtin:idea" },
})
const set = (target: string, path: string, value: unknown) =>
  ({ kind: "concept.set", target, path, value }) as OpBody
const rel = (from: string, to: string): OpBody => ({
  kind: "relationship.add",
  target: relKey(from, PART_OF, to),
  value: {},
})

async function setup() {
  const db = await testDb()
  const published: LoggedOp[][] = []
  const pokes: number[] = []
  const relay: Relay = {
    published: (_id, batch) => void published.push([...batch]),
    poke: (_id, headSeq) => void pokes.push(headSeq),
  }
  const app = testApp(TEST_ENV, db, relay)
  const ada = await signUp(app, "ada")
  const vic = await signUp(app, "vic")
  const res = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id } = (await res.json()) as { id: string }
  await db
    .insert(schema.collaborators)
    .values({ expeditionId: id, userId: vic.id, role: "viewer" })
  const nextOpId = ulidSequence(Date.now() + 1000)
  let n = 0
  const push = async (user: TestUser, bodies: OpBody[]) => {
    const changeId = `ch${++n}`
    const r = await app.request("/api/push", {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({
        expeditionId: id,
        ops: makeOps(bodies, {
          expeditionId: id,
          actor: user.id,
          changeId,
          nextOpId,
        }),
        changes: [{ id: changeId, label: "edit" }],
      }),
    })
    expect(r.status).toBe(200)
  }
  await push(ada, [
    concept("attn", "Attention"),
    { ...set("attn", "summary", "Weighs tokens") },
  ])
  // An ask's Proposal: a new Concept, a Relationship to it, and an edit.
  await createProposal(db, {
    expeditionId: id,
    id: "p1",
    author: ada.id,
    origin: "ai",
    rationale: "What would I need to understand MLA?",
  })
  await addProposalItems(db, {
    expeditionId: id,
    proposalId: "p1",
    items: [
      { id: "c-kv", ops: [concept("kv", "KV cache")] },
      { id: "r-kv", ops: [rel("kv", "attn")] },
      { id: "s-attn", ops: [set("attn", "summary", "Mixes token values")] },
    ],
  })
  const call = (user: TestUser, path: string, body?: unknown) =>
    app.request(`/api/expeditions/${id}/proposals${path}`, {
      method: body ? "POST" : "GET",
      headers: user.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  const list = async (user: TestUser) =>
    ((await (await call(user, "")).json()) as { proposals: ProposalView[] })
      .proposals
  const history = async () =>
    (
      (await (
        await app.request(`/api/history?expedition=${id}`, {
          headers: ada.headers,
        })
      ).json()) as HistoryPage
    ).changes
  return { db, app, ada, vic, id, push, call, list, history, published, pokes }
}

describe("Proposals API", () => {
  it("lists pending Proposals grouped by ask, with author and base; viewers get 403", async () => {
    const { ada, vic, call, list } = await setup()
    const [p] = await list(ada)
    expect(p).toMatchObject({
      id: "p1",
      origin: "ai",
      rationale: "What would I need to understand MLA?",
      author: { name: "ada" },
      status: "pending",
    })
    expect(p!.items.map((i) => [i.id, i.position, i.status])).toEqual([
      ["c-kv", 1, "pending"],
      ["r-kv", 2, "pending"],
      ["s-attn", 3, "pending"],
    ])
    // Only the edit replaces something.
    expect(p!.items[2]!.base).toEqual({
      [JSON.stringify(["concept", "attn", "summary"])]: "Weighs tokens",
    })
    expect(p!.items[0]!.base).toEqual({})
    expect((await call(vic, "")).status).toBe(403)
    expect((await call(vic, "/review", { dismiss: ["c-kv"] })).status).toBe(403)
  })

  it("refuses a Relationship whose new Concept isn't accepted with it", async () => {
    const { db, id, ada, call, list } = await setup()
    const res = await call(ada, "/review", { accept: ["r-kv"] })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: "needs suggested Concepts",
      waiting: ["r-kv"],
    })
    expect((await loadState(db, id))!.concepts.kv).toBeUndefined()
    expect(
      (await list(ada))[0]!.items.every((i) => i.status === "pending")
    ).toBe(true)
  })

  it("accepting a Concept's package (its Concept and Relationship) is one Change", async () => {
    const { db, id, ada, call, list, history, published, pokes } = await setup()
    // Out of order on purpose: the server applies the Concept first.
    const res = await call(ada, "/review", { accept: ["r-kv", "c-kv"] })
    expect(res.status).toBe(200)
    const r = await res.json()
    expect(r).toMatchObject({
      label: "Accepted 2 suggestions",
      accepted: ["c-kv", "r-kv"],
      dismissed: [],
      cascaded: [],
    })
    const state = (await loadState(db, id))!
    expect(state.concepts.kv?.title).toBe("KV cache")
    expect(state.relationships[relKey("kv", PART_OF, "attn")]).toBeDefined()
    // One Change, in History, by the reviewer.
    const [latest] = await history()
    expect(latest).toMatchObject({
      id: r.changeId,
      label: "Accepted 2 suggestions",
      origin: "human",
      author: { name: "ada" },
    })
    expect(published.at(-1)!.every((op) => op.changeId === r.changeId)).toBe(
      true
    )
    // Open Suggestions tabs elsewhere hear a poke at the new head.
    expect(pokes).toEqual([r.headSeq])
    // Still listed (one item left), with the two accepted.
    const [p] = await list(ada)
    expect(p!.status).toBe("partly")
    expect(p!.items.map((i) => [i.id, i.status, i.changeId])).toEqual([
      ["c-kv", "accepted", r.changeId],
      ["r-kv", "accepted", r.changeId],
      ["s-attn", "pending", null],
    ])
    // Reviewing it again is refused.
    const again = await call(ada, "/review", { accept: ["r-kv"] })
    expect(again.status).toBe(409)
    expect((await again.json()).reviewed).toEqual(["r-kv"])
  })

  it("refuses a stale item unless overwritten", async () => {
    const { db, id, ada, push, call } = await setup()
    await push(ada, [set("attn", "summary", "Ada's own words")])
    const res = await call(ada, "/review", { accept: ["s-attn"] })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: "changed since suggested",
      stale: ["s-attn"],
    })
    expect((await loadState(db, id))!.concepts.attn?.summary).toBe(
      "Ada's own words"
    )
    const ok = await call(ada, "/review", {
      accept: ["s-attn"],
      overwrite: true,
    })
    expect(ok.status).toBe(200)
    expect((await loadState(db, id))!.concepts.attn?.summary).toBe(
      "Mixes token values"
    )
  })

  it("refuses an item whose Concept is gone, even overwriting", async () => {
    const { ada, push, call } = await setup()
    await push(ada, [{ kind: "concept.delete", target: "attn" }])
    const res = await call(ada, "/review", {
      accept: ["c-kv", "r-kv"],
      overwrite: true,
    })
    expect(res.status).toBe(409)
    expect((await res.json()).gone).toEqual(["r-kv"])
  })

  it("dismisses without a Change, and reopens dismissed and undone items", async () => {
    const ctx = await setup()
    const { db, id, ada, call, list, history } = ctx
    const before = (await history()).length
    const d = await call(ada, "/review", { dismiss: ["s-attn"] })
    expect(d.status).toBe(200)
    expect(await d.json()).toMatchObject({
      changeId: null,
      dismissed: ["s-attn"],
    })
    expect((await history()).length).toBe(before)
    const [row] = await db
      .select()
      .from(schema.proposalItems)
      .where(
        and(
          eq(schema.proposalItems.expeditionId, id),
          eq(schema.proposalItems.id, "s-attn")
        )
      )
    expect(row).toMatchObject({ status: "dismissed", reviewedBy: ada.id })

    // Accept the rest: nothing pending is left, so the Proposal leaves the list.
    const a = await (
      await call(ada, "/review", { accept: ["c-kv", "r-kv"] })
    ).json()
    expect(await list(ada)).toEqual([])

    // Undo the dismissal; then (after the client undid it) the accept.
    const { pokes } = ctx
    const before2 = pokes.length
    const r1 = await call(ada, "/reopen", { itemIds: ["s-attn"] })
    expect(pokes.length).toBe(before2 + 1)
    expect(await r1.json()).toEqual({ reopened: ["s-attn"] })
    const r2 = await call(ada, "/reopen", { changeId: a.changeId })
    expect((await r2.json()).reopened.sort()).toEqual(["c-kv", "r-kv"])
    const [p] = await list(ada)
    expect(p!.status).toBe("pending")
    expect(p!.items.every((i) => i.status === "pending" && !i.changeId)).toBe(
      true
    )
  })

  it("dismissing a Concept dismisses what depends on it; Undo reopens them all", async () => {
    const { db, id, ada, call, list } = await setup()
    // A second new Concept and a Relationship between the two suggested ones.
    await addProposalItems(db, {
      expeditionId: id,
      proposalId: "p1",
      items: [
        { id: "c-mla", ops: [concept("mla", "MLA")] },
        { id: "r-between", ops: [rel("kv", "mla")] },
      ],
    })
    // The Relationship between them waits for both Concepts.
    const early = await call(ada, "/review", { accept: ["c-mla", "r-between"] })
    expect(early.status).toBe(409)
    expect((await early.json()).waiting).toEqual(["r-between"])

    const d = await call(ada, "/review", { dismiss: ["c-kv"] })
    expect(d.status).toBe(200)
    expect(await d.json()).toMatchObject({
      changeId: null,
      dismissed: ["c-kv", "r-kv", "r-between"],
      cascaded: ["r-kv", "r-between"],
    })
    const status = async () =>
      Object.fromEntries(
        (await list(ada))[0]!.items.map((i) => [i.id, i.status])
      )
    expect(await status()).toEqual({
      "c-kv": "dismissed",
      "r-kv": "dismissed",
      "s-attn": "pending",
      "c-mla": "pending",
      "r-between": "dismissed",
    })
    const r = await call(ada, "/reopen", {
      itemIds: ["c-kv", "r-kv", "r-between"],
    })
    expect((await r.json()).reopened.sort()).toEqual([
      "c-kv",
      "r-between",
      "r-kv",
    ])
    // Accepting both packages and the Relationship between them is one Change.
    const all = await call(ada, "/review", {
      accept: ["r-between", "c-mla", "c-kv", "r-kv"],
    })
    expect(all.status).toBe(200)
    expect((await all.json()).accepted).toEqual([
      "c-kv",
      "r-kv",
      "c-mla",
      "r-between",
    ])
    expect(
      (await loadState(db, id))!.relationships[relKey("kv", PART_OF, "mla")]
    ).toBeDefined()
  })

  it("Relationships left out of an accepted package are dismissed with it, and its Undo reopens them", async () => {
    const { ada, call, list } = await setup()
    const a = await (
      await call(ada, "/review", { accept: ["c-kv"], dismiss: ["r-kv"] })
    ).json()
    expect(a).toMatchObject({ accepted: ["c-kv"], dismissed: ["r-kv"] })
    const r = await call(ada, "/reopen", { changeId: a.changeId })
    expect((await r.json()).reopened.sort()).toEqual(["c-kv", "r-kv"])
    expect(
      (await list(ada))[0]!.items.every((i) => i.status === "pending")
    ).toBe(true)
  })

  it("a needed item can't be dismissed in the same action", async () => {
    const { ada, call } = await setup()
    const res = await call(ada, "/review", {
      accept: ["c-kv", "r-kv"],
      dismiss: ["c-kv"],
    })
    expect(res.status).toBe(409)
  })
})
