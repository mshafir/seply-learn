// History in the sync client (WP-4.2): undo with kept edits, "view as of"
// and Restore to here, between two clients over the fake server.
import { builtinId, emptyState, type OpBody } from "@seply/domain"
import { afterEach, describe, expect, it } from "vitest"
import { openSyncClient, type SyncClient } from "./client.ts"
import { HistoryError } from "./history.ts"
import { MemoryPendingStore } from "./store.ts"
import { FakeServer } from "./test/fake-server.ts"

const EXP = "exp1"
const IDEA = builtinId("idea")

const set = (id: string, path: string, value: unknown): OpBody =>
  ({ kind: "concept.set", target: id, path, value }) as OpBody

function server() {
  const s = new FakeServer(emptyState(EXP))
  s.seed([
    {
      kind: "concept.create",
      target: "mla",
      value: { title: "MLA", kind: IDEA, summary: "Latent attention" },
    },
  ])
  return s
}

let open: SyncClient[] = []
afterEach(() => {
  for (const c of open) c.dispose()
  open = []
})

async function client(s: FakeServer, actor: string) {
  const transport = s.transport(actor)
  const c = await openSyncClient({
    expeditionId: EXP,
    actor,
    transport,
    store: new MemoryPendingStore(),
    autoPush: false,
    collections: { id: `${actor}:${Math.random()}` },
  })
  open.push(c)
  return { c, transport }
}

/** An edit made and pushed as its own Change; returns its id. */
async function edit(c: SyncClient, bodies: OpBody[], label: string) {
  const [op] = c.engine.propose(bodies, { label, coalesce: false })
  await c.push()
  return op!.changeId
}

const concept = (c: SyncClient) => c.engine.state.concepts["mla"]!

describe("undo", () => {
  it("reverts A's edit but keeps the field B changed since, and reports it", async () => {
    const s = server()
    const ada = await client(s, "ada")
    const ed = await client(s, "ed")

    const adas = await edit(
      ada.c,
      [
        set("mla", "title", "Multi-head Latent Attention"),
        set("mla", "summary", "Ada's"),
      ],
      "Edited MLA"
    )
    await ed.c.pull()
    const eds = await edit(ed.c, [set("mla", "summary", "Ed's")], "Edited MLA")

    const r = await ada.c.undo(adas, { label: "Undid “Edited MLA”" })
    // Undo pulled Ed's edit first, then reverted only the title.
    expect(concept(ada.c)).toMatchObject({ title: "MLA", summary: "Ed's" })
    expect(r.kept).toEqual([
      expect.objectContaining({
        entity: "concept",
        id: "mla",
        field: "summary",
        current: "Ed's",
        by: expect.objectContaining({ actor: "ed", changeId: eds }),
      }),
    ])
    // One new Change, pushed, labelled, by Ada; Ed sees it on his next pull.
    expect(r.changeId).not.toBeNull()
    expect(ada.c.engine.pending).toHaveLength(0)
    expect(s.changes.get(r.changeId!)).toMatchObject({
      author: "ada",
      label: "Undid “Edited MLA”",
      origin: "human",
    })
    expect(r.ops.every((op) => op.changeId === r.changeId)).toBe(true)
    await ed.c.pull()
    expect(concept(ed.c)).toMatchObject({ title: "MLA", summary: "Ed's" })
  })

  it("writes nothing when every field changed since, or the Change is already undone", async () => {
    const s = server()
    const ada = await client(s, "ada")
    const c = await edit(ada.c, [set("mla", "title", "A")], "Edited MLA")
    const first = await ada.c.undo(c)
    expect(first.ops).toHaveLength(1)
    expect(concept(ada.c).title).toBe("MLA")
    const again = await ada.c.undo(c)
    expect(again).toMatchObject({ changeId: null, ops: [] })
  })

  it("never joins an open editing session", async () => {
    const s = server()
    const ada = await client(s, "ada")
    const c = await edit(ada.c, [set("mla", "title", "A")], "Edited MLA")
    const r = await ada.c.undo(c)
    expect(r.changeId).not.toBe(c)
    // The next edit to the same Concept starts its own Change too.
    const [next] = ada.c.engine.propose([set("mla", "title", "B")])
    expect(next!.changeId).not.toBe(r.changeId)
  })

  it("refuses while edits can't be pushed", async () => {
    const s = server()
    const ada = await client(s, "ada")
    const c = await edit(ada.c, [set("mla", "title", "A")], "Edited MLA")
    ada.transport.offline = true
    ada.c.engine.propose([set("mla", "summary", "offline")])
    await expect(ada.c.undo(c)).rejects.toThrow()
    ada.transport.offline = false
    ada.c.engine.reject(ada.c.engine.pending.map((op) => op.opId))
    // A pending op that the push can't place leaves History refused.
    const refused = await ada.c.undo(c)
    expect(refused.ops).toHaveLength(1)
  })
})

