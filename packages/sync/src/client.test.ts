import "fake-indexeddb/auto"
import { IDBFactory } from "fake-indexeddb"
import { builtinId, emptyState, type OpBody } from "@umbel/domain"
import { afterEach, describe, expect, it } from "vitest"
import {
  openSyncClient,
  type SyncClient,
  type SyncClientOptions,
} from "./client.ts"
import {
  IndexedDbPendingStore,
  MemoryPendingStore,
  type PendingStore,
} from "./store.ts"
import { FakeServer } from "./test/fake-server.ts"
import { SyncHttpError } from "./transport.ts"

const EXP = "exp1"
const IDEA = builtinId("idea")
const PREREQ = builtinId("prerequisite")

const create = (id: string, title = `Concept ${id}`): OpBody => ({
  kind: "concept.create",
  target: id,
  value: { title, kind: IDEA },
})
const setTitle = (id: string, value: string): OpBody => ({
  kind: "concept.set",
  target: id,
  path: "title",
  value,
})

function server() {
  const s = new FakeServer(emptyState(EXP))
  s.seed([
    { kind: "expedition.set", target: EXP, path: "title", value: "Attention" },
    create("c1"),
    create("c2"),
  ])
  return s
}

let open: SyncClient[] = []
afterEach(() => {
  for (const c of open) c.dispose()
  open = []
})

async function client(
  s: FakeServer,
  actor: string,
  store: PendingStore = new MemoryPendingStore(),
  extra: Partial<SyncClientOptions> & { offline?: boolean } = {}
) {
  const transport = s.transport(actor)
  const errors: unknown[] = []
  const c = await openSyncClient({
    expeditionId: EXP,
    actor,
    transport,
    store,
    autoPush: false,
    onError: (e) => errors.push(e),
    collections: { id: `${actor}:${Math.random()}` },
    ...extra,
  })
  transport.offline = !!extra.offline
  open.push(c)
  return { c, transport, errors }
}

describe("reload with pending ops (IndexedDB)", () => {
  it("loses nothing: edits made offline come back after a reload and are pushed", async () => {
    const s = server()
    const idb = new IDBFactory()
    const store1 = new IndexedDbPendingStore({ indexedDB: idb })
    const a = await client(s, "ada", store1, { offline: true })

    a.c.engine.propose([setTitle("c1", "Self-attention")])
    a.c.collections.concepts.update("c2", (d) => {
      d.summary = "Written offline"
    })
    a.c.collections.concepts.insert({
      id: "c3",
      title: "Softmax",
      kind: IDEA,
      aliases: [],
      tags: ["math"],
      attributes: {},
      overviewProv: [],
      prov: [],
      deletedAt: null,
    })
    await expect(a.c.push()).rejects.toThrow(/Failed to fetch/)
    expect(a.c.engine.pending.length).toBeGreaterThanOrEqual(3)
    await a.c.flush()
    const pendingIds = a.c.engine.pending.map((op) => op.opId)

    // "Reload": drop everything in memory, keep only IndexedDB.
    a.c.dispose()
    store1.close()
    const store2 = new IndexedDbPendingStore({ indexedDB: idb })
    const b = await client(s, "ada", store2)
    expect(b.c.engine.pending.map((op) => op.opId)).toEqual(pendingIds)
    expect(b.c.collections.concepts.get("c1")?.title).toBe("Self-attention")
    expect(b.c.collections.concepts.get("c2")?.summary).toBe("Written offline")
    expect(b.c.collections.concepts.get("c3")?.tags).toEqual(["math"])

    await b.c.push()
    expect(b.c.engine.pending).toHaveLength(0)
    expect(s.state.concepts.c1?.title).toBe("Self-attention")
    expect(s.state.concepts.c2?.summary).toBe("Written offline")
    expect(s.state.concepts.c3?.title).toBe("Softmax")

    // Once confirmed, IndexedDB forgets them.
    await b.c.flush()
    const reloaded = await new IndexedDbPendingStore({ indexedDB: idb }).load({
      expeditionId: EXP,
      actor: "ada",
    })
    expect(reloaded.ops).toHaveLength(0)
  })

  it("ops the server logged before the reload (ack lost) are not applied twice", async () => {
    const s = server()
    const idb = new IDBFactory()
    const a = await client(
      s,
      "ada",
      new IndexedDbPendingStore({ indexedDB: idb })
    )
    const [op] = a.c.engine.propose([setTitle("c1", "Mine")])
    await a.c.flush()
    // The push lands, but the page reloads before the response arrives.
    s.push("ada", { expeditionId: EXP, ops: [op!] })
    a.c.dispose()
    // Someone else edits the title afterwards.
    s.seed([setTitle("c1", "Theirs, later")], "ed")

    const b = await client(
      s,
      "ada",
      new IndexedDbPendingStore({ indexedDB: idb })
    )
    expect(b.c.engine.pending).toHaveLength(0)
    expect(b.c.collections.concepts.get("c1")?.title).toBe("Theirs, later")
  })

  it("keeps the Change a reloaded edit belongs to, and keeps coalescing into it", async () => {
    const s = server()
    const idb = new IDBFactory()
    const a = await client(
      s,
      "ada",
      new IndexedDbPendingStore({ indexedDB: idb }),
      {
        offline: true,
      }
    )
    a.c.engine.propose([setTitle("c1", "One")])
    await a.c.flush()
    a.c.dispose()
    const b = await client(
      s,
      "ada",
      new IndexedDbPendingStore({ indexedDB: idb })
    )
    b.c.engine.propose([
      { kind: "concept.set", target: "c1", path: "summary", value: "Two" },
    ])
    const [first, second] = b.c.engine.pending
    expect(second!.changeId).toBe(first!.changeId)
    await b.c.push()
    expect(s.changes.get(first!.changeId)).toMatchObject({
      author: "ada",
      label: "Edited One",
    })
  })
})

