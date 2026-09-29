import "fake-indexeddb/auto"
import { IDBFactory } from "fake-indexeddb"
import {
  applyMarks,
  coveredConcepts,
  emptyReaderState,
  stateToBatch,
  type ReaderBatch,
  type ReaderState,
} from "@umbel/domain"
import { afterEach, describe, expect, it } from "vitest"
import {
  ANONYMOUS_SCOPE,
  ReaderClient,
  type ReaderChannel,
  type ReaderClientOptions,
  type ReaderTransport,
} from "./reader.ts"
import { IndexedDbReaderStore, MemoryReaderStore } from "./reader-store.ts"
import { SyncHttpError } from "./transport.ts"

const EXP = "exp1"

/** The reader API in memory: per user, newest wins. */
class FakeReaderServer {
  readonly users = new Map<string, Map<string, ReaderState>>()
  offline = false
  saves = 0
  state(userId: string, exp = EXP): ReaderState {
    return this.users.get(userId)?.get(exp) ?? emptyReaderState()
  }
  transport(userId: string): ReaderTransport {
    return {
      load: async (exp) => {
        if (this.offline) throw new TypeError("Failed to fetch")
        const b = stateToBatch(this.state(userId, exp))
        return {
          reading: b.reading,
          viewSettings: b.viewSettings,
          position: b.positions[0] ?? null,
        }
      },
      save: async (batch: ReaderBatch) => {
        if (this.offline) throw new TypeError("Failed to fetch")
        this.saves++
        const mine = this.users.get(userId) ?? new Map()
        this.users.set(userId, mine)
        const exps = new Set([
          ...batch.reading.map((m) => m.expeditionId),
          ...batch.viewSettings.map((m) => m.expeditionId),
          ...batch.positions.map((m) => m.expeditionId),
        ])
        for (const e of exps)
          mine.set(e, applyMarks(mine.get(e) ?? emptyReaderState(), batch, e))
        return {
          saved: {
            reading: batch.reading.length,
            viewSettings: batch.viewSettings.length,
            positions: batch.positions.length,
          },
          skipped: [],
        }
      },
    }
  }
}

/** Two ends of a BroadcastChannel, delivered synchronously. */
function channelHub() {
  const ends = new Set<(e: { data: unknown }) => void>()
  const make = (): ReaderChannel => {
    const mine = new Set<(e: { data: unknown }) => void>()
    return {
      postMessage(data) {
        for (const fn of ends) if (!mine.has(fn)) fn({ data })
      },
      addEventListener(_t, fn) {
        mine.add(fn)
        ends.add(fn)
      },
      removeEventListener(_t, fn) {
        mine.delete(fn)
        ends.delete(fn)
      },
      close() {},
    }
  }
  return { make }
}

const clients: ReaderClient[] = []
afterEach(() => {
  for (const c of clients.splice(0)) c.dispose()
})

function client(
  opts: Partial<ReaderClientOptions> & { userId: string | null }
) {
  const c = new ReaderClient({
    store: new MemoryReaderStore(),
    channel: null,
    saveDelayMs: 0,
    retryMs: 10,
    ...opts,
  })
  clients.push(c)
  return c
}

const covered = (c: ReaderClient) =>
  [...coveredConcepts(c.getState(EXP))].sort()

