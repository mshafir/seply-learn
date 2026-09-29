// TanStack DB collections fed by the op engine (spike, WP-0.5).
//
// One collection per table. Its custom `sync` loads the engine's rows, calls
// `markReady`, then forwards every engine diff as one begin → write… → commit.
// UI edits (`collection.update`) become field-level ops in `onUpdate`, which
// hands them to the engine and resolves once they are applied locally.
//
// The anti-flicker rule (see SPIKE.md): the engine emits its diff, and the sync
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
import type { Op, OpBody } from "@umbel/domain"
import type { OpEngine } from "./engine.ts"
import { deepEqual } from "./engine.ts"
import type {
  ConceptRow,
  RelationshipRow,
  RowChange,
  TableName,
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
   * kept only so the spike's tests and harness can show the flicker it causes.
   */
  delivery?: "sync" | "deferred"
  /**
   * Optional: the handler also waits for this (e.g. server confirmation of
   * the ops) before resolving. Not the design (the op engine owns durability),
   * but the spike checks it doesn't flicker either.
   */
  awaitPersist?: (ops: Op[]) => Promise<void>
}

export type EngineCollections = {
  concepts: Collection<ConceptRow, string>
  relationships: Collection<RelationshipRow, string>
  /**
   * For `createTransaction({ mutationFn })` / `createOptimisticAction`:
   * several edits as one Change. The collections' own handlers use it too.
   */
  mutationFn: (params: {
    transaction: { mutations: ReadonlyArray<AnyMutation> }
  }) => Promise<void>
  dispose: () => void
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

  /**
   * The one mutation handler: every Concept mutation of a transaction → field
   * ops, proposed to the engine as one Change. The engine applies them and
   * emits the diff synchronously (queued behind this still-persisting
   * transaction), then this resolves.
   */
  const mutationFn = async ({
    transaction,
  }: {
    transaction: { mutations: ReadonlyArray<AnyMutation> }
  }): Promise<void> => {
    const bodies: OpBody[] = []
    for (const m of transaction.mutations) {
      if (m.collection !== concepts) continue
      bodies.push(...conceptMutationToOps(m as PendingMutation<ConceptRow>))
    }
    if (!bodies.length) return
    const ops = engine.propose(bodies)
    if (opts.awaitPersist) await opts.awaitPersist(ops)
  }

  const concepts: Collection<ConceptRow, string> = createCollection<
    ConceptRow,
    string
  >({
    id: `${prefix}:concepts`,
    getKey: (c) => c.id,
    startSync: true,
    gcTime: 0,
    sync: syncFor<ConceptRow>("concepts"),
    onUpdate: mutationFn,
    onInsert: mutationFn,
    onDelete: mutationFn,
  })

  // Read-only in the spike: Relationship edits arrive as ops only.
  const relationships = createCollection<RelationshipRow, string>({
    id: `${prefix}:relationships`,
    getKey: (r) => r.key,
    startSync: true,
    gcTime: 0,
    sync: syncFor<RelationshipRow>("relationships"),
  })

  return {
    concepts,
    relationships,
    mutationFn,
    dispose: () => {
      for (const c of cleanups) c()
      void concepts.cleanup()
      void relationships.cleanup()
    },
  }
}

function conceptMutationToOps(m: PendingMutation<ConceptRow>): OpBody[] {
  switch (m.type) {
    case "update": {
      const ops = conceptEditToOps(m.original as ConceptRow, m.modified)
      // An edit no op can express would otherwise stay on screen: TanStack DB
      // keeps a completed optimistic row until sync writes that key.
      if (!ops.length && !deepEqual(m.original, m.modified))
        throw new Error(`no op for this edit of Concept ${String(m.key)}`)
      return ops
    }
    case "insert": {
      const { id, title, kind, tags, aliases } = m.modified
      return [
        {
          kind: "concept.create",
          target: id,
          value: { title, kind, tags, aliases },
        },
      ]
    }
    case "delete":
      return [{ kind: "concept.delete", target: String(m.key) }]
  }
}

const SET_FIELDS = [
  "title",
  "aliases",
  "kind",
  "summary",
  "overview",
  "overviewProv",
  "prov",
  "date",
  "dateEnd",
  "dateApprox",
  "lane",
  "lat",
  "lon",
  "weightPin",
] as const

/** A Concept row edit → field-level ops (`concept.set` per field, tag add/remove). */
export function conceptEditToOps(
  before: ConceptRow,
  after: ConceptRow
): OpBody[] {
  const target = after.id
  const ops: OpBody[] = []
  for (const f of SET_FIELDS) {
    if (!deepEqual(before[f], after[f]))
      ops.push({
        kind: "concept.set",
        target,
        path: f,
        value: after[f] ?? null,
      } as OpBody)
  }
  const attrs = new Set([
    ...Object.keys(before.attributes),
    ...Object.keys(after.attributes),
  ])
  for (const a of attrs) {
    if (!deepEqual(before.attributes[a], after.attributes[a]))
      ops.push({
        kind: "concept.set",
        target,
        path: `attributes.${a}`,
        value: after.attributes[a] ?? null,
      } as OpBody)
  }
  for (const t of after.tags)
    if (!before.tags.includes(t))
      ops.push({ kind: "concept.tag.add", target, value: t })
  for (const t of before.tags)
    if (!after.tags.includes(t))
      ops.push({ kind: "concept.tag.remove", target, value: t })
  return ops
}