describe("view as of and Restore to here", () => {
  it("replays the log up to a Change, read-only", async () => {
    const s = server()
    const ada = await client(s, "ada")
    await edit(ada.c, [set("mla", "title", "One")], "First")
    const seqAfterFirst = ada.c.engine.headSeq
    await edit(ada.c, [set("mla", "title", "Two")], "Second")
    const head = ada.c.engine.headSeq

    expect(ada.c.stateAsOf(seqAfterFirst).concepts["mla"]!.title).toBe("One")
    expect(ada.c.stateAsOf(1).concepts["mla"]!.title).toBe("MLA")
    expect(ada.c.stateAsOf(0).concepts).toEqual({})
    // Nothing written.
    expect(ada.c.engine.headSeq).toBe(head)
    expect(ada.c.engine.pending).toHaveLength(0)
    expect(concept(ada.c).title).toBe("Two")
  })

  it("restores the state at a Change with a new Change, keeping the log", async () => {
    const s = server()
    const ada = await client(s, "ada")
    const ed = await client(s, "ed")
    await edit(ada.c, [set("mla", "title", "One")], "First")
    const seq = ada.c.engine.headSeq
    await ed.c.pull()
    await edit(
      ed.c,
      [set("mla", "title", "Two"), set("mla", "summary", "Ed's")],
      "Ed's edit"
    )
    await edit(
      ed.c,
      [
        {
          kind: "concept.create",
          target: "new",
          value: { title: "New", kind: IDEA },
        },
      ],
      "Added New"
    )
    const logLength = s.log.length

    const r = await ada.c.restoreTo(seq, { label: "Restored to “First”" })
    expect(concept(ada.c)).toMatchObject({
      title: "One",
      summary: "Latent attention",
    })
    expect(ada.c.engine.state.concepts["new"]!.deletedAt).toBeTruthy()
    expect(r.kept).toEqual([])
    // Appended, never rewound.
    expect(s.log.length).toBe(logLength + r.ops.length)
    expect(s.changes.get(r.changeId!)).toMatchObject({
      origin: "restore",
      label: "Restored to “First”",
    })
    // Restoring is itself undoable: undo it and Ed's state is back.
    await ada.c.undo(r.changeId!)
    expect(concept(ada.c)).toMatchObject({ title: "Two", summary: "Ed's" })
    expect(ada.c.engine.state.concepts["new"]!.deletedAt).toBeFalsy()
  })

  it("needs the whole log", async () => {
    const s = server()
    const ada = await client(s, "ada")
    const { openCachedClient } = await import("./offline-cache.ts")
    const cached = openCachedClient(
      { expeditionId: EXP, actor: "ada", collections: { id: "cached" } },
      { state: ada.c.engine.confirmed, headSeq: ada.c.engine.headSeq }
    )
    open.push(cached)
    expect(cached.hasHistory).toBe(false)
    expect(() => cached.stateAsOf(1)).toThrow(HistoryError)
    await expect(cached.undo("x")).rejects.toMatchObject({ reason: "no-log" })
  })
})
