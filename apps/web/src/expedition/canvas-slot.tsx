// The canvas pane: the selected View of the Expedition, drawn by
// @umbel/views from the sync client's live collections. Every change (a local
// edit, a pull, a rebase) re-derives the View; switching Views tweens.
//
// - `viewId` is the View the rail has selected (the screen picks it the same
//   way ExpeditionView does: the URL's, else the best, else the first).
// - Clicking a Concept calls `onSelectConcept(id)`, which opens the side
//   panel; `null` clears the selection.
// - The View button floats over the top-left corner; the View starts below
//   it (pt-21), so it never covers a toolbar or a table header.
// - `personal` is the reader's personal settings for the View; a View's own
//   control changing one calls `onPersonalChange`. `onStatus` receives the
//   View's status for the floating chip.
// - `covered` is the reader's Reading status (read or known Concepts get a
//   check; the Learning path skips them, and hides them with "Hide what I've
//   read"); `onMarkKnown` is the Learning path's "I know …".
// - `matches` (search inside the Expedition) dims every other Concept.
import type { EngineCollections } from "@umbel/sync"
import {
  ExpeditionView,
  type ReaderInteraction,
  type ViewStatusChip,
} from "@umbel/views"

export type CanvasSlotProps = {
  collections: EngineCollections
  viewId: string
  selectedConceptId: string | null
  onSelectConcept: (conceptId: string | null) => void
  /** Called once the View is drawn (a canvas: laid out and fitted). */
  onSettled?: () => void
  personal?: Record<string, unknown>
  onPersonalChange?: (key: string, value: unknown) => void
  onStatus?: (status: ViewStatusChip | null) => void
  /** Search matches: the canvas dims every other Concept. */
  matches?: Set<string>
} & ReaderInteraction

export function CanvasSlot({
  collections,
  viewId,
  selectedConceptId,
  onSelectConcept,
  onSettled,
  personal,
  onPersonalChange,
  onStatus,
  matches,
  covered,
  onMarkKnown,
}: CanvasSlotProps) {
  return (
    <div data-testid="canvas-view" className="size-full pt-21">
      <ExpeditionView
        collections={collections}
        viewId={viewId}
        selected={selectedConceptId ?? undefined}
        onSelect={(id) => onSelectConcept(id ?? null)}
        onSettled={onSettled}
        personal={personal}
        onPersonalChange={onPersonalChange}
        onStatus={onStatus}
        matches={matches}
        covered={covered}
        onMarkKnown={onMarkKnown}
      />
    </div>
  )
}
