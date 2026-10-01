// Per-View `hide` (spec §1.6): Concepts a curator left out of one View.
// Outline, Anatomy, Map, Timeline, Quadrant and Rates read `hide` themselves
// (the Outline moves a hidden line's children up); for the other View Types
// the Expedition they draw simply leaves the hidden Concepts out, with their
// Relationships.
import type { Expedition, View } from "./model.ts";

const READS_HIDE = new Set(["outline", "anatomy", "map", "timeline", "quadrant", "rates"]);

/** The Expedition as `view` draws it: without the Concepts it hides (when the View Type doesn't handle `hide` itself). */
export function withoutHidden(expedition: Expedition, view: View | undefined): Expedition {
  if (!view || READS_HIDE.has(view.viewType)) return expedition;
  const hide = (view.settings as { hide?: string[] }).hide;
  if (!hide?.length) return expedition;
  const hidden = new Set(hide);
  return {
    ...expedition,
    concepts: expedition.concepts.filter((c) => !hidden.has(c.id)),
    relationships: expedition.relationships.filter((r) => !hidden.has(r.from) && !hidden.has(r.to)),
  };
}
