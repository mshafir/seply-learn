// The canvas pane: the selected View of the Expedition, drawn by
// @umbel/views from the sync client's live collections. Every change (a local
// edit, a pull, a rebase) re-derives the View; switching Views tweens.
//
// - `viewId` is the View the rail has selected (the screen picks it the same
//   way ExpeditionView does: the URL's, else the best, else the first).
// - Clicking a Concept calls `onSelectConcept(id)`, which opens the side
//   panel; `null` clears the selection.
// - The reader's own state goes with it: `covered` (read or known Concepts
//   get a check; the Learning path skips them) and the View's personal
//   settings (e.g. "Hide what I've read").
// - The View button floats over the top-left corner; the View starts below
//   it (pt-21), so it never covers a toolbar or a table header.
import type { EngineCollections } from "@umbel/sync"
import { ExpeditionView, type ReaderInteraction } from "@umbel/views"

export type CanvasSlotProps = {
  collections: EngineCollections
  viewId: string
  selectedConceptId: string | null
  onSelectConcept: (conceptId: string | null) => void
  /** Called once the View is drawn (a canvas: laid out and fitted). */
  onSettled?: () => void
} & ReaderInteraction

export function CanvasSlot({
  collections,
  viewId,
  selectedConceptId,
  onSelectConcept,
  onSettled,
  ...reader
}: CanvasSlotProps) {
  return (
    <div data-testid="canvas-view" className="size-full pt-21">
      <ExpeditionView
        collections={collections}
        viewId={viewId}
        selected={selectedConceptId ?? undefined}
        onSelect={(id) => onSelectConcept(id ?? null)}
        onSettled={onSettled}
        {...reader}
      />
    </div>
  )
}
