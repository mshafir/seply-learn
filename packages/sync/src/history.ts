// History in the op engine (spec §1.4, §2.3; WP-4.2): undo a Change, view
// the Expedition as of a Change, restore to it. All three replay the
// confirmed log the engine has received, through @seply/domain's `history`:
//
// - `undoInEngine` reverts only the fields that still hold the Change's
//   value and reports the others as `kept` (with who changed them since).
// - `restoreInEngine` appends the inverse ops that bring the latest state
//   back to the state at `seq`. The log is never rewound.
// - `stateAsOfIn` replays the log up to `seq` (read-only; nothing is written).
//
// Undo and restore propose their ops as one new Change (never coalesced):
// undo as a human edit, restore with origin `restore`. They work on the
// confirmed log only, so the SyncClient settles first (push, then pull) and
// refuses while edits are still pending (`HistoryError`, "pending").
import {
  emptyState,
  restoreTo,
  stateAt,
  undoChange,
  type DomainState,
  type KeptEdit,
  type Op,
} from "@seply/domain"
import type { OpEngine } from "./engine.ts"

export type HistoryErrorReason =
  /** The engine doesn't hold the whole log (a saved offline copy). */
  | "no-log"
  /** Edits are still waiting to be pushed (offline), so the log isn't final. */
  | "pending"

export class HistoryError extends Error {
  constructor(
    readonly reason: HistoryErrorReason,
    message = reason === "no-log"
      ? "History needs the whole log; this copy doesn't have it."
      : "Some edits haven't been saved yet. Try again once they are."
  ) {
    super(message)
    this.name = "HistoryError"
  }
}

export type HistoryActionOptions = {
  /** The new Change's label (default "Undid a Change" / "Restored an earlier state"). */
  label?: string
  /** When the action happens (ISO; default now). */
  at?: string
}

export type HistoryActionResult = {
  /** The new Change, or null when there was nothing to write. */
  changeId: string | null
  /** The ops it proposed (pending until pushed). */
  ops: Op[]
  /**
   * Undo only: the fields the Change wrote that were kept because someone
   * changed them since (`by` names that later writer). Empty for restore.
   */
  kept: KeptEdit[]
}

const LABEL_MAX = 200

function needLog(engine: OpEngine) {
  if (!engine.hasFullLog) throw new HistoryError("no-log")
}

function propose(
  engine: OpEngine,
  ops: Parameters<OpEngine["propose"]>[0],
  label: string,
  origin: "human" | "restore"
): Pick<HistoryActionResult, "changeId" | "ops"> {
  if (!ops.length) return { changeId: null, ops: [] }
  const proposed = engine.propose(ops, {
    label: label.slice(0, LABEL_MAX),
    origin,
    coalesce: false,
    close: true,
  })
  return { changeId: proposed[0]?.changeId ?? null, ops: proposed }
}

/**
 * Undo a Change, as a new Change on top of the engine's visible state.
 * Unknown Change ids (or a Change already undone) write nothing.
 */
export function undoInEngine(
  engine: OpEngine,
  changeId: string,
  opts: HistoryActionOptions = {}
): HistoryActionResult {
  needLog(engine)
  const r = undoChange({
    initial: emptyState(engine.expeditionId),
    log: engine.log,
    changeId,
    at: opts.at ?? new Date().toISOString(),
  })
  return {
    ...propose(engine, r.ops, opts.label ?? "Undid a Change", "human"),
    kept: r.kept,
  }
}

/** Restore to here: inverse ops bringing the latest state back to `seq`, as a new Change. */
export function restoreInEngine(
  engine: OpEngine,
  seq: number,
  opts: HistoryActionOptions = {}
): HistoryActionResult {
  needLog(engine)
  const r = restoreTo({
    initial: emptyState(engine.expeditionId),
    log: engine.log,
    seq,
    at: opts.at ?? new Date().toISOString(),
  })
  return {
    ...propose(
      engine,
      r.ops,
      opts.label ?? "Restored an earlier state",
      "restore"
    ),
    kept: [],
  }
}

/** "View as of": the confirmed state after every op up to and including `seq`. */
export function stateAsOfIn(engine: OpEngine, seq: number): DomainState {
  needLog(engine)
  return stateAt(emptyState(engine.expeditionId), engine.log, seq)
}
