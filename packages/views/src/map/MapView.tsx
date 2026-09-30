// The Map View (docs/view-types/map.md): located Concepts as pins on a real,
// zoomable map, with MapLibre GL.
//
// - Basemap: our PMTiles with the Protomaps flavour for the theme, or the
//   fallback style URL when no tiles are configured (basemap.ts). The
//   bundled coarse world always draws underneath; when detailed tiles or the
//   fallback style can't load, it shows alone with a quiet note.
// - Theme: follows the nearest .dark/.light (as the canvas does) and swaps
//   the style with `setStyle`. Pins are HTML Markers, drawn by React through
//   portals, so they survive the swap.
// - Clicking a pin selects its Concept; selecting one elsewhere pans to it
//   when it's out of view. `matches` dims the rest; `covered` checks read ones.
import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { House } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import type { Expedition, View } from "../model.ts";
import type { ViewInteraction } from "../ExpeditionView.tsx";
import { useInheritedColorMode } from "../canvas/colorMode.ts";
import { KindIcon } from "../canvas/KindIcon.tsx";
import { ReadCheck, cx } from "../canvas/parts.tsx";
import {
  fallbackStyleUrl,
  isDetailSource,
  protomapsStyle,
  withCoarseWorld,
  type BasemapConfig,
  type CoarseColors,
  type MapTheme,
} from "./basemap.ts";
import { mapModel, placeLabels, type Pin } from "./pins.ts";
import { coarseWorld } from "./world.ts";

export type MapViewProps = ViewInteraction & {
  expedition: Expedition;
  view: View;
};

let protocolAdded = false;
function addPmtilesProtocol() {
  if (protocolAdded) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocolAdded = true;
}