describe("last writer wins", () => {
  it("conflicting edits of one field: the later push wins on every client", async () => {
    const s = server()
    const ada = await client(s, "ada")
    const ed = await client(s, "ed")
    ada.c.collections.concepts.update("c1", (d) => {
      d.title = "Ada's title"
    })
    ed.c.collections.concepts.update("c1", (d) => {
      d.title = "Ed's title"
    })
    await ada.c.push()
    // Ed pulls Ada's edit while his own is pending: his stays on top.
    await ed.c.pull()
    expect(ed.c.collections.concepts.get("c1")?.title).toBe("Ed's title")
    await ed.c.push()
    await ada.c.pull()
    for (const c of [ada.c, ed.c]) {
      expect(c.collections.concepts.get("c1")?.title).toBe("Ed's title")
      expect(c.engine.pending).toHaveLength(0)
    }
    expect(s.state.concepts.c1?.title).toBe("Ed's title")
  })

  it("edits of different fields of one Concept merge", async () => {
    const s = server()
    const ada = await client(s, "ada")
    const ed = await client(s, "ed")
    ada.c.collections.concepts.update("c1", (d) => {
      d.title = "Renamed"
    })
    ed.c.collections.concepts.update("c1", (d) => {
      d.summary = "Summarised"
    })
    await ada.c.push()
    await ed.c.sync()
    await ada.c.pull()
    for (const c of [ada.c, ed.c]) {
      const row = c.collections.concepts.get("c1")
      expect(row).toMatchObject({ title: "Renamed", summary: "Summarised" })
    }
  })

  it("concurrent View settings edits at different paths don't collide", async () => {
    const s = server()
    s.seed([
      {
        kind: "view.create",
        target: "v1",
        value: {
          viewType: "timeline",
          label: "Timeline",
          orderKey: "a",
          settings: { lanes: [] },
        },
      },
    ])
    const ada = await client(s, "ada")
    const ed = await client(s, "ed")
    ada.c.collections.views.update("v1", (d) => {
      d.settings = { ...d.settings, hide: ["c1"] }
    })
    ed.c.collections.views.update("v1", (d) => {
      d.label = "Reading order"
    })
    await ada.c.push()
    await ed.c.sync()
    await ada.c.pull()
    for (const c of [ada.c, ed.c])
      expect(c.collections.views.get("v1")).toMatchObject({
        label: "Reading order",
        settings: { lanes: [], hide: ["c1"] },
      })
  })
})

