// The canvas pane: the selected View of the Expedition, drawn by
// @seply/views from the sync client's live collections. Every change (a local
// edit, a pull, a rebase) re-derives the View; switching Views tweens.
//
// - `viewId` is the View the rail has selected (the screen picks it the same
//   way ExpeditionView does: the URL's, else the best, else the first).
// - Clicking a Concept calls `onSelectConcept(id)`, which opens the side
//   panel; `null` clears the selection.
// - The View button floats over the top-left corner. Canvas Views (Evidence,
//   Cause & Effect, Lineage, Learning path) draw under it and fit their
//   Concepts below it (`overlayTop`); the others start below it (pt-21), so
//   it never covers a table header or a timeline axis.
// - `personal` is the reader's personal settings for the View; a View's own
//   control changing one calls `onPersonalChange`. `onStatus` receives the
//   View's status for the floating chip.
// - `covered` is the reader's Reading status (read or known Concepts get a
//   check; the Learning path skips them, and hides them with "Hide what I've
//   read"); `onMarkKnown` is the Learning path's "I know …".
// - `matches` (search inside the Expedition) dims every other Concept.
// - `suggested` (the Suggestions preview, WP-4.3) draws pending items dashed;
//   `collections` are then the preview's.
// - The Map View's tiles come from the build's env (lib/basemap.ts).
import type { EngineCollections } from "@seply/sync"
import {
  canvasViewTypes,
  ExpeditionView,
  type ReaderInteraction,
  type SuggestedInteraction,
  type ViewStatusChip,
} from "@seply/views"
import { basemap } from "@/lib/basemap"

/** The height the View button covers (top-4 + the button + a gap: pt-21). */
const VIEW_BUTTON_AREA = 84

export type CanvasSlotProps = {
  collections: EngineCollections
  viewId: string
  /** The View's type: canvas Views draw under the View button. */
  viewType: string
  selectedConceptId: string | null
  onSelectConcept: (conceptId: string | null) => void
  /** Called once the View is drawn (a canvas: laid out and fitted). */
  onSettled?: () => void
  personal?: Record<string, unknown>
  onPersonalChange?: (key: string, value: unknown) => void
  onStatus?: (status: ViewStatusChip | null) => void
  /** Search matches: the canvas dims every other Concept. */
  matches?: Set<string>
} & ReaderInteraction &
  SuggestedInteraction

export function CanvasSlot({
  collections,
  viewId,
  viewType,
  selectedConceptId,
  onSelectConcept,
  onSettled,
  personal,
  onPersonalChange,
  onStatus,
  matches,
  covered,
  onMarkKnown,
  suggested,
}: CanvasSlotProps) {
  const underButton = (canvasViewTypes as readonly string[]).includes(viewType)
  return (
    <div
      data-testid="canvas-view"
      className={underButton ? "size-full" : "size-full pt-21"}
    >
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
        suggested={suggested}
        basemap={basemap}
        overlayTop={underButton ? VIEW_BUTTON_AREA : undefined}
      />
    </div>
  )
}