export function MapView({ expedition, view, selected, onSelect, matches, covered, onSettled, transitionMs, basemap }: MapViewProps) {
  const model = useMemo(() => mapModel(expedition, view), [expedition, view]);
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const theme = useInheritedColorMode(frame);
  const [map, setMap] = useState<maplibregl.Map>();
  const [unavailable, setUnavailable] = useState(false);
  const [labels, setLabels] = useState<ReadonlyMap<string, "right" | "left">>(new Map());
  // Each pin's Marker element, made on first render and kept by Concept id;
  // React draws the pin into it through a portal.
  const [anchors] = useState(() => new Map<string, HTMLElement>());
  const anchorFor = (id: string) => {
    let el = anchors.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "seply-pin-anchor";
      anchors.set(id, el);
    }
    return el;
  };
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const drawn = useRef(false);
  const settled = useEffectEvent(() => {
    if (drawn.current) return;
    drawn.current = true;
    onSettled?.();
  });
  const select = useEffectEvent((id?: string) => onSelect(id));
  // The config's content, not its identity, decides the style.
  const configKey = JSON.stringify(basemap ?? {});
  const config = useMemo(() => JSON.parse(configKey) as BasemapConfig, [configKey]);

  // One map per View, opened on its pins; the style follows the theme.
  useEffect(() => {
    addPmtilesProtocol();
    const m = new maplibregl.Map({
      container: host.current!,
      style: withCoarseWorld(undefined, coarseWorld(), coarseColors(frame.current!)),
      ...initialView(model.bounds),
      attributionControl: { compact: false },
      fadeDuration: 0,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("error", (e: { sourceId?: string; error?: Error }) => {
      if (isDetailSource(e.sourceId)) setUnavailable(true);
    });
    m.on("click", () => select(undefined));
    setMap(m);
    const own = markers.current;
    return () => {
      for (const marker of own.values()) marker.remove();
      own.clear();
      m.remove();
      setMap(undefined);
    };
    // The bounds are only the opening viewport; later data doesn't refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;
    let live = true;
    styleFor(config, theme).then(({ base, failed }) => {
      if (!live) return;
      setUnavailable(failed);
      map.setStyle(withCoarseWorld(base, coarseWorld(), coarseColors(frame.current!)), { diff: true });
      // Drawn once the first real style has loaded what it can.
      map.once("idle", () => settled());
    });
    return () => {
      live = false;
    };
  }, [map, config, theme]);

  // Pins: one HTML Marker each, kept by Concept id across data changes.
  useEffect(() => {
    if (!map) return;
    const own = markers.current;
    const ids = new Set(model.pins.map((p) => p.conceptId));
    for (const [id, marker] of own) {
      if (!ids.has(id)) {
        marker.remove();
        own.delete(id);
      }
    }
    for (const p of model.pins) {
      const had = own.get(p.conceptId);
      if (had) had.setLngLat([p.lon, p.lat]);
      else {
        const el = anchors.get(p.conceptId);
        if (el) own.set(p.conceptId, new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(map));
      }
    }
  }, [map, model, anchors]);

  // Labels that would overlap an earlier one are hidden (the pin stays).
  useEffect(() => {
    if (!map) return;
    const place = () => {
      const points = model.pins.map((p) => ({ ...map.project([p.lon, p.lat]), pin: p }));
      setLabels(placeLabels(points, selected));
    };
    const first = requestAnimationFrame(place);
    map.on("moveend", place);
    map.on("resize", place);
    return () => {
      cancelAnimationFrame(first);
      map.off("moveend", place);
      map.off("resize", place);
    };
  }, [map, model, selected]);

  // Selecting a Concept elsewhere pans to it when it's out of view.
  useEffect(() => {
    const p = model.pins.find((x) => x.conceptId === selected);
    if (!map || !p) return;
    const at = map.project([p.lon, p.lat]);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (at.x < 40 || at.y < 40 || at.x > w - 40 || at.y > h - 40)
      map.easeTo({ center: [p.lon, p.lat], duration: transitionMs ?? 500 });
    // Only a new selection pans, not new data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selected]);

  return (
    <div className="seply-map" ref={frame} data-testid="map">
      <div className="seply-map__canvas" ref={host} />
      {model.pins.map((p) =>
        createPortal(
          <MapPin
            pin={p}
            selected={p.conceptId === selected}
            dim={!!matches && !matches.has(p.conceptId)}
            read={!!covered?.has(p.conceptId)}
            label={labels.get(p.conceptId)}
            onSelect={onSelect}
          />,
          anchorFor(p.conceptId),
          p.conceptId,
        ),
      )}
      <div className="seply-map__notes">
        {unavailable && (
          <p className="seply-map__note" role="status" data-testid="map-note">
            Detailed map unavailable: showing the coarse world map.
          </p>
        )}
        {model.unplaced.length > 0 && (
          <p className="seply-map__note">
            {model.unplaced.length} {model.unplaced.length === 1 ? "Concept has" : "Concepts have"} no location and{" "}
            {model.unplaced.length === 1 ? "isn't" : "aren't"} shown.
          </p>
        )}
      </div>
    </div>
  );
}

function MapPin({
  pin,
  selected,
  dim,
  read,
  label,
  onSelect,
}: {
  pin: Pin;
  selected: boolean;
  dim: boolean;
  read: boolean;
  /** Where the label goes; undefined: shown only on hover (it would overlap). */
  label?: "right" | "left";
  onSelect: (id?: string) => void;
}) {
  return (
    <button
      type="button"
      className={cx(
        "seply-pin",
        pin.home && "seply-pin--home",
        selected && "seply-pin--selected",
        dim && "seply-pin--dim",
        !label && !selected && "seply-pin--quiet",
        label === "left" && "seply-pin--left",
      )}
      style={{ "--seply-pin-color": pin.color } as CSSProperties}
      data-concept-id={pin.conceptId}
      data-covered={read || undefined}
      aria-label={pin.title}
      aria-pressed={selected}
      title={pin.home ? `${pin.title} (home)` : pin.title}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(pin.conceptId);
      }}
    >
      <span className="seply-pin__dot">
        {pin.home ? <House className="seply-pin__icon" aria-hidden /> : <KindIcon name={pin.icon ?? pin.kind} className="seply-pin__icon" />}
      </span>
      <span className="seply-pin__label">
        {read && <ReadCheck />}
        {pin.title}
      </span>
    </button>
  );
}

function initialView(bounds?: [number, number, number, number]) {
  if (!bounds) return { center: [0, 20] as [number, number], zoom: 1 };
  const [w, s, e, n] = bounds;
  if (w === e && s === n) return { center: [w, s] as [number, number], zoom: 10 };
  return { bounds, fitBoundsOptions: { padding: 72, maxZoom: 11 } };
}

/** The basemap for a theme: our PMTiles, else the fallback style (fetched; undefined if it can't load). */
async function styleFor(config: BasemapConfig, theme: MapTheme): Promise<{ base?: StyleSpecification; failed: boolean }> {
  if (config.tiles) return { base: protomapsStyle({ ...config, tiles: absolute(config.tiles) }, theme), failed: false };
  const url = fallbackStyleUrl(config, theme)!;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    return { base: (await res.json()) as StyleSpecification, failed: false };
  } catch {
    return { failed: true };
  }
}

/** PMTiles fetches the archive by URL, so a path on the app's origin is made absolute. */
const absolute = (url: string) => (/^[a-z]+:/i.test(url) ? url : new URL(url, location.href).href);

/**
 * The coarse layer's colours: tokens, via the --seply-map-* variables on the
 * View (map.css), resolved to rgb for MapLibre, which can't read CSS
 * variables or oklch. Read again on every style change, so they follow the theme.
 */
function coarseColors(el: HTMLElement): CoarseColors {
  const css = getComputedStyle(el);
  const read = (name: string) => toRgb(css.getPropertyValue(name).trim());
  return { water: read("--seply-map-water"), land: read("--seply-map-land"), border: read("--seply-map-border") };
}

let paint: CanvasRenderingContext2D | null | undefined;
function toRgb(color: string): string {
  paint ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!paint || !color) return "rgba(0, 0, 0, 0)";
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = color;
  paint.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}