describe("ReaderClient", () => {
  it("saves a mark and shows it at once", async () => {
    const server = new FakeReaderServer()
    const c = client({ userId: "u1", transport: server.transport("u1") })
    await c.ready
    let heard = 0
    c.subscribe(() => heard++)
    c.markReading(EXP, "a", "read")
    expect(covered(c)).toEqual(["a"])
    expect(heard).toBe(1)
    expect(c.pendingCount).toBe(1)
    await c.flush()
    expect(c.pendingCount).toBe(0)
    expect(server.state("u1").reading.a!.state).toBe("read")
  })

  it("keeps the same state object until it changes", async () => {
    const c = client({ userId: null })
    await c.ready
    const a = c.getState(EXP)
    expect(c.getState(EXP)).toBe(a)
    c.markReading(EXP, "a", "known")
    expect(c.getState(EXP)).not.toBe(a)
  })

  it("two quick marks never tie: the last one wins", async () => {
    const c = client({ userId: null, now: () => 1_000 })
    await c.ready
    c.markReading(EXP, "a", "read")
    c.markReading(EXP, "a", "unread")
    expect(c.getState(EXP).reading.a!.state).toBe("unread")
  })

  it("queues marks made offline, keeps them over a reload, and saves them on reconnect", async () => {
    const server = new FakeReaderServer()
    server.offline = true
    const store = new IndexedDbReaderStore({ indexedDB: new IDBFactory() })
    const errors: unknown[] = []
    const first = client({
      userId: "u1",
      transport: server.transport("u1"),
      store,
      onError: (e) => errors.push(e),
    })
    await first.ready
    first.markReading(EXP, "a", "read")
    first.setViewSettings(EXP, "v1", { hideRead: true })
    await first.flush()
    expect(errors.length).toBeGreaterThan(0)
    expect(first.pendingCount).toBe(2)
    first.dispose()

    // A reload, still offline: the queue is still there.
    const second = client({
      userId: "u1",
      transport: server.transport("u1"),
      store,
    })
    await second.ready
    expect(second.pendingCount).toBe(2)
    expect(covered(second)).toEqual(["a"])

    server.offline = false
    await second.flush()
    expect(second.pendingCount).toBe(0)
    expect(server.state("u1").reading.a!.state).toBe("read")
    expect(server.state("u1").viewSettings.v1!.settings).toEqual({
      hideRead: true,
    })
    // And the queue is empty after another reload.
    const third = client({
      userId: "u1",
      transport: server.transport("u1"),
      store,
    })
    await third.ready
    expect(third.pendingCount).toBe(0)
  })

  it("retries a failed save by itself", async () => {
    const server = new FakeReaderServer()
    server.offline = true
    const c = client({ userId: "u1", transport: server.transport("u1") })
    await c.ready
    c.markReading(EXP, "a", "read")
    await c.flush()
    expect(c.pendingCount).toBe(1)
    server.offline = false
    await expect.poll(() => c.pendingCount).toBe(0)
  })

  it("another device's mark arrives on refresh; newer local marks win", async () => {
    const server = new FakeReaderServer()
    const phone = client({ userId: "u1", transport: server.transport("u1") })
    const laptop = client({
      userId: "u1",
      transport: server.transport("u1"),
      now: () => Date.now() + 1000, // its marks come later
    })
    await Promise.all([phone.ready, laptop.ready])
    phone.markReading(EXP, "a", "read")
    phone.markReading(EXP, "b", "read")
    await phone.flush()
    expect(covered(laptop)).toEqual([])
    laptop.markReading(EXP, "b", "unread") // newer than the phone's
    await laptop.refresh(EXP)
    expect(covered(laptop)).toEqual(["a"])
  })

  it("other tabs hear marks on the channel", async () => {
    const hub = channelHub()
    const server = new FakeReaderServer()
    const tab1 = client({
      userId: "u1",
      transport: server.transport("u1"),
      channel: hub.make(),
    })
    const tab2 = client({
      userId: "u1",
      transport: server.transport("u1"),
      channel: hub.make(),
    })
    const other = client({
      userId: "u2",
      transport: server.transport("u2"),
      channel: hub.make(),
    })
    tab1.markReading(EXP, "a", "known")
    expect(covered(tab2)).toEqual(["a"])
    expect(tab2.pendingCount).toBe(0) // tab1 saves it
    expect(covered(other)).toEqual([])
  })

  it("an anonymous reader's marks stay in the browser, then move into the account on sign-in", async () => {
    const server = new FakeReaderServer()
    const store = new IndexedDbReaderStore({ indexedDB: new IDBFactory() })
    const anon = client({
      userId: null,
      store,
      transport: server.transport("x"),
    })
    await anon.ready
    anon.markReading(EXP, "a", "read")
    anon.markReading(EXP, "b", "known")
    anon.setPosition(EXP, { viewId: "v1", focusConceptId: "b" })
    await anon.flush()
    expect(server.saves).toBe(0)
    expect(anon.readingCount).toBe(2)
    anon.dispose()

    // Signed in: the account already has an older mark for "b" and a newer one for "c".
    await server.transport("u1").save({
      reading: [
        {
          expeditionId: EXP,
          conceptId: "c",
          state: "read",
          at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      viewSettings: [],
      positions: [],
    })
    const me = client({
      userId: "u1",
      store,
      transport: server.transport("u1"),
    })
    await me.ready
    expect(await me.adoptAnonymous()).toBe(3)
    expect(covered(me)).toEqual(["a", "b"])
    expect(me.getState(EXP).position!.focusConceptId).toBe("b")
    expect(me.pendingCount).toBe(0)
    const saved = server.state("u1")
    expect(Object.keys(saved.reading).sort()).toEqual(["a", "b", "c"])
    expect(await store.load(ANONYMOUS_SCOPE)).toEqual([])
    await me.refresh(EXP)
    expect(covered(me)).toEqual(["a", "b", "c"])
    // Nothing left to adopt the second time.
    expect(await me.adoptAnonymous()).toBe(0)
  })

  it("drops marks the server calls invalid instead of blocking the queue", async () => {
    const errors: unknown[] = []
    const c = client({
      userId: "u1",
      transport: {
        load: async () => ({ reading: [], viewSettings: [], position: null }),
        save: async () => {
          throw new SyncHttpError(400, { error: "invalid body" })
        },
      },
      onError: (e) => errors.push(e),
    })
    await c.ready
    c.markReading(EXP, "a", "read")
    await c.flush()
    expect(c.pendingCount).toBe(0)
    expect(errors).toHaveLength(1)
    expect(covered(c)).toEqual(["a"])
  })
})
