// What a Map View places, as a pure function (docs/view-types/map.md):
// located Concepts as pins, anchored on the View's home. No MapLibre here.
import type { Concept, Expedition, MapSettings, View } from "../model.ts";
import { matchesFilter } from "../scope.ts";
import { paletteColor } from "../canvas/color.ts";

export type Pin = {
  conceptId: string;
  title: string;
  kind: string;
  kindLabel?: string;
  /** The Kind's icon name. */
  icon?: string;
  /** The Kind's colour, as CSS (`var(--kind-*)`). */
  color?: string;
  lat: number;
  lon: number;
  /** The View's home or origin. */
  home: boolean;
  /** Placed at the Concept it is `located-in`, having no coordinates of its own. */
  via?: string;
};

export type MapModel = {
  pins: Pin[];
  /** Concepts in scope with no location of their own or through `located-in`. */
  unplaced: string[];
  /** [west, south, east, north] around every pin; undefined with no pins. */
  bounds?: [number, number, number, number];
};

const LOCATED_IN = new Set(["builtin:located-in", "located-in"]);

/**
 * The pins of a Map View: every Concept its Kind and Tag filters let in that
 * has coordinates, or sits `located-in` one that does (it takes that place).
 * Containment is shown by position, so no `located-in` lines are drawn. The
 * home Concept is always pinned.
 */
export function mapModel(expedition: Expedition, view: View): MapModel {
  const settings = (view.viewType === "map" ? view.settings : {}) as MapSettings & { hide?: string[] };
  const hidden = new Set(settings.hide ?? []);
  const kinds = new Map(expedition.kinds.map((k) => [k.id, k]));
  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const container = new Map<string, string>();
  for (const r of expedition.relationships) if (LOCATED_IN.has(r.type) && !container.has(r.from)) container.set(r.from, r.to);

  const locate = (c: Concept): { at: [number, number]; via?: string } | undefined => {
    if (c.geo) return { at: c.geo };
    // Walk up located-in (guarding against cycles) to the first located Concept.
    const seen = new Set([c.id]);
    for (let up = container.get(c.id); up && !seen.has(up); up = container.get(up)) {
      seen.add(up);
      const g = byId.get(up)?.geo;
      if (g) return { at: g, via: up };
    }
    return undefined;
  };

  const inScope = (c: Concept) =>
    c.id === settings.home || (!hidden.has(c.id) && matchesFilter(c, { kinds: settings.kinds, tags: settings.tags }));

  const pins: Pin[] = [];
  const unplaced: string[] = [];
  for (const c of expedition.concepts) {
    if (!inScope(c)) continue;
    const where = locate(c);
    if (!where) {
      unplaced.push(c.id);
      continue;
    }
    const kind = kinds.get(c.kind);
    pins.push({
      conceptId: c.id,
      title: c.title,
      kind: c.kind,
      kindLabel: kind?.label,
      icon: kind?.icon,
      color: paletteColor(kind?.color),
      lat: where.at[0],
      lon: where.at[1],
      home: c.id === settings.home,
      ...(where.via ? { via: where.via } : {}),
    });
  }
  // A reader's order (by title, then id), so the same data always draws alike.
  pins.sort((a, b) => a.title.localeCompare(b.title) || (a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0));

  return { pins, unplaced, bounds: boundsOf(pins) };
}

function boundsOf(pins: Pin[]): MapModel["bounds"] {
  if (!pins.length) return undefined;
  const lons = pins.map((p) => p.lon);
  const lats = pins.map((p) => p.lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** A pin's label box, relative to the pin's centre on screen (map.css draws it there). */
export const LABEL = { dx: 12, height: 20, charWidth: 6.6, padding: 12 };

/**
 * Where each pin's label goes on screen: right of the pin, else left of it.
 * The home and the selected pin are placed first, then the rest in order; a
 * label that would overlap a placed one (or any pin) on both sides is left
 * off. Pins are never hidden, only labels.
 */
export function placeLabels(points: { x: number; y: number; pin: Pin }[], selected?: string): Map<string, "right" | "left"> {
  type Box = { x0: number; y0: number; x1: number; y1: number; owner: string };
  const rank = (p: Pin) => (p.conceptId === selected ? 0 : p.home ? 1 : 2);
  const order = [...points].sort((a, b) => rank(a.pin) - rank(b.pin));
  const taken: Box[] = points.map(({ x, y, pin }) => ({ x0: x - 9, y0: y - 9, x1: x + 9, y1: y + 9, owner: pin.conceptId }));
  const hits = (a: Box, b: Box) => a.owner !== b.owner && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const placed = new Map<string, "right" | "left">();
  for (const { x, y, pin } of order) {
    const width = pin.title.length * LABEL.charWidth + LABEL.padding;
    const y0 = y - LABEL.height / 2;
    const y1 = y + LABEL.height / 2;
    const sides = {
      right: { x0: x + LABEL.dx, x1: x + LABEL.dx + width, y0, y1, owner: pin.conceptId },
      left: { x0: x - LABEL.dx - width, x1: x - LABEL.dx, y0, y1, owner: pin.conceptId },
    };
    for (const side of ["right", "left"] as const) {
      if (taken.some((b) => hits(sides[side], b))) continue;
      taken.push(sides[side]);
      placed.set(pin.conceptId, side);
      break;
    }
  }
  return placed;
}