describe("push", () => {
  it("coalesces an editing session into one Change with a label", async () => {
    const s = server()
    const a = await client(s, "ada")
    for (const t of ["A", "At", "Att"])
      a.c.collections.concepts.update("c1", (d) => {
        d.title = t
      })
    a.c.collections.concepts.update("c2", (d) => {
      d.title = "Other"
    })
    await a.c.push()
    const mine = s.log.filter((op) => op.actor === "ada")
    const ids = [...new Set(mine.map((op) => op.changeId))]
    expect(ids).toHaveLength(2)
    expect(s.changes.get(ids[0]!)?.label).toBe("Edited Att")
    expect(s.changes.get(ids[1]!)?.label).toBe("Edited Other")
  })

  it("an op that no longer applies: pull, rebase drops it, the rest goes through", async () => {
    const s = server()
    const a = await client(s, "ada")
    a.c.engine.propose([
      { kind: "relationship.add", target: `c1|${PREREQ}|c2`, value: {} },
    ])
    a.c.engine.propose([setTitle("c1", "Still mine")])
    // Meanwhile someone deletes c2 (and a Relationship to it can't be added).
    s.seed([{ kind: "concept.delete", target: "c2" }], "ed")
    await a.c.push()
    expect(a.c.engine.pending).toHaveLength(0)
    expect(s.state.concepts.c1?.title).toBe("Still mine")
    expect(Object.keys(s.state.relationships)).toHaveLength(0)
    expect(a.c.collections.relationships.size).toBe(0)
    expect(a.c.collections.concepts.get("c2")).toBeUndefined()
  })

  it("a refused batch (no permission) is dropped and reported", async () => {
    const s = server()
    const a = await client(s, "ada")
    a.c.engine.propose([setTitle("c1", "Nope")])
    s.push = () => {
      throw new SyncHttpError(403, { error: "not allowed" })
    }
    await a.c.push()
    expect(a.c.engine.pending).toHaveLength(0)
    expect(a.errors).toHaveLength(1)
    expect(a.c.collections.concepts.get("c1")?.title).toBe("Concept c1")
  })

  it("pushes automatically after an edit, and retries when offline", async () => {
    const s = server()
    const a = await client(s, "ada", new MemoryPendingStore(), {
      autoPush: true,
      pushDelayMs: 1,
      retryMs: 5,
    })
    a.transport.offline = true
    a.c.collections.concepts.update("c1", (d) => {
      d.title = "Eventually"
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(a.errors.length).toBeGreaterThan(0)
    a.transport.offline = false
    await expect
      .poll(() => s.state.concepts.c1?.title, { timeout: 1000 })
      .toBe("Eventually")
    await expect.poll(() => a.c.engine.pending.length).toBe(0)
  })

  it("applies push results directly when nothing else landed, else pulls", async () => {
    const s = server()
    const a = await client(s, "ada")
    a.c.engine.propose([setTitle("c1", "Direct")])
    await a.c.push()
    expect(a.c.engine.headSeq).toBe(s.log.length)
    s.seed([setTitle("c2", "Someone else")], "ed")
    a.c.engine.propose([setTitle("c1", "After a gap")])
    await a.c.push()
    await expect.poll(() => a.c.engine.headSeq).toBe(s.log.length)
    expect(a.c.collections.concepts.get("c2")?.title).toBe("Someone else")
  })
})

describe("pull", () => {
  it("pages through a long log", async () => {
    const s = server()
    s.seed(Array.from({ length: 25 }, (_, i) => create(`k${i}`)))
    const transport = s.transport("ada", { pullLimit: 10 })
    const c = await openSyncClient({
      expeditionId: EXP,
      actor: "ada",
      transport,
      store: new MemoryPendingStore(),
      autoPush: false,
      collections: { id: `paging:${Math.random()}` },
    })
    open.push(c)
    expect(c.engine.headSeq).toBe(s.log.length)
    expect(c.collections.concepts.size).toBe(27)
  })
})
