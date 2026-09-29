// The one component the app mounts in its canvas slot: an Expedition's live
// collections plus the selected View, drawn by that View's renderer.
//
// - Data: read live from the collections (useLiveExpedition). Any change,
//   local or pulled from another tab, re-derives the View; canvas Views
//   re-run their pure layout and tween Concepts to their new places.
// - Switching Views: the incoming View fades in, and a canvas View tweens
//   each Concept from where the previous View drew it (by Concept id), then
//   fits. Positions are only ever held in memory for that tween.
import { useEffect, useEffectEvent, useRef } from "react";
import { useLiveExpedition, type ExpeditionCollections } from "./live.ts";
import { isCanvasView, type Expedition, type View } from "./model.ts";
import type { Positions } from "./layouts.ts";
import { ViewCanvas } from "./canvas/ViewCanvas.tsx";
import type { PositionMemory } from "./canvas/Canvas.tsx";
import { ComparisonTable } from "./table/ComparisonTable.tsx";

/** What every View renderer takes besides the data. */
export type ViewInteraction = {
  /** The selected Concept (the app's side panel shows it). */
  selected?: string;
  onSelect: (id?: string) => void;
  /** Search matches: everything else is dimmed. */
  matches?: Set<string>;
  /** Canvas tween length in ms (0 jumps; screenshots use 0). */
  transitionMs?: number;
  /** Called once the View is drawn: for a canvas, when its layout has settled and been fitted. */
  onSettled?: () => void;
} & ReaderInteraction;

/**
 * The reader's own state (spec §1.7, §4.2), from the app. Every View checks
 * covered Concepts; the Learning path also skips them in its steps.
 */
export type ReaderInteraction = {
  /** Concepts the reader has read or knows ("read" and "known" count the same). */
  covered?: ReadonlySet<string>;
  /** The reader's personal settings for this View, defaults filled in (e.g. `hideRead`, `showAllSteps`). */
  personal?: Record<string, unknown>;
  /** The reader changed a personal setting from inside the View (e.g. "Show all steps"). */
  onPersonalChange?: (settings: Record<string, unknown>) => void;
  /** The reader said they know a Concept (the Learning path's "I know …"). */
  onMarkKnown?: (conceptId: string) => void;
};

export type ExpeditionViewProps = ViewInteraction & {
  /** The Expedition's live collections (@umbel/sync `createEngineCollections`, or any with the same tables). */
  collections: ExpeditionCollections;
  /** The View to show. Missing or unknown (e.g. deleted in another tab): the best View, then the first. */
  viewId?: string;
};

/** The selected View of an Expedition, drawn from its live collections. */
export function ExpeditionView({ collections, viewId, ...rest }: ExpeditionViewProps) {
  const expedition = useLiveExpedition(collections);
  const view = pickView(expedition, viewId);
  return <ViewRenderer expedition={expedition} view={view} {...rest} />;
}

/** The View an ExpeditionView shows for a requested id. */
export function pickView(expedition: Expedition, viewId?: string): View | undefined {
  const byId = (id?: string | null) => (id ? expedition.views.find((v) => v.id === id) : undefined);
  return byId(viewId) ?? byId(expedition.bestViewId) ?? expedition.views[0];
}

export type ViewRendererProps = ViewInteraction & {
  expedition: Expedition;
  view: View | undefined;
};

/** One View of an Expedition you already have (not live): what ExpeditionView renders. */
export function ViewRenderer({ expedition, view, ...rest }: ViewRendererProps) {
  // Shared by every canvas this renderer mounts, so a View switch tweens.
  const memory = useRef<Positions>(new Map()) as PositionMemory;
  // Views with no layout to wait for are settled as soon as they're shown.
  const drawnNow = !view || !isCanvasView(view);
  const settled = useEffectEvent(() => rest.onSettled?.());
  useEffect(() => {
    if (drawnNow) settled();
  }, [drawnNow, view?.id]);
  if (!view) return <div className="umbel-view-empty">This Expedition has no Views yet.</div>;
  return (
    <div className="umbel-view" key={view.id} data-view={view.id} data-view-type={view.viewType}>
      {view.viewType === "comparison-table" ? (
        <ComparisonTable expedition={expedition} view={view} {...rest} />
      ) : isCanvasView(view) ? (
        <ViewCanvas expedition={expedition} view={view} memory={memory} {...rest} />
      ) : (
        <div className="umbel-view-empty">{view.label}: this View Type isn't drawn yet.</div>
      )}
    </div>
  );
}
