// The op engine: the client's store of record for one Expedition (spec §2.3).
//
// It keeps confirmed ops (server order) and pending ops (ours, not yet
// confirmed). The visible state is `confirmed state + pending ops`, folded
// with @umbel/domain's pure `apply`. When confirmed ops arrive it rebases:
// drop the pending ops the server acknowledged, apply the new confirmed ops,
// re-apply the remaining pending ops on top (last writer wins per field, and
// our unconfirmed edit is the latest writer we know of). Pending ops that no
// longer apply are dropped and reported.
//
// After every change to the visible state it emits row diffs, synchronously
// (the no-flicker rule, SPIKE.md). After every change to the pending ops it
// hands a snapshot to `onPendingChange`, synchronously too, which the sync
// client mirrors to IndexedDB so a reload loses nothing.
//
// Local edits are grouped into Changes, and editing sessions coalesce: an
// edit joins the open Change when the same author edits the same subject
// (a Concept, a View…) within the window (spec §1.4, `shouldCoalesce`).
import {
  apply,
  ApplyError,
  changeSubject,
  COALESCE_WINDOW_MS,
  isLive,
  makeOps,
  shouldCoalesce,
  type DomainState,
  type LoggedOp,
  type Op,
  type OpBody,
} from "@umbel/domain"
import { monotonicUlid } from "./ids.ts"
import { RowProjection, type RowDiff, type TableName } from "./rows.ts"

export type EngineListener = (diff: RowDiff) => void

/** Change origins a client may push (the server's CLIENT_ORIGINS). */
export type ClientOrigin = "human" | "restore" | "merge"

/** What the server needs to record a Change (sent with the push). */
export type ChangeMeta = {
  id: string
  label?: string
  origin: ClientOrigin
  /** The label is ours (from the edit), so it follows the session. Not sent. */
  autoLabel?: boolean
}

/** The Change an editing session is still adding to. */
export type OpenChange = {
  id: string
  origin: ClientOrigin
  subject: string | null
  lastAt: string
}

/** Everything unconfirmed: what IndexedDB keeps across a reload. */
export type PendingSnapshot = {
  /** In the order they were made (op ids sort that way). */
  ops: Op[]
  /** The Changes the pending ops (and the open Change) belong to. */
  changes: ChangeMeta[]
  open: OpenChange | null
  clientSeq: number
}

export type ProposeOptions = {
  /** History label; default from the edit ("Edited Attention"). */
  label?: string
  origin?: ClientOrigin
  /** Join this Change instead of choosing. */
  changeId?: string
  /** false: always start a new Change (default true for human edits). */
  coalesce?: boolean
}

export type EngineOptions = {
  actor: string
  /** Op ids: ULIDs, increasing (default: monotonic ULIDs from `now`). */
  nextOpId?: () => string
  /** Change ids (default: ULIDs from `now`). */
  nextChangeId?: () => string
  /** The clock for coalescing (ms). */
  now?: () => number
  coalesceWindowMs?: number
  /** Called with pending ops that no longer apply after a rebase (not the refused ones). */
  onDropped?: (ops: Op[], error: ApplyError | null) => void
  /** Called synchronously whenever the pending ops or their Changes change. */
  onPendingChange?: (snapshot: PendingSnapshot) => void
}

const LABEL_MAX = 200

export class OpEngine {
  private confirmedState: DomainState
  private confirmedSeq: number
  private readonly confirmedIds = new Set<string>()
  private readonly pendingOps: Op[] = []
  private readonly changeMetas = new Map<string, ChangeMeta>()
  private openChange: OpenChange | null = null
  private visible: DomainState
  private readonly projection: RowProjection
  private readonly listeners = new Set<EngineListener>()
  private clientSeq = 0
  private readonly nextOpId: () => string
  private readonly nextChangeId: () => string
  private readonly now: () => number

  constructor(
    base: DomainState,
    private readonly opts: EngineOptions,
    baseSeq = 0
  ) {
    this.confirmedState = base
    this.confirmedSeq = baseSeq
    this.visible = base
    this.projection = new RowProjection(base)
    this.now = opts.now ?? Date.now
    this.nextOpId = opts.nextOpId ?? monotonicUlid(this.now)
    this.nextChangeId = opts.nextChangeId ?? monotonicUlid(this.now)
  }

  get actor(): string {
    return this.opts.actor
  }
  get expeditionId(): string {
    return this.visible.expedition.id
  }
  /** Confirmed + pending. */
  get state(): DomainState {
    return this.visible
  }
  /** The server's state as far as we know it. */
  get confirmed(): DomainState {
    return this.confirmedState
  }
  get pending(): readonly Op[] {
    return this.pendingOps
  }
  get headSeq(): number {
    return this.confirmedSeq
  }
  get open(): OpenChange | null {
    return this.openChange
  }
  /** Current rows of one table (live entities only). */
  rowsOf(table: TableName): ReadonlyMap<string, object> {
    return this.projection.rowsOf(table)
  }
  /** The Change metadata for some ops (for a push). */
  changesFor(ops: readonly Op[]): ChangeMeta[] {
    const ids = new Set(ops.map((op) => op.changeId))
    return [...ids].flatMap((id) => {
      const m = this.changeMetas.get(id)
      if (!m) return []
      const { autoLabel: _auto, ...meta } = m
      void _auto
      return [meta]
    })
  }

