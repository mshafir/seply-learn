// History is Changes (spec §1.4, ADR 0001): grouping ops into Changes,
// coalescing editing sessions, "view as of", undo per Change and restore.
// Undo and restore return new op bodies to append as a new Change.
import { applyBody } from "./apply.ts"
import type { ChangeOrigin } from "./common.ts"
import {
  affectedEntities,
  deepEqual,
  diffKeys,
  flattenEntity,
  flattenState,
  opsToReach,
  parseFieldKey,
  type FieldRef,
  type FlatState,
} from "./fields.ts"
import type { Op, OpBody } from "./ops.ts"
import type { DomainState } from "./state.ts"
import { ulidTime } from "./ulid.ts"

/** An op as the server stored it, with its per-Expedition sequence number. */
export type LoggedOp = Op & { serverSeq: number }

export type ChangeMeta = {
  id: string
  expeditionId: string
  author: string
  origin: ChangeOrigin
  label: string
  at: string
}
export type Change = ChangeMeta & {
  firstSeq: number
  lastSeq: number
  ops: LoggedOp[]
}

const bySeq = (log: readonly LoggedOp[]) =>
  [...log].sort((a, b) => a.serverSeq - b.serverSeq)
const opTime = (op: Op) => new Date(ulidTime(op.opId)).toISOString()

/** Groups a log into Changes, in the order they started. */
export function groupChanges(
  log: readonly LoggedOp[],
  metas: readonly ChangeMeta[]
): Change[] {
  const meta = new Map(metas.map((m) => [m.id, m]))
  const changes = new Map<string, Change>()
  for (const op of bySeq(log)) {
    let c = changes.get(op.changeId)
    if (!c) {
      const m = meta.get(op.changeId)
      if (!m) throw new Error(`no Change ${op.changeId} for op ${op.opId}`)
      c = { ...m, firstSeq: op.serverSeq, lastSeq: op.serverSeq, ops: [] }
      changes.set(op.changeId, c)
    }
    c.ops.push(op)
    c.lastSeq = op.serverSeq
  }
  return [...changes.values()]
}

/** "View as of": replays the log up to and including `seq` (default: all of it). */
export function stateAt(
  initial: DomainState,
  log: readonly LoggedOp[],
  seq = Infinity
): DomainState {
  let state = initial
  for (const op of bySeq(log)) {
    if (op.serverSeq > seq) break
    state = applyBody(state, op, opTime(op))
  }
  return state
}

// --- coalescing ------------------------------------------------------------

/** Editing sessions coalesce per Concept (or per View, …) within this window. */
export const COALESCE_WINDOW_MS = 5 * 60_000

/**
 * What an op edits, for coalescing: `concept:<id>` for a Concept and its
 * article sections, `<entity>:<id>` otherwise. Relationships have no single
 * subject (null never coalesces).
 */
export function opSubject(state: DomainState, op: OpBody): string | null {
  const [prefix] = op.kind.split(".")
  if (prefix === "concept") return `concept:${op.target}`
  if (prefix === "section") {
    const conceptId =
      op.kind === "section.create"
        ? op.value.conceptId
        : state.sections[op.target]?.conceptId
    return conceptId ? `concept:${conceptId}` : null
  }
  if (prefix === "relationship") return null
  return `${prefix}:${op.target}`
}

/** The one subject every op shares, or null. */
export function changeSubject(
  state: DomainState,
  ops: readonly OpBody[]
): string | null {
  const subjects = new Set(ops.map((op) => opSubject(state, op)))
  const [only] = subjects
  return subjects.size === 1 ? only : null
}

export type CoalesceCandidate = {
  author: string
  origin: ChangeOrigin
  subject: string | null
  lastAt: string
}

/** Whether a new human edit joins the open Change instead of starting one. */
export function shouldCoalesce(
  prev: CoalesceCandidate,
  next: {
    author: string
    origin: ChangeOrigin
    subject: string | null
    at: string
  },
  windowMs = COALESCE_WINDOW_MS
): boolean {
  if (prev.origin !== "human" || next.origin !== "human") return false
  if (
    prev.author !== next.author ||
    prev.subject === null ||
    prev.subject !== next.subject
  )
    return false
  const gap = Date.parse(next.at) - Date.parse(prev.lastAt)
  return gap >= 0 && gap <= windowMs
}

// --- undo and restore -----------------------------------------------------

export type Writer = { actor: string; changeId: string; serverSeq: number }
export type KeptEdit = FieldRef & { current: unknown; by?: Writer }

type FieldTrack = {
  /** Values just before the Change first wrote each field (undefined: unset). */
  before: FlatState
  /** Values after the Change last wrote each field. */
  after: FlatState
  /** Who wrote each field last, after the Change. */
  since: Map<string, Writer>
  current: DomainState
}

/** Replays the log, tracking the fields one Change wrote. */
export function trackChange(
  initial: DomainState,
  log: readonly LoggedOp[],
  changeId: string
): FieldTrack {
  const before: FlatState = new Map()
  const after: FlatState = new Map()
  const since = new Map<string, Writer>()
  let state = initial
  for (const op of bySeq(log)) {
    const ents = affectedEntities(state, op)
    const pre = new Map(ents.flatMap(([t, id]) => flattenEntity(state, t, id)))
    state = applyBody(state, op, opTime(op))
    const post = new Map(ents.flatMap(([t, id]) => flattenEntity(state, t, id)))
    for (const key of diffKeys(pre, post)) {
      if (op.changeId === changeId) {
        if (!before.has(key)) before.set(key, pre.get(key))
        after.set(key, post.get(key))
        since.delete(key)
      } else if (before.has(key)) {
        since.set(key, {
          actor: op.actor,
          changeId: op.changeId,
          serverSeq: op.serverSeq,
        })
      }
    }
  }
  return { before, after, since, current: state }
}

export type HistoryResult = { ops: OpBody[]; state: DomainState }

/**
 * Undo a Change: revert only the fields that still hold that Change's value;
 * report the others as kept ("2 edits kept: changed since by Ana").
 * `at` is the time of the undo (used for any tombstones it makes).
 */
export function undoChange(args: {
  initial: DomainState
  log: readonly LoggedOp[]
  changeId: string
  at: string
}): HistoryResult & { kept: KeptEdit[] } {
  const { before, after, since, current } = trackChange(
    args.initial,
    args.log,
    args.changeId
  )
  const curFlat = flattenState(current)
  const revert = new Set<string>()
  const kept: KeptEdit[] = []
  for (const [key, value] of after) {
    if (deepEqual(before.get(key), value)) continue
    if (deepEqual(curFlat.get(key), value)) revert.add(key)
    else
      kept.push({
        ...parseFieldKey(key),
        current: curFlat.get(key),
        by: since.get(key),
      })
  }
  const target: FlatState = new Map(curFlat)
  for (const key of revert) {
    const v = before.get(key)
    if (v === undefined) target.delete(key)
    else target.set(key, v)
  }
  return { ...opsToReach(current, target, revert, args.at), kept }
}

/** Restore to here: the inverse ops that bring the latest state back to `seq`. */
export function restoreTo(args: {
  initial: DomainState
  log: readonly LoggedOp[]
  seq: number
  at: string
}): HistoryResult {
  const current = stateAt(args.initial, args.log)
  const curFlat = flattenState(current)
  const target = flattenState(stateAt(args.initial, args.log, args.seq))
  return opsToReach(current, target, diffKeys(curFlat, target), args.at)
}
