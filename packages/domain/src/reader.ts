// Per-reader state (spec §1.7): Reading status, personal View settings and
// the reader's position. It belongs to one reader, lives outside the op log
// (never part of a Change, never undone, never forked) and is saved as
// "marks": plain rows where the newest write wins, by `at`.
//
// The server, the sync client and the browser's anonymous store all speak
// these shapes, so they live here.
import { z } from "zod"
import { Id, ReadingState } from "./common.ts"

/** The most marks of each sort one save may carry. */
export const READER_BATCH_LIMIT = 1000

/** When a mark was made: an ISO 8601 UTC time (`Date#toISOString`). */
export const MarkTime = z.iso.datetime()

/** Where one reader stands with one Concept. */
export const ReadingMark = z.object({
  expeditionId: Id,
  conceptId: Id,
  state: ReadingState,
  at: MarkTime,
})
export type ReadingMark = z.infer<typeof ReadingMark>

/**
 * A reader's own settings for one View (e.g. "Hide what I've read"). Only the
 * values the reader chose; the View Type's defaults fill in the rest, and an
 * empty object is "Reset".
 */
export const ViewSettingsMark = z.object({
  expeditionId: Id,
  viewId: Id,
  settings: z.record(z.string(), z.unknown()),
  at: MarkTime,
})
export type ViewSettingsMark = z.infer<typeof ViewSettingsMark>

export const PanelDepth = z.enum(["overview", "article"])

/** Where the reader left off in one Expedition (Continue reading). */
export const PositionMark = z.object({
  expeditionId: Id,
  viewId: Id.nullable(),
  focusConceptId: Id.nullable(),
  step: z.number().int().min(0).nullable(),
  panelDepth: PanelDepth.nullable(),
  at: MarkTime,
})
export type PositionMark = z.infer<typeof PositionMark>

/** One save: any number of marks, across Expeditions. */
export const ReaderBatch = z.object({
  reading: z.array(ReadingMark).max(READER_BATCH_LIMIT).default([]),
  viewSettings: z.array(ViewSettingsMark).max(READER_BATCH_LIMIT).default([]),
  positions: z.array(PositionMark).max(READER_BATCH_LIMIT).default([]),
})
export type ReaderBatch = z.infer<typeof ReaderBatch>

/** One reader's state in one Expedition, keyed by Concept and View. */
export type ReaderState = {
  reading: Record<string, ReadingMark>
  viewSettings: Record<string, ViewSettingsMark>
  position: PositionMark | null
}

export const emptyReaderState = (): ReaderState => ({
  reading: {},
  viewSettings: {},
  position: null,
})

export const emptyReaderBatch = (): ReaderBatch => ({
  reading: [],
  viewSettings: [],
  positions: [],
})

/** Whether `next` replaces `prev`: the newest write wins, and a tie keeps what is there. */
export function isNewer(next: { at: string }, prev?: { at: string } | null) {
  return !prev || Date.parse(next.at) > Date.parse(prev.at)
}

/** Applies marks of one Expedition to its state (newest wins); returns a new state. */
export function applyMarks(
  state: ReaderState,
  batch: Partial<ReaderBatch>,
  expeditionId: string
): ReaderState {
  let out = state
  const copy = () => {
    if (out === state)
      out = {
        reading: { ...state.reading },
        viewSettings: { ...state.viewSettings },
        position: state.position,
      }
    return out
  }
  for (const m of batch.reading ?? [])
    if (m.expeditionId === expeditionId && isNewer(m, out.reading[m.conceptId]))
      copy().reading[m.conceptId] = m
  for (const m of batch.viewSettings ?? [])
    if (m.expeditionId === expeditionId && isNewer(m, out.viewSettings[m.viewId]))
      copy().viewSettings[m.viewId] = m
  for (const m of batch.positions ?? [])
    if (m.expeditionId === expeditionId && isNewer(m, out.position))
      copy().position = m
  return out
}

/** A state as the marks that make it. */
export function stateToBatch(state: ReaderState): ReaderBatch {
  return {
    reading: Object.values(state.reading),
    viewSettings: Object.values(state.viewSettings),
    positions: state.position ? [state.position] : [],
  }
}

/** Both batches in one, keeping only the newest mark per key. */
export function mergeBatches(a: ReaderBatch, b: ReaderBatch): ReaderBatch {
  const newest = <T extends { at: string }>(
    xs: T[],
    key: (x: T) => string
  ): T[] => {
    const by = new Map<string, T>()
    for (const x of xs) if (isNewer(x, by.get(key(x)))) by.set(key(x), x)
    return [...by.values()]
  }
  return {
    reading: newest(
      [...a.reading, ...b.reading],
      (m) => `${m.expeditionId}/${m.conceptId}`
    ),
    viewSettings: newest(
      [...a.viewSettings, ...b.viewSettings],
      (m) => `${m.expeditionId}/${m.viewId}`
    ),
    positions: newest([...a.positions, ...b.positions], (m) => m.expeditionId),
  }
}

export const batchSize = (b: ReaderBatch) =>
  b.reading.length + b.viewSettings.length + b.positions.length

/**
 * Concepts the reader has covered: read or known. Views check them, and the
 * Learning path and Outline skip them ("read" and "known" count the same).
 */
export function coveredConcepts(state: ReaderState): Set<string> {
  const out = new Set<string>()
  for (const m of Object.values(state.reading))
    if (m.state !== "unread") out.add(m.conceptId)
  return out
}
