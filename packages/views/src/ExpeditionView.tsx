// The one component the app mounts in its canvas slot: an Expedition's live
// collections plus the selected View, drawn by that View's renderer.
//
// - Data: read live from the collections (useLiveExpedition). Any change,
//   local or pulled from another tab, re-derives the View; canvas Views
//   re-run their pure layout and tween Concepts to their new places.
// - Switching Views: the incoming View fades in, and a canvas View tweens
//   each Concept from where the previous View drew it (by Concept id), then
//   fits. Positions are only ever held in memory for that tween.
import { lazy, Suspense, useEffect, useEffectEvent, useRef } from "react";
import { useLiveExpedition, type ExpeditionCollections } from "./live.ts";
import { isCanvasView, type Expedition, type View } from "./model.ts";
import type { Positions } from "./layouts.ts";
import { ViewCanvas } from "./canvas/ViewCanvas.tsx";
import type { PositionMemory } from "./canvas/Canvas.tsx";
import { ComparisonTable } from "./table/ComparisonTable.tsx";
import { Outline } from "./outline/Outline.tsx";
import { Quadrant } from "./quadrant/Quadrant.tsx";
import { Rates } from "./rates/Rates.tsx";
import { Anatomy } from "./anatomy/Anatomy.tsx";
import type { BasemapConfig } from "./map/basemap.ts";

// Map (MapLibre) and Timeline (vis-timeline) are large: they load with their View.
const MapView = lazy(() => import("./map/MapView.tsx").then((m) => ({ default: m.MapView })));
const TimelineView = lazy(() => import("./timeline/TimelineView.tsx").then((m) => ({ default: m.TimelineView })));
/** View Types that call `onSettled` themselves, once drawn. */
const selfSettling = new Set(["map", "timeline"]);

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
  /** The reader's personal settings for this View, View Type defaults filled in (e.g. `showAllSteps`, `hideRead`). */
  personal?: Record<string, unknown>;
  /** A View's own control changed a personal setting. Without it, such controls keep local state. */
  onPersonalChange?: (key: string, value: unknown) => void;
  /** View-specific status for the app's floating chip ("Path to MLA · 7 of 11 read"); null when there is none. */
  onStatus?: (status: ViewStatusChip | null) => void;
  /**
   * Pixels at the top of a canvas View (Evidence, Cause & Effect, Lineage,
   * Learning path) that the app covers with floating controls. The canvas
   * draws under them and fits its Concepts below them; the Learning path's
   * toolbar floats just under them. Other Views ignore it.
   */
  overlayTop?: number;
  /** The Map View's tiles, from the app's config. Unset: the fallback style (OpenFreeMap). */
  basemap?: BasemapConfig;
} & ReaderInteraction;

/**
 * The reader's Reading status (spec §1.7, §4.2), from the app. Every View
 * checks covered Concepts; the Learning path also skips them in its steps,
 * and hides them when `personal.hideRead` is on.
 */
export type ReaderInteraction = {
  /** Concepts the reader has read or knows ("read" and "known" count the same). */
  covered?: ReadonlySet<string>;
  /** The reader said they know a Concept (the Learning path's "I know …"). */
  onMarkKnown?: (conceptId: string) => void;
};

/** What a View reports for the floating status chip, and how to clear it. */
export type ViewStatusChip = { text: string; clear: () => void };

export type ExpeditionViewProps = ViewInteraction & {
  /** The Expedition's live collections (@seply/sync `createEngineCollections`, or any with the same tables). */
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
  const drawnNow = !view || (!isCanvasView(view) && !selfSettling.has(view.viewType));
  const settled = useEffectEvent(() => rest.onSettled?.());
  useEffect(() => {
    if (drawnNow) settled();
  }, [drawnNow, view?.id]);
  if (!view) return <div className="seply-view-empty">This Expedition has no Views yet.</div>;
  return (
    <div className="seply-view" key={view.id} data-view={view.id} data-view-type={view.viewType}>
      {view.viewType === "comparison-table" ? (
        <ComparisonTable expedition={expedition} view={view} {...rest} />
      ) : view.viewType === "outline" ? (
        <Outline expedition={expedition} view={view} {...rest} />
      ) : view.viewType === "quadrant" ? (
        <Quadrant expedition={expedition} view={view} {...rest} />
      ) : view.viewType === "rates" ? (
        <Rates expedition={expedition} view={view} {...rest} />
      ) : view.viewType === "map" || view.viewType === "timeline" ? (
        <Suspense fallback={<div className="seply-view-empty">Loading {view.label}…</div>}>
          {view.viewType === "map" ? <MapView expedition={expedition} view={view} {...rest} /> : <TimelineView expedition={expedition} view={view} {...rest} />}
        </Suspense>
      ) : view.viewType === "anatomy" ? (
        <Anatomy expedition={expedition} view={view} {...rest} />
      ) : isCanvasView(view) ? (
        <ViewCanvas expedition={expedition} view={view} memory={memory} {...rest} />
      ) : (
        <div className="seply-view-empty">{(view as { label: string }).label}: this View Type isn't drawn yet.</div>
      )}
    </div>
  );
}
