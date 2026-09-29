// Where pending ops survive a reload (spec §2.3: "mirrored to IndexedDB so a
// reload doesn't lose them"). The op engine hands over a snapshot after every
// change to its pending ops; the store writes the difference.
//
// IndexedDB keeps one record per pending op (not one blob per Expedition), so
// two tabs editing the same Expedition don't overwrite each other's pending
// ops: each tab only deletes ops it knew about, once they are confirmed or
// refused. A reloaded tab picks up every pending op of its user for that
// Expedition, including another open tab's; pushing an op twice is harmless
// (the server is idempotent by op id).
import type { Op } from "@umbel/domain"
import type { ChangeMeta, OpenChange, PendingSnapshot } from "./engine.ts"

/** Pending ops belong to one user editing one Expedition. */
export type PendingScope = { expeditionId: string; actor: string }

export interface PendingStore {
  /** The saved pending ops (in the order they were made), or an empty snapshot. */
  load(scope: PendingScope): Promise<PendingSnapshot>
  /** Queues a write of the snapshot; writes land in call order. */
  save(scope: PendingScope, snapshot: PendingSnapshot): void
  /** Resolves when every queued write has landed. */
  flush(): Promise<void>
  close?(): void
}

const emptySnapshot = (): PendingSnapshot => ({
  ops: [],
  changes: [],
  open: null,
  clientSeq: 0,
})
const scopeKey = (s: PendingScope) => `${s.expeditionId}/${s.actor}`
const byOpId = (a: Op, b: Op) =>
  a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0

/** In memory: survives a new engine in the same page (tests, no IndexedDB). */
export class MemoryPendingStore implements PendingStore {
  private readonly data = new Map<string, PendingSnapshot>()
  async load(scope: PendingScope): Promise<PendingSnapshot> {
    return structuredClone(this.data.get(scopeKey(scope)) ?? emptySnapshot())
  }
  save(scope: PendingScope, snapshot: PendingSnapshot): void {
    this.data.set(scopeKey(scope), structuredClone(snapshot))
  }
  async flush(): Promise<void> {}
}

type OpRecord = { scope: string; opId: string; op: Op }
type ChangeRecord = { scope: string; id: string; meta: ChangeMeta }
type MetaRecord = { scope: string; open: OpenChange | null; clientSeq: number }

const DB_VERSION = 1
const OPS = "pendingOps"
const CHANGES = "pendingChanges"
const META = "pendingMeta"

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

export type IndexedDbPendingStoreOptions = {
  /** Database name (default "umbel-sync"). */
  name?: string
  /** The IDBFactory (default `globalThis.indexedDB`; tests pass fake-indexeddb's). */
  indexedDB?: IDBFactory
  /** Called when a queued write fails (the next save retries the whole difference). */
  onError?: (error: unknown) => void
}

export class IndexedDbPendingStore implements PendingStore {
  private readonly db: Promise<IDBDatabase>
  private queue: Promise<void> = Promise.resolve()
  /** What this store last wrote (or loaded), per scope. */
  private readonly written = new Map<
    string,
    { ops: Set<string>; changes: Set<string> }
  >()

  constructor(private readonly opts: IndexedDbPendingStoreOptions = {}) {
    const factory = opts.indexedDB ?? globalThis.indexedDB
    const open = factory.open(opts.name ?? "umbel-sync", DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(OPS))
        db.createObjectStore(OPS, { keyPath: ["scope", "opId"] })
      if (!db.objectStoreNames.contains(CHANGES))
        db.createObjectStore(CHANGES, { keyPath: ["scope", "id"] })
      if (!db.objectStoreNames.contains(META))
        db.createObjectStore(META, { keyPath: "scope" })
    }
    this.db = req(open)
  }

  async load(scope: PendingScope): Promise<PendingSnapshot> {
    await this.queue
    const db = await this.db
    const key = scopeKey(scope)
    const range = IDBKeyRange.bound([key], [key, []])
    const tx = db.transaction([OPS, CHANGES, META], "readonly")
    const [ops, changes, meta] = await Promise.all([
      req(tx.objectStore(OPS).getAll(range)) as Promise<OpRecord[]>,
      req(tx.objectStore(CHANGES).getAll(range)) as Promise<ChangeRecord[]>,
      req(tx.objectStore(META).get(key)) as Promise<MetaRecord | undefined>,
    ])
    this.written.set(key, {
      ops: new Set(ops.map((r) => r.opId)),
      changes: new Set(changes.map((r) => r.id)),
    })
    return {
      ops: ops.map((r) => r.op).sort(byOpId),
      changes: changes.map((r) => r.meta),
      open: meta?.open ?? null,
      clientSeq: meta?.clientSeq ?? 0,
    }
  }

  save(scope: PendingScope, snapshot: PendingSnapshot): void {
    const key = scopeKey(scope)
    this.queue = this.queue
      .then(() => this.write(key, snapshot))
      .catch((e) => this.opts.onError?.(e))
  }

  private async write(key: string, snap: PendingSnapshot): Promise<void> {
    const db = await this.db
    const prev = this.written.get(key) ?? { ops: new Set(), changes: new Set() }
    const ops = new Set(snap.ops.map((op) => op.opId))
    const changes = new Set(snap.changes.map((c) => c.id))
    const tx = db.transaction([OPS, CHANGES, META], "readwrite")
    const opStore = tx.objectStore(OPS)
    for (const op of snap.ops)
      if (!prev.ops.has(op.opId))
        opStore.put({ scope: key, opId: op.opId, op } satisfies OpRecord)
    for (const id of prev.ops) if (!ops.has(id)) opStore.delete([key, id])
    const changeStore = tx.objectStore(CHANGES)
    for (const meta of snap.changes)
      changeStore.put({ scope: key, id: meta.id, meta } satisfies ChangeRecord)
    for (const id of prev.changes)
      if (!changes.has(id)) changeStore.delete([key, id])
    tx.objectStore(META).put({
      scope: key,
      open: snap.open,
      clientSeq: snap.clientSeq,
    } satisfies MetaRecord)
    await done(tx)
    this.written.set(key, { ops, changes })
  }

  flush(): Promise<void> {
    return this.queue
  }

  close(): void {
    void this.db.then((db) => db.close())
  }
}
