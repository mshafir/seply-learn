// Anatomy (docs/view-types/anatomy.md): the subject as nested parts, with the
// Concepts that change each part pinned onto it. Containment is drawn as
// boxes inside boxes, never as edges, so there are no positions at all: the
// renderer nests HTML boxes. Pure: no React, no DOM.
import type { AnatomySettings, Concept, Expedition } from "../model.ts";

/** The per-View structure overrides an Anatomy's shared settings may carry (spec §4.2). */
type Overrides = {
  /** This View's parent for a Concept, instead of its containment parent. */
  placement?: Record<string, string>;
  /** This View's order for a parent's parts (ids first, in this order). */
  order?: Record<string, string[]>;
  /** Concepts the curator left out of this View. */
  hide?: string[];
};

export type AnatomyPart = {
  concept: Concept;
  depth: number;
  /** Concepts pinned on this part (the pin Relationship Types point at it). */
  pins: Concept[];
  parts: AnatomyPart[];
};

export type AnatomyModel = {
  roots: AnatomyPart[];
  /** Every part's id, depth first. */
  partIds: string[];
  /** The colour Attribute's values, least to most (its enum order), when it has them. */
  legend?: { label: string; values: string[] };
  /** A pin's place in the legend (0-based), or undefined when it has no value. */
  tone: (pin: Concept) => number | undefined;
  /** Pins whose part isn't drawn (a technique with no part: a missing part, the doc says). */
  unplaced: Concept[];
};

/** Nested parts from the roots down, with their pins. Order: the View's `order`, then the Expedition's. */
export function anatomy(expedition: Expedition, settings: AnatomySettings): AnatomyModel {
  const s = settings as AnatomySettings & Overrides;
  const hidden = new Set(s.hide ?? []);
  const byId = new Map(expedition.concepts.filter((c) => !hidden.has(c.id)).map((c) => [c.id, c]));
  const index = new Map(expedition.concepts.map((c, i) => [c.id, i]));
  const containment = new Set(s.containment);
  const pinTypes = new Set(s.pins);
  const isPin = new Set(expedition.relationships.filter((r) => pinTypes.has(r.type)).map((r) => r.from));

  // Each part's parent: the View's placement, else its first containment parent.
  const parentOf = new Map<string, string>();
  for (const r of expedition.relationships)
    if (containment.has(r.type) && byId.has(r.from) && byId.has(r.to) && !isPin.has(r.from) && !parentOf.has(r.from))
      parentOf.set(r.from, r.to);
  for (const [id, parent] of Object.entries(s.placement ?? {})) if (byId.has(id) && byId.has(parent)) parentOf.set(id, parent);
  const children = new Map<string, string[]>();
  for (const [id, parent] of parentOf) children.set(parent, [...(children.get(parent) ?? []), id]);

  const ordered = (parent: string, ids: string[]) => {
    const want = new Map((s.order?.[parent] ?? []).map((id, i) => [id, i]));
    const rank = (id: string) => want.get(id) ?? want.size + index.get(id)!;
    return [...ids].sort((a, b) => rank(a) - rank(b));
  };
  const pinsOn = (id: string) =>
    ordered(
      id,
      [
        ...new Set(expedition.relationships.filter((r) => pinTypes.has(r.type) && r.to === id && byId.has(r.from)).map((r) => r.from)),
      ],
    ).map((p) => byId.get(p)!);

  const partIds: string[] = [];
  const seen = new Set<string>();
  const build = (id: string, depth: number): AnatomyPart | undefined => {
    const concept = byId.get(id);
    if (!concept || seen.has(id)) return undefined;
    seen.add(id);
    partIds.push(id);
    const parts = ordered(id, children.get(id) ?? [])
      .map((k) => build(k, depth + 1))
      .filter((p): p is AnatomyPart => !!p);
    return { concept, depth, pins: pinsOn(id), parts };
  };
  const roots = s.roots.map((id) => build(id, 0)).filter((p): p is AnatomyPart => !!p);

  const drawn = new Set(partIds);
  const unplaced = [...isPin]
    .filter((id) => byId.has(id) && !expedition.relationships.some((r) => pinTypes.has(r.type) && r.from === id && drawn.has(r.to)))
    .map((id) => byId.get(id)!)
    .sort((a, b) => index.get(a.id)! - index.get(b.id)!);

  const def = (expedition.attributes ?? []).find((a) => a.id === s.colorBy);
  const values = def?.values;
  const tone = (pin: Concept) => {
    const v = s.colorBy ? pin.attributes?.[s.colorBy] : undefined;
    const i = v === undefined || !values ? -1 : values.indexOf(String(v));
    return i >= 0 ? i : undefined;
  };
  return { roots, partIds, legend: def && values?.length ? { label: def.label, values } : undefined, tone, unplaced };
}

/**
 * Search in an Anatomy: a part stays lit while it, one of its pins, or
 * anything inside it matches; pins dim on their own.
 */
export function litParts(roots: AnatomyPart[], matches: Set<string>): Set<string> {
  const lit = new Set<string>();
  const visit = (p: AnatomyPart): boolean => {
    const inside = p.parts.map(visit).some(Boolean);
    const on = inside || matches.has(p.concept.id) || p.pins.some((c) => matches.has(c.id));
    if (on) lit.add(p.concept.id);
    return on;
  };
  roots.forEach(visit);
  return lit;
}

/** What an Anatomy draws, for the PR and the curator: parts, pins, depth, pins with no part. */
export function anatomyStats(model: AnatomyModel) {
  let pins = 0;
  let depth = 0;
  let busiest: { title: string; pins: number } | undefined;
  const visit = (p: AnatomyPart) => {
    pins += p.pins.length;
    depth = Math.max(depth, p.depth + 1);
    if (!busiest || p.pins.length > busiest.pins) busiest = { title: p.concept.title, pins: p.pins.length };
    p.parts.forEach(visit);
  };
  model.roots.forEach(visit);
  return { parts: model.partIds.length, pins, depth, unplaced: model.unplaced.length, busiest };
}

/** One line, like `formatLayoutMetrics`: an Anatomy has no lines to measure, so it counts what it holds. */
export function formatAnatomyStats(label: string, s: ReturnType<typeof anatomyStats>): string {
  return (
    `${label} (anatomy): ${s.parts} parts, ${s.pins} pins, ${s.depth} levels deep, ${s.unplaced} pins not on a part` +
    (s.busiest ? `; most pins: ${s.busiest.title} (${s.busiest.pins})` : "")
  );
}
