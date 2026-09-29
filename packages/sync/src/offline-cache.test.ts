import "fake-indexeddb/auto"
import { IDBFactory } from "fake-indexeddb"
import { builtinId, emptyState, type DomainState } from "@umbel/domain"
import { describe, expect, it } from "vitest"
import {
  fetchSnapshot,
  IndexedDbOfflineCacheStore,
  MemoryOfflineCacheStore,
  OfflineCache,
  openCachedClient,
  toEvict,
  type OfflineCacheStore,
} from "./offline-cache.ts"
import { FakeServer } from "./test/fake-server.ts"

const ME = "u1"

function stateOf(id: string, title = `Expedition ${id}`): DomainState {
  return emptyState(id, title)
}

/** A cache whose clock ticks one ms per call. */
function cache(store: OfflineCacheStore = new MemoryOfflineCacheStore()) {
  let t = 1000
  return new OfflineCache({ store, now: () => ++t })
}

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `e${String(i).padStart(2, "0")}`)

describe("toEvict", () => {
  it("keeps the 10 most recently opened unpinned Expeditions", () => {
    const entries = ids(13).map((expeditionId, i) => ({
      expeditionId,
      openedAt: i,
      pinned: false,
    }))
    expect(toEvict(entries).sort()).toEqual(["e00", "e01", "e02"])
  })

  it("never evicts pinned ones, and they don't count toward the 10", () => {
    const entries = ids(14).map((expeditionId, i) => ({
      expeditionId,
      openedAt: i,
      pinned: i < 3, // the three oldest are pinned
    }))
    // 11 unpinned (e03..e13): the oldest of them goes.
    expect(toEvict(entries)).toEqual(["e03"])
  })

  it("keeps everything under the limit", () => {
    expect(
      toEvict([{ expeditionId: "a", openedAt: 1, pinned: false }])
    ).toEqual([])
    expect(toEvict([], 0)).toEqual([])
  })
})

describe("OfflineCache", () => {
  it("saves an opened Expedition and evicts the least recently opened beyond ~10", async () => {
    const c = cache()
    for (const id of ids(12))
      await c.save(ME, { state: stateOf(id), headSeq: 3 })
    const kept = (await c.list(ME)).map((e) => e.expeditionId).sort()
    expect(kept).toEqual(ids(12).slice(2))
    expect(await c.get(ME, "e00")).toBeNull()
    const got = await c.get(ME, "e11")
    expect(got?.state.expedition.title).toBe("Expedition e11")
    expect(got?.entry).toMatchObject({ headSeq: 3, pinned: false })
  })

  it("re-opening one moves it to the front; a later save of the same visit doesn't", async () => {
    const c = cache()
    for (const id of ids(10))
      await c.save(ME, { state: stateOf(id), headSeq: 1 })
    await c.save(ME, { state: stateOf("e00"), headSeq: 2 }) // opened again
    await c.save(ME, { state: stateOf("e01"), headSeq: 2 }, { opened: false })
    await c.save(ME, { state: stateOf("new"), headSeq: 1 })
    const kept = (await c.list(ME)).map((e) => e.expeditionId)
    expect(kept).toContain("e00")
    expect(kept).not.toContain("e01")
  })

  it("keeps pinned Expeditions past the limit, and unpinning makes them evictable", async () => {
    const c = cache()
    await c.save(ME, { state: stateOf("pinned"), headSeq: 1 })
    await c.setPinned(ME, "pinned", true)
    for (const id of ids(11))
      await c.save(ME, { state: stateOf(id), headSeq: 1 })
    let kept = (await c.list(ME)).map((e) => e.expeditionId)
    expect(kept).toContain("pinned")
    expect(kept.filter((id) => id !== "pinned")).toHaveLength(10)

    await c.setPinned(ME, "pinned", false)
    kept = (await c.list(ME)).map((e) => e.expeditionId)
    expect(kept).not.toContain("pinned")
    expect(kept).toHaveLength(10)
  })

  it("records a pin before the Expedition is downloaded, and keeps it on save", async () => {
    const c = cache()
    await c.setPinned(ME, "later", true, "Later")
    expect(await c.get(ME, "later")).toBeNull()
    expect(await c.list(ME)).toMatchObject([
      { expeditionId: "later", pinned: true, savedAt: null, title: "Later" },
    ])
    await c.save(ME, { state: stateOf("later"), headSeq: 4 })
    expect((await c.get(ME, "later"))?.entry.pinned).toBe(true)
    // Unpinning something never saved is a no-op.
    await c.setPinned(ME, "never", false)
    expect(await c.list(ME)).toHaveLength(1)
  })

  it("scopes by user, and clear forgets one user's Expeditions", async () => {
    const c = cache()
    await c.save(ME, { state: stateOf("a"), headSeq: 1 })
    await c.save("u2", { state: stateOf("b"), headSeq: 1 })
    expect(await c.get("u2", "a")).toBeNull()
    await c.clear(ME)
    expect(await c.list(ME)).toEqual([])
    expect(await c.list("u2")).toHaveLength(1)
  })

  it("survives a reload over IndexedDB", async () => {
    const indexedDB = new IDBFactory()
    const first = cache(new IndexedDbOfflineCacheStore({ indexedDB }))
    for (const id of ids(11))
      await first.save(ME, { state: stateOf(id), headSeq: 2 })
    await first.setPinned(ME, "e00", true) // already evicted: pin recorded, no state
    await first.setPinned(ME, "e05", true)

    const second = cache(new IndexedDbOfflineCacheStore({ indexedDB }))
    const list = await second.list(ME)
    expect(list).toHaveLength(11)
    expect(
      list
        .filter((e) => e.pinned)
        .map((e) => e.expeditionId)
        .sort()
    ).toEqual(["e00", "e05"])
    expect(await second.get(ME, "e00")).toBeNull()
    expect((await second.get(ME, "e10"))?.state.expedition.title).toBe(
      "Expedition e10"
    )
    await second.clear(ME)
    expect(await second.list(ME)).toEqual([])
  })
})

describe("fetchSnapshot and openCachedClient", () => {
  it("downloads the confirmed state and reads it back without the network", async () => {
    const server = new FakeServer(emptyState("x"))
    server.seed([
      { kind: "expedition.set", target: "x", path: "title", value: "Offline" },
      {
        kind: "concept.create",
        target: "c1",
        value: { title: "Softmax", kind: builtinId("idea") },
      },
    ])
    const snapshot = await fetchSnapshot(server.transport(ME), "x")
    expect(snapshot.headSeq).toBe(2)

    const c = cache()
    await c.save(ME, snapshot)
    const saved = (await c.get(ME, "x"))!
    const client = openCachedClient(
      { expeditionId: "x", actor: ME, collections: { id: "offline-test" } },
      { state: saved.state, headSeq: saved.entry.headSeq }
    )
    try {
      expect(client.engine.state.expedition.title).toBe("Offline")
      expect(client.engine.state.concepts["c1"]?.title).toBe("Softmax")
      expect(client.status.headSeq).toBe(2)
      await expect(client.pull()).rejects.toThrow(/offline/)
    } finally {
      client.dispose()
    }
  })
})
