// TanStack DB collections fed by the op engine: the live query layer.
//
// One collection per table (rows.ts). Its custom `sync` loads the engine's
// rows, calls `markReady`, then forwards every engine diff as one
// begin → write… → commit. UI edits (`collection.insert/update/delete`, or
// several in `createTransaction({ mutationFn })`) become ops in the shared
// `mutationFn`, which proposes them to the engine as one Change (coalescing
// with the open editing session where it can) and resolves once they are
// applied locally. Durability, push, retry and rebase stay in the engine and
// the sync client.
//
// The anti-flicker rule (SPIKE.md): the engine emits its diff, and the sync
// commit is queued, BEFORE the mutation handler resolves. TanStack DB holds
// sync commits while a transaction is `persisting` and applies them in the
// same step that drops the optimistic layer, so the row goes straight from the
// optimistic value to the synced one.
import {
  createCollection,
  type Collection,
  type PendingMutation,
  type SyncConfig,
} from "@tanstack/db"
import type { Op } from "@umbel/domain"
import type { OpEngine, ProposeOptions } from "./engine.ts"
import { mutationsToOps, type RowMutation } from "./mutations.ts"
import {
  TABLES,
  type RowChange,
  type RowsByTable,
  type TableName,
} from "./rows.ts"

// Mutations of any collection: a transaction can span several.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMutation = PendingMutation<any>

export type EngineCollectionsOptions = {
  /** Prefix for collection ids (several engines in one page or test). */
  id?: string
  /**
   * How engine diffs reach the collections. `sync` (the default and the
   * design) forwards them in the same call stack. `deferred` forwards them on
   * a macrotask, after the mutation handler has resolved: the broken wiring,
   * kept only so the flicker tests and harness can show the flicker it causes.
   */
  delivery?: "sync" | "deferred"
  /**
   * Optional: the handler also waits for this (e.g. server confirmation of
   * the ops) before resolving. Not the design (the op engine owns durability),
   * but the flicker tests check it doesn't flicker either.
   */
  awaitPersist?: (ops: Op[]) => Promise<void>
}

export type TableCollections = {
  [T in TableName]: Collection<RowsByTable[T], string>
}

export type MutationFn = (params: {
  transaction: {
    mutations: ReadonlyArray<AnyMutation>
    metadata?: Record<string, unknown>
  }
}) => Promise<void>

export type EngineCollections = TableCollections & {
  /**
   * For `createTransaction({ mutationFn })` / `createOptimisticAction`:
   * several edits as one Change. The collections' own handlers use it too.
   * A transaction's `metadata.change` (ProposeOptions) sets the Change's
   * label or origin, or turns coalescing off.
   */
  mutationFn: MutationFn
  dispose: () => void
}

const KEY: { [T in TableName]: (row: RowsByTable[T]) => string } = {
  expeditions: (r) => r.id,
  concepts: (r) => r.id,
  articleSections: (r) => r.id,
  relationships: (r) => r.key,
  kindDefs: (r) => r.id,
  relTypeDefs: (r) => r.id,
  attributeDefs: (r) => r.id,
  views: (r) => r.id,
  sources: (r) => r.id,
}

export function createEngineCollections(
  engine: OpEngine,
  opts: EngineCollectionsOptions = {}
): EngineCollections {
  const prefix = opts.id ?? "umbel"
  const cleanups: Array<() => void> = []

  // Each table's sync registers here once it starts.
  const sinks = new Map<TableName, (changes: RowChange[]) => void>()
  const forward = (changes: RowChange[]) => {
    const byTable = new Map<TableName, RowChange[]>()
    for (const c of changes) {
      const list = byTable.get(c.table) ?? []
      list.push(c)
      byTable.set(c.table, list)
    }
    for (const [table, list] of byTable) sinks.get(table)?.(list)
  }
  cleanups.push(
    engine.subscribe((diff) => {
      if (opts.delivery === "deferred") setTimeout(() => forward(diff), 0)
      else forward(diff)
    })
  )

  function syncFor<T extends object>(table: TableName): SyncConfig<T, string> {
    return {
      rowUpdateMode: "full",
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of engine.rowsOf(table).values())
          write({ type: "insert", value: row as T })
        commit()
        markReady()
        sinks.set(table, (changes) => {
          begin()
          for (const c of changes) write({ type: c.type, value: c.value as T })
          commit()
        })
        return () => {
          sinks.delete(table)
        }
      },
    }
  }

  const tableOf = new Map<unknown, TableName>()

  /**
   * The one mutation handler: every mutation of a transaction → ops,
   * proposed to the engine as one Change. The engine applies them and emits
   * the diff synchronously (queued behind this still-persisting
   * transaction), then this resolves. An edit no op can express throws, so
   * the transaction rolls back instead of leaving the optimistic row showing.
   */
  const mutationFn: MutationFn = async ({ transaction }) => {
    const mutations: RowMutation[] = []
    for (const m of transaction.mutations) {
      const table = tableOf.get(m.collection)
      if (!table) continue
      mutations.push({
        table,
        type: m.type,
        key: String(m.key),
        value: (m.type === "update" ? m.changes : m.modified) as object,
      })
    }
    if (!mutations.length) return
    const at = new Date().toISOString()
    const bodies = mutationsToOps(engine.state, mutations, at)
    if (!bodies.length) return
    const change = transaction.metadata?.change as ProposeOptions | undefined
    const ops = engine.propose(bodies, change)
    if (opts.awaitPersist) await opts.awaitPersist(ops)
  }

  const collections = {} as Record<TableName, Collection<object, string>>
  for (const table of TABLES) {
    const c = createCollection<object, string>({
      id: `${prefix}:${table}`,
      getKey: KEY[table] as (row: object) => string,
      startSync: true,
      gcTime: 0,
      sync: syncFor<object>(table),
      onInsert: mutationFn,
      onUpdate: mutationFn,
      onDelete: mutationFn,
    })
    collections[table] = c
    tableOf.set(c, table)
  }

  return {
    ...(collections as unknown as TableCollections),
    mutationFn,
    dispose: () => {
      for (const c of cleanups) c()
      for (const c of Object.values(collections)) void c.cleanup()
    },
  }
}
