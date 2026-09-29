// The offline read cache (spec §2.9): IndexedDB keeps the last ~10 opened
// Expeditions, plus any marked "Keep available offline" (pinned), per user.
// Each keeps the Expedition's confirmed state as of the last visit (overviews
// and articles included; Source files are never in the state) and the log
// position it was read at. Opened offline, an Expedition is read from here,
// read-only: `openCachedClient` builds a client that never pulls or pushes.
//
// Two object stores: small `meta` records (what the Library lists) and the
// `states` themselves, so listing doesn't load every Expedition.
import { emptyState, type DomainState } from "@umbel/domain"
import { SyncClient, type SyncClientOptions } from "./client.ts"
import { OpEngine } from "./engine.ts"
import { MemoryPendingStore } from "./store.ts"
import type { SyncTransport } from "./transport.ts"

/** How many unpinned Expeditions the cache keeps (spec: "the last ~10"). */
export const OFFLINE_KEEP = 10

/** What the cache knows about one Expedition, for one user. */
export type OfflineEntry = {
  /** The user ("anonymous" for a signed-out reader). */
  actor: string
  expeditionId: string
  title: string
  /** Last opened (ms); orders eviction. */
  openedAt: number
  /** When the state was saved (ms), or null if pinned but not yet downloaded. */
  savedAt: number | null
  /** The log position of the saved state. */
  headSeq: number
  /** "Keep available offline": never evicted. */
  pinned: boolean
}

export type OfflineSnapshot = { state: DomainState; headSeq: number }

/**
 * The Expeditions to drop so that at most `keep` unpinned ones remain: the
 * least recently opened unpinned ones. Pinned ones are always kept.
 */
export function toEvict(
  entries: readonly Pick<
    OfflineEntry,
    "expeditionId" | "openedAt" | "pinned"
  >[],
  keep = OFFLINE_KEEP
): string[] {
  return entries
    .filter((e) => !e.pinned)
    .sort(
      (a, b) =>
        b.openedAt - a.openedAt || (a.expeditionId < b.expeditionId ? 1 : -1)
    )
    .slice(Math.max(keep, 0))
    .map((e) => e.expeditionId)
}

export interface OfflineCacheStore {
  list(actor: string): Promise<OfflineEntry[]>
  getEntry(actor: string, expeditionId: string): Promise<OfflineEntry | null>
  getState(actor: string, expeditionId: string): Promise<DomainState | null>
  /** Writes the entry, and the state when given. */
  put(entry: OfflineEntry, state?: DomainState): Promise<void>
  delete(actor: string, expeditionIds: readonly string[]): Promise<void>
  /** Drops every entry of a user (on sign-out). */
  clear(actor: string): Promise<void>
  close?(): void
}

const key = (actor: string, id: string) => `${actor}\u0000${id}`

export class MemoryOfflineCacheStore implements OfflineCacheStore {
  private readonly entries = new Map<string, OfflineEntry>()
  private readonly states = new Map<string, DomainState>()
  async list(actor: string) {
    return [...this.entries.values()]
      .filter((e) => e.actor === actor)
      .map((e) => ({ ...e }))
  }
  async getEntry(actor: string, id: string) {
    const e = this.entries.get(key(actor, id))
    return e ? { ...e } : null
  }
  async getState(actor: string, id: string) {
    const s = this.states.get(key(actor, id))
    return s ? structuredClone(s) : null
  }
  async put(entry: OfflineEntry, state?: DomainState) {
    this.entries.set(key(entry.actor, entry.expeditionId), { ...entry })
    if (state)
      this.states.set(
        key(entry.actor, entry.expeditionId),
        structuredClone(state)
      )
  }
  async delete(actor: string, ids: readonly string[]) {
    for (const id of ids) {
      this.entries.delete(key(actor, id))
      this.states.delete(key(actor, id))
    }
  }
  async clear(actor: string) {
    for (const e of await this.list(actor))
      await this.delete(actor, [e.expeditionId])
  }
}

const META = "meta"
const STATES = "states"

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"))
  })
}

export type IndexedDbOfflineCacheStoreOptions = {
  /** Database name (default "umbel-offline"). */
  name?: string
  /** The IDBFactory (default `globalThis.indexedDB`; tests pass fake-indexeddb's). */
  indexedDB?: IDBFactory
}

type StateRecord = { actor: string; expeditionId: string; state: DomainState }

export class IndexedDbOfflineCacheStore implements OfflineCacheStore {
  private readonly db: Promise<IDBDatabase>

  constructor(opts: IndexedDbOfflineCacheStoreOptions = {}) {
    const factory = opts.indexedDB ?? globalThis.indexedDB
    const open = factory.open(opts.name ?? "umbel-offline", 1)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(META))
        db.createObjectStore(META, { keyPath: ["actor", "expeditionId"] })
      if (!db.objectStoreNames.contains(STATES))
        db.createObjectStore(STATES, { keyPath: ["actor", "expeditionId"] })
    }
    this.db = req(open)
  }

  private range(actor: string) {
    return IDBKeyRange.bound([actor], [actor, []])
  }

  async list(actor: string): Promise<OfflineEntry[]> {
    const db = await this.db
    const tx = db.transaction(META, "readonly")
    return req(tx.objectStore(META).getAll(this.range(actor)))
  }

  async getEntry(actor: string, id: string): Promise<OfflineEntry | null> {
    const db = await this.db
    const tx = db.transaction(META, "readonly")
    return (await req(tx.objectStore(META).get([actor, id]))) ?? null
  }

  async getState(actor: string, id: string): Promise<DomainState | null> {
    const db = await this.db
    const tx = db.transaction(STATES, "readonly")
    const r: StateRecord | undefined = await req(
      tx.objectStore(STATES).get([actor, id])
    )
    return r?.state ?? null
  }

  async put(entry: OfflineEntry, state?: DomainState): Promise<void> {
    const db = await this.db
    const tx = db.transaction([META, STATES], "readwrite")
    tx.objectStore(META).put(entry)
    if (state)
      tx.objectStore(STATES).put({
        actor: entry.actor,
        expeditionId: entry.expeditionId,
        state,
      } satisfies StateRecord)
    await done(tx)
  }

  async delete(actor: string, ids: readonly string[]): Promise<void> {
    if (!ids.length) return
    const db = await this.db
    const tx = db.transaction([META, STATES], "readwrite")
    for (const id of ids) {
      tx.objectStore(META).delete([actor, id])
      tx.objectStore(STATES).delete([actor, id])
    }
    await done(tx)
  }

  async clear(actor: string): Promise<void> {
    const db = await this.db
    const tx = db.transaction([META, STATES], "readwrite")
    tx.objectStore(META).delete(this.range(actor))
    tx.objectStore(STATES).delete(this.range(actor))
    await done(tx)
  }

  close(): void {
    void this.db.then((db) => db.close())
  }
}

