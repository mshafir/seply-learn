import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerSource from "virtual:maplibre-worker";
import type { ErrorEvent, GeoJSONSource, MapGeoJSONFeature, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Concept, Graph, MapSettings } from "../lib/types";
import { matchesFilter } from "../lib/view";

// OpenFreeMap: free vector tiles, no key. A self-hosted PMTiles extract is
// the likely product route (see docs/view-types/map.md).
const STYLE = "https://tiles.openfreemap.org/styles/positron";
const FONT = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];

// Module workers can't load from a blob on file://, so the worker is a
// classic script; MapLibre only starts a classic worker for a ".cjs" URL,
// and a blob URL ignores its fragment.
maplibregl.setWorkerUrl(`${URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }))}#.cjs`);

const standingColor: Record<string, string> = { chosen: "#059669", "in-play": "#d97706", "ruled-out": "#a8a29e" };
const otherColor = "#7c3aed"; // located Concepts with no standing (day trips)

// Map View Type (docs/view-types/map.md): located Concepts on a real basemap.
// Position is the structure, so containment isn't drawn; only spatial
// Relationships (day trips) are lines. Regions are labels, home is marked.
export function GeoMap({
  graph,
  settings: s,
  selected,
  onSelect,
  matches,
}: {
  graph: Graph;
  settings: MapSettings;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const select = useRef(onSelect);
  select.current = onSelect;

  const located = useMemo(
    () => graph.concepts.filter((c) => c.geo && matchesFilter(c, { kinds: s.kinds, tags: s.tags })),
    [graph, s],
  );
  const byId = useMemo(() => new Map(graph.concepts.map((c) => [c.id, c])), [graph]);

  // Regions: places that other Concepts sit inside. They label the map.
  const regions = useMemo(
    () => new Set(graph.relationships.filter((r) => r.type === "located-in").map((r) => r.to)),
    [graph],
  );

  const features = (dimmed?: Set<string>) => {
    const points = located.filter((c) => !regions.has(c.id) && c.id !== s.home);
    const colorOf = (c: Concept) => {
      const v = s.colorBy ? c.attributes?.[s.colorBy] : undefined;
      return v !== undefined ? standingColor[String(v)] ?? "#57534e" : otherColor;
    };
    const pt = (c: Concept, extra: Record<string, unknown> = {}) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [c.geo![1], c.geo![0]] },
      properties: { id: c.id, title: shortTitle(c.title), color: colorOf(c), dim: dimmed ? !dimmed.has(c.id) : false, ...extra },
    });
    const lines = graph.relationships
      .filter((r) => s.relationshipTypes?.includes(r.type) && byId.get(r.from)?.geo && byId.get(r.to)?.geo)
      .map((r) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: [r.from, r.to].map((id) => [byId.get(id)!.geo![1], byId.get(id)!.geo![0]]) },
        properties: {},
      }));
    const isChosen = (c: Concept) => c.attributes?.[s.colorBy ?? ""] === "chosen";
    return {
      // The chosen option never hides inside a cluster.
      points: { type: "FeatureCollection" as const, features: points.filter((c) => !isChosen(c)).map((c) => pt(c)) },
      chosen: { type: "FeatureCollection" as const, features: points.filter(isChosen).map((c) => pt(c)) },
      regions: { type: "FeatureCollection" as const, features: located.filter((c) => regions.has(c.id)).map((c) => pt(c)) },
      home: { type: "FeatureCollection" as const, features: located.filter((c) => c.id === s.home).map((c) => pt(c, { title: `Home · ${shortTitle(c.title)}` })) },
      lines: { type: "FeatureCollection" as const, features: lines },
    };
  };

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("error", (e: ErrorEvent) => {
      if (/tile|style|Failed to fetch/i.test(String(e.error?.message))) setTilesFailed(true);
    });
    const bounds = new maplibregl.LngLatBounds();
    for (const c of located) bounds.extend([c.geo![1], c.geo![0]]);
    m.fitBounds(bounds, { padding: 60, duration: 0 });

    m.on("load", () => {
      const f = features();
      m.addSource("lines", { type: "geojson", data: f.lines });
      m.addSource("regions", { type: "geojson", data: f.regions });
      m.addSource("home", { type: "geojson", data: f.home });
      m.addSource("points", { type: "geojson", data: f.points, cluster: true, clusterRadius: 36, clusterMaxZoom: 8 });
      m.addSource("chosen", { type: "geojson", data: f.chosen });

      m.addLayer({ id: "lines", type: "line", source: "lines", paint: { "line-color": otherColor, "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.7 } });
      m.addLayer({
        id: "regions", type: "symbol", source: "regions",
        layout: { "text-field": ["upcase", ["get", "title"]], "text-font": BOLD, "text-size": 12, "text-letter-spacing": 0.15, "text-max-width": 8 },
        paint: { "text-color": "#57534e", "text-opacity": 0.55, "text-halo-color": "#fff", "text-halo-width": 1.5 },
      });
      m.addLayer({ id: "home", type: "circle", source: "home", paint: { "circle-radius": 8, "circle-color": "#1c1917", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
      m.addLayer({
        id: "home-label", type: "symbol", source: "home",
        layout: { "text-field": ["get", "title"], "text-font": BOLD, "text-size": 13, "text-offset": [0, 1.4], "text-anchor": "top" },
        paint: { "text-color": "#1c1917", "text-halo-color": "#fff", "text-halo-width": 2 },
      });
      m.addLayer({
        id: "clusters", type: "circle", source: "points", filter: ["has", "point_count"],
        paint: { "circle-color": "#44403c", "circle-radius": ["step", ["get", "point_count"], 14, 5, 18, 10, 22], "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-opacity": 0.85 },
      });
      m.addLayer({
        id: "cluster-count", type: "symbol", source: "points", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": BOLD, "text-size": 12 },
        paint: { "text-color": "#fff" },
      });
      m.addLayer({
        id: "points", type: "circle", source: "points", filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": 7,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
          "circle-opacity": ["case", ["get", "dim"], 0.15, 1],
          "circle-stroke-opacity": ["case", ["get", "dim"], 0.15, 1],
        },
      });
      m.addLayer({
        id: "labels", type: "symbol", source: "points", filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "title"], "text-font": FONT, "text-size": 12, "text-max-width": 10,
          "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.9, "text-justify": "auto",
        },
        paint: { "text-color": "#292524", "text-halo-color": "#fff", "text-halo-width": 1.6, "text-opacity": ["case", ["get", "dim"], 0.15, 1] },
      });
      m.addLayer({
        id: "chosen", type: "circle", source: "chosen",
        paint: { "circle-color": ["get", "color"], "circle-radius": 11, "circle-stroke-color": "#064e3b", "circle-stroke-width": 3,
          "circle-opacity": ["case", ["get", "dim"], 0.15, 1] },
      });
      m.addLayer({
        id: "chosen-label", type: "symbol", source: "chosen",
        layout: { "text-field": ["get", "title"], "text-font": BOLD, "text-size": 14, "text-offset": [0, 1.3], "text-anchor": "top", "text-allow-overlap": true },
        paint: { "text-color": "#064e3b", "text-halo-color": "#fff", "text-halo-width": 2 },
      });

      m.on("click", "clusters", async (e: MapLayerMouseEvent) => {
        const feature = e.features![0] as MapGeoJSONFeature;
        const zoom = await (m.getSource("points") as GeoJSONSource).getClusterExpansionZoom(feature.properties.cluster_id);
        m.easeTo({ center: (feature.geometry as { coordinates: [number, number] }).coordinates, zoom: zoom + 0.5 });
      });
      for (const layer of ["points", "chosen", "home"]) {
        m.on("click", layer, (e: MapLayerMouseEvent) => select.current(String(e.features![0].properties.id)));
        m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
      }
      m.on("mouseenter", "clusters", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "clusters", () => (m.getCanvas().style.cursor = ""));
      setReady(true);
    });
    return () => {
      m.remove();
      map.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located]);

  // Search dims markers.
  useEffect(() => {
    if (!ready) return;
    const f = features(matches);
    (map.current!.getSource("points") as GeoJSONSource).setData(f.points);
    (map.current!.getSource("chosen") as GeoJSONSource).setData(f.chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, ready]);

  // Selecting anywhere pans to the Concept and opens its popup.
  useEffect(() => {
    const m = map.current;
    const c = selected ? byId.get(selected) : undefined;
    if (!ready || !m || !c?.geo || !located.includes(c)) return;
    m.flyTo({ center: [c.geo[1], c.geo[0]], zoom: Math.max(m.getZoom(), 10), duration: 800 });
    const popup = new maplibregl.Popup({ offset: 14, closeButton: false, maxWidth: "280px" })
      .setLngLat([c.geo[1], c.geo[0]])
      .setHTML(popupHtml(graph, c, s))
      .addTo(m);
    return () => void popup.remove();
  }, [selected, ready, byId, located, graph, s]);

  return (
    <div className="relative h-full">
      <div ref={el} className="h-full w-full" />
      <div className="absolute bottom-6 left-3 rounded-lg bg-white/95 p-3 text-xs shadow ring-1 ring-stone-200">
        {Object.entries(standingColor).map(([k, c]) => (
          <div key={k} className="flex items-center gap-2 py-0.5">
            <span className="inline-block size-3 rounded-full ring-2 ring-white" style={{ background: c }} /> {k.replace("-", " ")}
          </div>
        ))}
        <div className="flex items-center gap-2 py-0.5">
          <span className="inline-block size-3 rounded-full ring-2 ring-white" style={{ background: otherColor }} /> day trip
        </div>
        <div className="flex items-center gap-2 py-0.5">
          <span className="inline-block size-3 rounded-full bg-stone-900 ring-2 ring-white" /> home
        </div>
      </div>
      {tilesFailed && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-amber-100 px-3 py-1.5 text-xs text-amber-900 shadow">
          Basemap tiles couldn't load (offline?). Markers still work.
        </div>
      )}
    </div>
  );
}

// "the chosen resort (its town, state)" → "the chosen resort": the
// map already says where it is.
const shortTitle = (t: string) => t.replace(/\s*\([^)]*\)\s*$/, "");

function popupHtml(graph: Graph, c: Concept, s: MapSettings) {
  const attrs = new Map((graph.attributes ?? []).map((a) => [a.id, a]));
  const rows = Object.entries(c.attributes ?? {})
    .filter(([k]) => ["price", "drive", "nights", "status", s.colorBy].includes(k))
    .map(([k, v]) => {
      const def = attrs.get(k);
      const val = def?.type === "money" && typeof v === "number" ? `$${v.toLocaleString()}` : `${v}${def?.unit ? ` ${def.unit}` : ""}`;
      return `<div style="display:flex;gap:8px"><span style="color:#78716c">${esc(def?.label ?? k)}</span><span style="margin-left:auto;font-weight:500">${esc(val)}</span></div>`;
    })
    .join("");
  return `<div style="font:13px system-ui"><div style="font-weight:600;margin-bottom:2px">${esc(c.title)}</div>${
    c.summary ? `<div style="color:#57534e;margin-bottom:6px">${esc(c.summary)}</div>` : ""
  }${rows}</div>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
