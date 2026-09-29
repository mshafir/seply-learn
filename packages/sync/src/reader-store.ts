// Where a reader's marks live in the browser (spec §1.7): per scope, which is
// a signed-in user ("user:<id>") or the browser's anonymous reader ("anon").
//
// Each record is one mark (a Concept's Reading status, a View's personal
// settings, or an Expedition's position) and whether it is still waiting to
// be saved on the server (`pending`). For a signed-in reader, pending records
// are the offline mark queue and the rest are a cache for offline reading;
// an anonymous reader's marks are all pending until they sign in and the
// marks merge into their account.
import type {
  PositionMark,
  ReadingMark,
  ViewSettingsMark,
} from "@umbel/domain"

export type MarkRecord =
  | { kind: "reading"; mark: ReadingMark; pending: boolean }
  | { kind: "viewSettings"; mark: ViewSettingsMark; pending: boolean }
  | { kind: "position"; mark: PositionMark; pending: boolean }

/** One record per row: a Concept, a View or an Expedition. */
export function recordKey(r: MarkRecord): string {
  switch (r.kind) {
    case "reading":
      return `reading/${r.mark.expeditionId}/${r.mark.conceptId}`
    case "viewSettings":
      return `viewSettings/${r.mark.expeditionId}/${r.mark.viewId}`
    case "position":
      return `position/${r.mark.expeditionId}`
  }
}

export interface ReaderStore {
  /** Every record of a scope. */
  load(scope: string): Promise<MarkRecord[]>
  /** Writes records (replacing any with the same key), in call order. */
  put(scope: string, records: readonly MarkRecord[]): Promise<void>
  /** Removes every record of a scope. */
  clear(scope: string): Promise<void>
  close?(): void
}

export class MemoryReaderStore implements ReaderStore {
  private readonly data = new Map<string, Map<string, MarkRecord>>()
  async load(scope: string): Promise<MarkRecord[]> {
    return structuredClone([...(this.data.get(scope)?.values() ?? [])])
  }
  async put(scope: string, records: readonly MarkRecord[]): Promise<void> {
    const m = this.data.get(scope) ?? new Map<string, MarkRecord>()
    for (const r of records) m.set(recordKey(r), structuredClone(r))
    this.data.set(scope, m)
  }
  async clear(scope: string): Promise<void> {
    this.data.delete(scope)
  }
}

type Row = MarkRecord & { scope: string; key: string }

const STORE = "marks"

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

export type IndexedDbReaderStoreOptions = {
  /** Database name (default "umbel-reader"). */
  name?: string
  /** The IDBFactory (default `globalThis.indexedDB`; tests pass fake-indexeddb's). */
  indexedDB?: IDBFactory
}

export class IndexedDbReaderStore implements ReaderStore {
  private readonly db: Promise<IDBDatabase>
  private queue: Promise<unknown> = Promise.resolve()

  constructor(opts: IndexedDbReaderStoreOptions = {}) {
    const factory = opts.indexedDB ?? globalThis.indexedDB
    const open = factory.open(opts.name ?? "umbel-reader", 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE))
        open.result.createObjectStore(STORE, { keyPath: ["scope", "key"] })
    }
    this.db = req(open)
  }

  /** Runs after every earlier call, so reads see earlier writes. */
  private run<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const next = this.queue.then(
      () => this.db.then(fn),
      () => this.db.then(fn)
    )
    this.queue = next.catch(() => {})
    return next
  }

  load(scope: string): Promise<MarkRecord[]> {
    return this.run(async (db) => {
      const tx = db.transaction(STORE, "readonly")
      const rows = (await req(
        tx.objectStore(STORE).getAll(IDBKeyRange.bound([scope], [scope, []]))
      )) as Row[]
      return rows.map(
        ({ kind, mark, pending }) => ({ kind, mark, pending }) as MarkRecord
      )
    })
  }

  put(scope: string, records: readonly MarkRecord[]): Promise<void> {
    if (!records.length) return this.run(async () => {})
    return this.run(async (db) => {
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      for (const r of records)
        store.put({ ...r, scope, key: recordKey(r) } as Row)
      await done(tx)
    })
  }

  clear(scope: string): Promise<void> {
    return this.run(async (db) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(IDBKeyRange.bound([scope], [scope, []]))
      await done(tx)
    })
  }

  close(): void {
    void this.db.then((db) => db.close())
  }
}
