// Dev harness: the Views an app would mount, on LIVE data. An Expedition file
// is imported the way a first build is (@umbel/domain), loaded into an
// @umbel/sync op engine, and drawn from its TanStack DB collections through
// <ExpeditionView>, with each canvas View's layout metrics.
// `pnpm --filter @umbel/views dev`.
//
// URL: `?expedition=options` for the synthetic options table, `?expedition=trip`
// for the synthetic trip (Map and Timeline; default: the compute sample); `#<viewId>[/<conceptId>]` with the ids as the file writes
// them; `?instant` skips the layout tween (screenshots); `?theme=dark` starts
// in the dark theme; `?tiles=<url>` sets the Map's PMTiles (default: the
// VITE_MAP_TILES_URL env, else the OpenFreeMap fallback). "Another tab's edit" pulls an edit as if another tab had
// pushed it, so the View reflows. The harness stands in for the app: it loads
// @umbel/ui's tokens, which every colour comes from.
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@umbel/ui/globals.css";
import "@xyflow/react/dist/style.css";
import "../src/canvas/canvas.css";
import "./harness.css";
import computeFile from "@umbel/domain/fixtures/compute.json";
import { builtinId, relKey, type OpBody } from "@umbel/domain";
import {
  anatomy,
  anatomyStats,
  ExpeditionView,
  formatAnatomyStats,
  formatLayoutMetrics,
  isCanvasView,
  layoutMetrics,
  useLiveExpedition,
  type LayoutMetrics,
  type View,
} from "../src/index.ts";
import { computeRiskViewOp, openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import optionsFile from "../fixtures/options.json";
import tripFile from "@umbel/domain/fixtures/trip.json";

const params = new URLSearchParams(location.search);
const instant = params.has("instant");
const which = params.get("expedition") === "options" ? "options" : params.get("expedition") === "trip" ? "trip" : "compute";
const tiles = params.get("tiles") ?? (import.meta.env.VITE_MAP_TILES_URL as string | undefined);
const basemap = tiles ? { tiles } : undefined;
type Theme = "light" | "dark";
const initialTheme: Theme = params.get("theme") === "dark" ? "dark" : "light";

/** The fixture, live, plus what "another tab" does to it. */
function open(): { f: LiveFixture; anotherTab: (n: number) => OpBody[] } {
  if (which === "options") {
    const f = openLiveFixture(optionsFile, { expeditionId: "harness-options" });
    return {
      f,
      // Fill the table's gaps one verdict at a time.
      anotherTab: (n): OpBody[] => {
        const gaps: [string, string, string, string][] = [
          ["crema-compact", "fails", "forty-cups", "a 1.8 L tank"],
          ["crema-compact", "partly-meets", "plumbed", "with the plumbing kit"],
        ];
        const g = gaps[n % gaps.length];
        return [{ kind: "relationship.add", target: relKey(f.concept(g[0]), builtinId(g[1]), f.concept(g[2])), value: { note: g[3] } }];
      },
    };
  }
  if (which === "trip") {
    const f = openLiveFixture(tripFile, { expeditionId: "harness-trip" });
    return {
      f,
      // Another stop: a new place on the Map, and its day on the Timeline.
      anotherTab: (n): OpBody[] => [
        {
          kind: "concept.create",
          target: `another-tab-${n}`,
          value: { title: `Lugano (another tab ${n + 1})`, kind: builtinId("place"), tags: [], lat: 46.004, lon: 8.951, date: "2027-06-12", lane: "days" },
        },
      ],
    };
  }
  const f = openLiveFixture(computeFile, { expeditionId: "harness-compute" });
  // Risk mode of the economics View, as another View of the same Expedition,
  // so the harness can show the ranked lever column.
  f.pull([computeRiskViewOp(f)]);
  return {
    f,
    // A new technique that needs MLA: a new target on the Learning path.
    anotherTab: (n): OpBody[] => {
      const id = `another-tab-${n}`;
      return [
        { kind: "concept.create", target: id, value: { title: `Technique ${n + 1} (another tab)`, kind: builtinId("idea"), tags: ["technique"] } },
        { kind: "relationship.add", target: relKey(f.concept("mla"), builtinId("prerequisite"), id), value: {} },
      ];
    },
  };
}
const { f, anotherTab } = open();

/** File ids ↔ live ids, so URLs read like the file. */
const toLive = (map: Map<string, string>, id: string) => map.get(id) ?? id;
const fromLive = (map: Map<string, string>) => {
  const back = new Map([...map].map(([a, b]) => [b, a]));
  return (id: string) => back.get(id) ?? id;
};
const viewFileId = fromLive(f.ids.views);
const conceptFileId = fromLive(f.ids.concepts);

const drawable = (v: View) => isCanvasView(v) || ["comparison-table", "anatomy", "map", "timeline"].includes(v.viewType);
const noLayout: Record<string, string> = { "comparison-table": "a table", map: "a map", timeline: "a timeline" };

function readHash() {
  const [v, c] = decodeURIComponent(location.hash.slice(1)).split("/");
  return { v: v ? toLive(f.ids.views, v) : undefined, c: c ? toLive(f.ids.concepts, c) : undefined };
}

function Harness() {
  const expedition = useLiveExpedition(f.collections);
  const views = expedition.views.filter(drawable);
  const [state, setState] = useState(readHash);
  const [settled, setSettled] = useState(false);
  const view = views.find((v) => v.id === state.v) ?? views[0];
  const [metrics, setMetrics] = useState<LayoutMetrics>();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [edits, setEdits] = useState(0);

  // As @umbel/ui's ThemeProvider does: only `.dark` goes on <html>.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const q = new URLSearchParams(location.search);
    if (theme === "dark") q.set("theme", "dark");
    else q.delete("theme");
    const search = q.toString().replace(/=(?=&|$)/g, "");
    history.replaceState(null, "", `${search ? `?${search}` : location.pathname}${location.hash}`);
  }, [theme]);

  useEffect(() => {
    const onHash = () => setState(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const hash = [view ? viewFileId(view.id) : "", state.c ? conceptFileId(state.c) : ""].join("/");
    history.replaceState(null, "", `${location.search}#${hash}`);
  }, [view, state.c]);
  // Re-measured whenever the data changes, as the curator agent would.
  useEffect(() => {
    let live = true;
    if (view) layoutMetrics(expedition, view).then((m) => live && setMetrics(m));
    return () => {
      live = false;
    };
  }, [expedition, view]);

  const pick = (v: string) => {
    setSettled(false);
    setState({ v, c: undefined });
  };
  const select = useMemo(() => (c?: string) => setState((s) => ({ ...s, c })), []);
  const pullAnotherTabsEdit = () => {
    f.pull(anotherTab(edits));
    setEdits((n) => n + 1);
  };

  return (
    <div className="harness">
      <header className="harness__bar">
        <strong>{expedition.title}</strong>
        <nav>
          {views.map((v) => (
            <button key={v.id} aria-pressed={v.id === view?.id} onClick={() => pick(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <button className="harness__theme" onClick={pullAnotherTabsEdit}>
          Another tab's edit{edits ? ` (${edits})` : ""}
        </button>
        <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
      </header>
      <p className="harness__meta">
        {view?.description}
        <br />
        <code data-testid="metrics">
          {view?.viewType === "anatomy"
            ? formatAnatomyStats(view.label, anatomyStats(anatomy(expedition, view.settings)))
            : view && !isCanvasView(view)
              ? `${view.label}: ${noLayout[view.viewType]}, no layout`
              : metrics
                ? formatLayoutMetrics(metrics)
                : "measuring…"}
        </code>
      </p>
      <main className="harness__canvas" data-settled={settled || undefined}>
        <ExpeditionView
          collections={f.collections}
          viewId={view?.id}
          selected={state.c}
          onSelect={select}
          transitionMs={instant ? 0 : undefined}
          onSettled={() => setSettled(true)}
          basemap={basemap}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
