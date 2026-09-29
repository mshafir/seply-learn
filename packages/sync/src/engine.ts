// The op engine (spike, WP-0.5): the client's store of record.
//
// It keeps confirmed ops (server order) and pending ops (ours, not yet
// confirmed). The visible state is `confirmed state + pending ops`, folded
// with @umbel/domain's pure `apply`. When confirmed ops arrive it rebases:
// drop the pending ops the server acknowledged, apply the new confirmed ops,
// re-apply the remaining pending ops on top (last writer wins per field, and
// our unconfirmed edit is the latest writer we know of). After every change to
// the visible state it emits row diffs per table, synchronously.
//
// Not in the spike: undo per Change, view-as-of, Proposal preview,
// IndexedDB mirroring, push/pull transport (WP-1.3).
import {
  apply,
  ApplyError,
  makeOps,
  type DomainState,
  type LoggedOp,
  type Op,
  type OpBody,
} from "@umbel/domain"
import { projectRows, TABLES, type RowDiff, type TableName } from "./rows.ts"

export type EngineListener = (diff: RowDiff) => void

export type EngineOptions = {
  actor: string
  nextOpId: () => string
  /** Called with pending ops that no longer apply after a rebase. */
  onDropped?: (ops: Op[], error: ApplyError) => void
}

export class OpEngine {
  private confirmedState: DomainState
  private confirmedSeq = 0
  private readonly pendingOps: Op[] = []
  private visible: DomainState
  private rows: Record<TableName, Map<string, object>>
  private readonly listeners = new Set<EngineListener>()
  private changeCount = 0
  private clientSeq = 0

  constructor(
    base: DomainState,
    private readonly opts: EngineOptions
  ) {
    this.confirmedState = base
    this.visible = base
    this.rows = projectRows(base)
  }

  get state(): DomainState {
    return this.visible
  }
  get pending(): readonly Op[] {
    return this.pendingOps
  }
  get headSeq(): number {
    return this.confirmedSeq
  }
  /** Current rows of one table (live entities only). */
  rowsOf(table: TableName): ReadonlyMap<string, object> {
    return this.rows[table]
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Local edit: wraps the bodies as one Change, applies them on top of the
   * visible state, queues them as pending and emits the diff before returning.
   * Throws ApplyError (and changes nothing) when an op doesn't apply.
   */
  propose(bodies: readonly OpBody[], changeId?: string): Op[] {
    const ops = makeOps(bodies, {
      expeditionId: this.visible.expedition.id,
      actor: this.opts.actor,
      changeId: changeId ?? `${this.opts.actor}:ch${++this.changeCount}`,
      nextOpId: this.opts.nextOpId,
      firstClientSeq: this.clientSeq,
    })
    const next = ops.reduce(apply, this.visible)
    this.clientSeq += ops.length
    this.pendingOps.push(...ops)
    this.publish(next)
    return ops
  }

  /**
   * Confirmed ops from the server (push echo or pull), in `serverSeq` order.
   * Ops at or below the head are ignored, so redelivery is harmless.
   */
  receive(confirmed: readonly LoggedOp[]): void {
    const fresh = confirmed
      .filter((op) => op.serverSeq > this.confirmedSeq)
      .sort((a, b) => a.serverSeq - b.serverSeq)
    if (!fresh.length) return
    let base = this.confirmedState
    for (const op of fresh) {
      base = apply(base, op)
      this.confirmedSeq = op.serverSeq
    }
    this.confirmedState = base
    const acked = new Set(fresh.map((op) => op.opId))
    const remaining = this.pendingOps.filter((op) => !acked.has(op.opId))
    this.pendingOps.length = 0
    this.publish(this.rebase(remaining))
  }

  /** The server refused these pending ops: drop them and rebase. */
  reject(opIds: readonly string[]): void {
    const drop = new Set(opIds)
    const remaining = this.pendingOps.filter((op) => !drop.has(op.opId))
    this.pendingOps.length = 0
    this.publish(this.rebase(remaining))
  }

  private rebase(pending: readonly Op[]): DomainState {
    let state = this.confirmedState
    const dropped: Op[] = []
    let lastError: ApplyError | undefined
    for (const op of pending) {
      try {
        state = apply(state, op)
        this.pendingOps.push(op)
      } catch (e) {
        if (!(e instanceof ApplyError)) throw e
        dropped.push(op)
        lastError = e
      }
    }
    if (dropped.length && lastError) this.opts.onDropped?.(dropped, lastError)
    return state
  }

  private publish(next: DomainState): void {
    this.visible = next
    const nextRows = projectRows(next)
    const diff: RowDiff = []
    for (const table of TABLES) {
      const prev = this.rows[table]
      const cur = nextRows[table]
      for (const [key, row] of cur) {
        const old = prev.get(key)
        if (!old) diff.push({ table, type: "insert", key, value: row })
        else if (old !== row && !deepEqual(old, row))
          diff.push({ table, type: "update", key, value: row })
        else cur.set(key, old) // keep identity for unchanged rows
      }
      for (const [key, row] of prev)
        if (!cur.has(key)) diff.push({ table, type: "delete", key, value: row })
    }
    this.rows = nextRows
    if (!diff.length) return
    for (const l of this.listeners) l(diff)
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k]
      )
    )
      return false
  }
  return true
}
