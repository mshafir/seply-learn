// Row mutations → ops. Any table, any mix of inserts, updates and deletes:
// the mutations are written into a sketch of the wanted state, and
// @umbel/domain's `opsToReach` (the same field-level machinery undo and
// restore use) produces the ops that get there: field by field (last writer
// wins per field), per settings path for Views, tags as add/remove.
//
// An edit no op can express (a tombstone set by hand, a Relationship's
// endpoints, a Source's fields, deleting a Kind…) throws, and nothing is
// applied: TanStack DB would otherwise keep showing the optimistic row (see
// SPIKE.md). The check is exact: the ops must produce the very rows the
// mutations asked for.
import {
  ApplyError,
  deepEqual,
  diffKeys,
  flattenEntity,
  opsToReach,
  type DomainState,
  type FlatState,
  type OpBody,
} from "@umbel/domain"
import { ENTITY, rowOf, writeRow, type TableName } from "./rows.ts"

export type RowMutation = {
  table: TableName
  type: "insert" | "update" | "delete"
  key: string
  /**
   * insert: the new row. update: only the fields the edit changed, laid over
   * the row as it is now, so a field someone else changed meanwhile is not
   * written back (last writer wins per field). Ignored for deletes.
   */
  value?: object
}

export class UnsupportedEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsupportedEditError"
  }
}

/** Tags are sets: order and duplicates don't count. */
function normalize(table: TableName, row: object): object {
  if (table !== "concepts" && table !== "expeditions") return row
  const tags = (row as { tags?: unknown }).tags
  return Array.isArray(tags) ? { ...row, tags: [...new Set(tags)].sort() } : row
}

/**
 * The ops that turn `state` into the state the mutations describe, checked
 * against it. Throws UnsupportedEditError (or ApplyError) and returns nothing
 * when the mutations can't be expressed exactly.
 */
export function mutationsToOps(
  state: DomainState,
  mutations: readonly RowMutation[],
  at: string
): OpBody[] {
  let target = state
  // What each row should end up as (undefined: gone).
  const want = new Map<string, { m: RowMutation; row: object | undefined }>()
  for (const m of mutations) {
    let row: object | undefined
    if (m.type === "delete") {
      if (m.table === "expeditions")
        throw new UnsupportedEditError(
          "no op for this edit: the Expedition row can't be deleted"
        )
    } else if (m.type === "insert") {
      if (m.table === "expeditions")
        throw new UnsupportedEditError(
          "no op for this edit: Expeditions are created by the server"
        )
      row = normalize(m.table, m.value!)
    } else {
      const base = rowOf(target, m.table, m.key)
      if (!base)
        throw new UnsupportedEditError(
          `no op for this edit: ${m.table} ${m.key} no longer exists`
        )
      row = normalize(m.table, { ...base, ...m.value })
    }
    target = writeRow(target, m.table, m.key, row)
    want.set(`${m.table}\u0000${m.key}`, { m, row })
  }

  const wanted: FlatState = new Map()
  const keys = new Set<string>()
  for (const { m } of want.values()) {
    const entity = ENTITY[m.table]
    const before = new Map(flattenEntity(state, entity, m.key))
    const after = new Map(flattenEntity(target, entity, m.key))
    for (const [k, v] of after) wanted.set(k, v)
    for (const k of diffKeys(before, after)) keys.add(k)
  }

  let result: { ops: OpBody[]; state: DomainState }
  try {
    result = opsToReach(state, wanted, keys, at)
  } catch (e) {
    if (e instanceof ApplyError)
      throw new UnsupportedEditError(`no op for this edit: ${e.message}`)
    throw e
  }

  for (const { m, row } of want.values()) {
    const got = rowOf(result.state, m.table, m.key)
    if (!deepEqual(row, got))
      throw new UnsupportedEditError(
        `no op for this edit of ${m.table} ${m.key}`
      )
  }
  return result.ops
}