export type OfflineCacheOptions = {
  store: OfflineCacheStore
  /** Unpinned Expeditions kept (default OFFLINE_KEEP). */
  keep?: number
  now?: () => number
}

/**
 * The cache's rules over a store: saving an opened Expedition evicts the
 * least recently opened unpinned ones beyond `keep`; pinning keeps one.
 * Writes are queued, so they land in call order.
 */
export class OfflineCache {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly keep: number
  private readonly now: () => number

  constructor(private readonly opts: OfflineCacheOptions) {
    this.keep = opts.keep ?? OFFLINE_KEEP
    this.now = opts.now ?? Date.now
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task)
    this.queue = next.catch(() => {})
    return next
  }

  list(actor: string): Promise<OfflineEntry[]> {
    return this.run(() => this.opts.store.list(actor))
  }

  /** The saved entry and state, or null if none is saved. */
  get(
    actor: string,
    expeditionId: string
  ): Promise<{ entry: OfflineEntry; state: DomainState } | null> {
    return this.run(async () => {
      const entry = await this.opts.store.getEntry(actor, expeditionId)
      if (!entry || entry.savedAt === null) return null
      const state = await this.opts.store.getState(actor, expeditionId)
      return state ? { entry, state } : null
    })
  }

  /**
   * Saves an Expedition's state as of now. `opened` marks it as just opened
   * (it moves to the front of the ~10); a later save of the same visit
   * passes false.
   */
  save(
    actor: string,
    snapshot: OfflineSnapshot,
    { opened = true }: { opened?: boolean } = {}
  ): Promise<void> {
    return this.run(async () => {
      const expeditionId = snapshot.state.expedition.id
      const prev = await this.opts.store.getEntry(actor, expeditionId)
      const now = this.now()
      await this.opts.store.put(
        {
          actor,
          expeditionId,
          title: snapshot.state.expedition.title,
          openedAt: opened || !prev ? now : prev.openedAt,
          savedAt: now,
          headSeq: snapshot.headSeq,
          pinned: prev?.pinned ?? false,
        },
        snapshot.state
      )
      await this.evict(actor)
    })
  }

  /**
   * Marks an Expedition "Keep available offline" (or not). Pinning one that
   * isn't saved yet records the pin; save it (or `download`) to read it
   * offline. Unpinning may evict it.
   */
  setPinned(
    actor: string,
    expeditionId: string,
    pinned: boolean,
    title = ""
  ): Promise<void> {
    return this.run(async () => {
      const prev = await this.opts.store.getEntry(actor, expeditionId)
      if (!prev && !pinned) return
      await this.opts.store.put(
        prev
          ? { ...prev, pinned }
          : {
              actor,
              expeditionId,
              title,
              openedAt: 0,
              savedAt: null,
              headSeq: 0,
              pinned,
            }
      )
      if (!pinned) await this.evict(actor)
    })
  }

  /** Forgets every Expedition of a user (on sign-out). */
  clear(actor: string): Promise<void> {
    return this.run(() => this.opts.store.clear(actor))
  }

  private async evict(actor: string): Promise<void> {
    const entries = await this.opts.store.list(actor)
    // A pin not downloaded yet holds no state: nothing to evict there.
    await this.opts.store.delete(actor, toEvict(entries, this.keep))
  }
}

/**
 * Downloads an Expedition's whole log and returns its confirmed state (for
 * "Keep available offline" on one not opened on this device yet).
 */
export async function fetchSnapshot(
  transport: SyncTransport,
  expeditionId: string
): Promise<OfflineSnapshot> {
  const engine = new OpEngine(emptyState(expeditionId), { actor: "offline" })
  for (;;) {
    const res = await transport.pull({ expeditionId, since: engine.headSeq })
    engine.receive(res.ops)
    if (!res.more || !res.ops.length) break
  }
  return { state: engine.confirmed, headSeq: engine.headSeq }
}

/**
 * A client over a saved state, for reading offline: it never pulls or
 * pushes (no transport calls), and it never touches the saved pending ops.
 * Editing is the app's to disable (spec §2.9: read-only offline).
 */
export function openCachedClient(
  opts: Omit<SyncClientOptions, "transport" | "autoPush" | "store">,
  snapshot: OfflineSnapshot
): SyncClient {
  const offline: SyncTransport = {
    push: () => Promise.reject(new Error("offline: read-only")),
    pull: () => Promise.reject(new Error("offline: read-only")),
  }
  return new SyncClient(
    {
      ...opts,
      transport: offline,
      store: new MemoryPendingStore(),
      autoPush: false,
    },
    snapshot.state,
    snapshot.headSeq
  )
}