  snapshot(): PendingSnapshot {
    return {
      ops: [...this.pendingOps],
      changes: [...this.changeMetas.values()],
      open: this.openChange,
      clientSeq: this.clientSeq,
    }
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Local edit: applies the bodies on top of the visible state as part of one
   * Change (the open one, when the edit coalesces), queues them as pending,
   * and emits the diff and the pending snapshot before returning.
   * Throws ApplyError (and changes nothing) when an op doesn't apply.
   */
  propose(bodies: readonly OpBody[], options: ProposeOptions = {}): Op[] {
    if (!bodies.length) return []
    const origin = options.origin ?? "human"
    const at = new Date(this.now()).toISOString()
    const subject = changeSubject(this.visible, bodies)
    const open = this.openChange
    let changeId = options.changeId
    if (!changeId && options.coalesce !== false && open) {
      const joins = shouldCoalesce(
        {
          author: this.actor,
          origin: open.origin,
          subject: open.subject,
          lastAt: open.lastAt,
        },
        { author: this.actor, origin, subject, at },
        this.opts.coalesceWindowMs ?? COALESCE_WINDOW_MS
      )
      if (joins) changeId = open.id
    }
    changeId ??= this.nextChangeId()

    const ops = makeOps(bodies, {
      expeditionId: this.expeditionId,
      actor: this.actor,
      changeId,
      nextOpId: this.nextOpId,
      firstClientSeq: this.clientSeq,
    })
    const next = ops.reduce(apply, this.visible) // throws before any change
    this.clientSeq += ops.length
    this.pendingOps.push(...ops)
    const meta = this.changeMetas.get(changeId)
    if (!meta || (meta.autoLabel && options.label === undefined)) {
      // A new Change, or an editing session whose label follows the edit
      // ("Edited Att" once "A" has become "Att").
      const label = options.label ?? defaultLabel(next, bodies)
      this.changeMetas.set(changeId, {
        id: changeId,
        origin: meta?.origin ?? origin,
        ...(label ? { label: label.slice(0, LABEL_MAX) } : {}),
        ...(options.label === undefined ? { autoLabel: true } : {}),
      })
    } else if (options.label !== undefined) {
      this.changeMetas.set(changeId, {
        ...meta,
        label: options.label.slice(0, LABEL_MAX),
        autoLabel: false,
      })
    }
    this.openChange = { id: changeId, origin, subject, lastAt: at }
    this.publish(next)
    this.persist()
    return ops
  }

  /**
   * Confirmed ops from the server (push results or pull), in `serverSeq`
   * order and without gaps after `headSeq`. Ops at or below the head are
   * ignored, so redelivery is harmless.
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
      this.confirmedIds.add(op.opId)
    }
    this.confirmedState = base
    const before = this.pendingOps.length
    const remaining = this.pendingOps.filter(
      (op) => !this.confirmedIds.has(op.opId)
    )
    this.pendingOps.length = 0
    this.publish(this.rebase(remaining))
    if (this.pendingOps.length !== before) this.persist()
  }

  /** The server refused these pending ops: drop them and rebase. */
  reject(opIds: readonly string[]): void {
    const drop = new Set(opIds)
    if (!this.pendingOps.some((op) => drop.has(op.opId))) return
    const remaining = this.pendingOps.filter((op) => !drop.has(op.opId))
    this.pendingOps.length = 0
    this.publish(this.rebase(remaining))
    this.persist()
  }

  /**
   * Brings back pending ops saved before a reload (after catching up with
   * the server, so they rebase onto current state). Ops the server already
   * confirmed are skipped; ops that no longer apply are dropped.
   */
  restore(saved: PendingSnapshot): void {
    const known = new Set(this.pendingOps.map((op) => op.opId))
    const extra = saved.ops.filter(
      (op) =>
        op.expeditionId === this.expeditionId &&
        op.actor === this.actor &&
        !known.has(op.opId) &&
        !this.confirmedIds.has(op.opId)
    )
    for (const c of saved.changes)
      if (!this.changeMetas.has(c.id)) this.changeMetas.set(c.id, c)
    this.openChange ??= saved.open
    this.clientSeq = Math.max(this.clientSeq, saved.clientSeq)
    const all = [...this.pendingOps, ...extra].sort((a, b) =>
      a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0
    )
    this.pendingOps.length = 0
    this.publish(this.rebase(all))
    this.persist()
  }

  private rebase(pending: readonly Op[]): DomainState {
    let state = this.confirmedState
    const dropped: Op[] = []
    let lastError: ApplyError | null = null
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
    if (dropped.length) this.opts.onDropped?.(dropped, lastError)
    return state
  }

  private publish(next: DomainState): void {
    this.visible = next
    const diff = this.projection.update(next)
    if (diff.length) for (const l of this.listeners) l(diff)
  }

  private persist(): void {
    // Keep the metadata of Changes that still have pending ops, and the open one.
    const live = new Set(this.pendingOps.map((op) => op.changeId))
    if (this.openChange) live.add(this.openChange.id)
    for (const id of this.changeMetas.keys())
      if (!live.has(id)) this.changeMetas.delete(id)
    this.opts.onPendingChange?.(this.snapshot())
  }
}

/** A history label for a new Change, from what it edits. */
function defaultLabel(
  state: DomainState,
  bodies: readonly OpBody[]
): string | undefined {
  const subject = changeSubject(state, bodies)
  if (!subject) return undefined
  const [type, id] = [
    subject.slice(0, subject.indexOf(":")),
    subject.slice(subject.indexOf(":") + 1),
  ]
  if (type === "concept") {
    const c = state.concepts[id]
    if (!c) return undefined
    if (bodies.every((b) => b.kind === "concept.create"))
      return `Added ${c.title}`
    if (bodies.every((b) => b.kind === "concept.delete"))
      return `Deleted ${c.title}`
    return `Edited ${c.title}`
  }
  if (type === "view") {
    const v = state.views[id]
    return v && isLive(v) ? `Edited the ${v.label} View` : undefined
  }
  if (type === "expedition") return "Edited the Expedition"
  return undefined
}
