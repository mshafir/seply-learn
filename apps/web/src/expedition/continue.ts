// Continue reading (spec §1.7, §3.2): one position per reader per Expedition
// (the View, the Concept in the side panel and its depth). Opening an
// Expedition without a View in the URL lands there; "Back to the start"
// returns to the best View. Pure functions, unit tested.
import type { PositionMark } from "@umbel/domain"

import type { BackStack, PanelEntry } from "@/expedition/reading.ts"

export type Resume = {
  /** The View to open, if it still exists. */
  viewId: string | null
  /** The side panel's stack, if the Concept still exists. */
  stack: BackStack | null
}

/** Where to land from a saved position, or null when there's nothing to resume. */
export function resumeFrom(
  position: PositionMark | null,
  viewExists: (id: string) => boolean,
  conceptExists: (id: string) => boolean
): Resume | null {
  if (!position) return null
  const viewId =
    position.viewId && viewExists(position.viewId) ? position.viewId : null
  const stack: BackStack | null =
    position.focusConceptId && conceptExists(position.focusConceptId)
      ? [
          {
            conceptId: position.focusConceptId,
            depth: position.panelDepth ?? "overview",
          },
        ]
      : null
  return viewId || stack ? { viewId, stack } : null
}

/** What the screen shows now, as a position. */
export type Place = {
  viewId: string | null
  focusConceptId: string | null
  panelDepth: PanelEntry["depth"] | null
}

/** Whether a saved position already says `place` (so saving it again is noise). */
export function samePlace(position: PositionMark | null, place: Place) {
  return (
    !!position &&
    position.viewId === place.viewId &&
    position.focusConceptId === place.focusConceptId &&
    (position.panelDepth ?? null) === place.panelDepth
  )
}
