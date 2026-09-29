// The Quadrant View's grid (docs/view-types/quadrant.md), as a pure function:
// Concepts placed by two enum Attributes, one per axis, in the enum's value
// order. With `progression`, the x axis is a ladder of stages. `evidence`
// Relationships (model `uses` technique) are counted on each card.
import type { ViewOverrides } from "@umbel/domain";
import type { AttributeDef, Concept, Expedition, QuadrantSettings } from "../model.ts";

export type QuadrantViewSettings = QuadrantSettings & ViewOverrides;

export type QuadrantAxis = {
  attribute: string;
  label: string;
  /** The enum's values in order, then any other value the Concepts hold. */
  values: { value: string; label: string; count: number }[];
};

export type QuadrantCard = {
  concept: Concept;
  /** What uses it, by the `evidence` Relationship Types (their titles). */
  usedBy: string[];
};

export type QuadrantModel = {
  x: QuadrantAxis;
  y: QuadrantAxis;
  /** `cells[yi][xi]`: most used first, then by title. */
  cells: QuadrantCard[][][];
  /** How many Concepts are placed. */
  placed: number;
  progression: boolean;
};

export function quadrantGrid(expedition: Expedition, settings: QuadrantViewSettings): QuadrantModel {
  const hidden = new Set(settings.hide ?? []);
  const attrs = new Map((expedition.attributes ?? []).map((a) => [a.id, a]));
  const value = (c: Concept, attr: string) => {
    const v = c.attributes?.[attr];
    return v === undefined || v === null || v === "" ? undefined : String(v);
  };
  const items = expedition.concepts.filter(
    (c) =>
      !hidden.has(c.id) &&
      (!settings.tags?.length || (c.tags ?? []).some((t) => settings.tags!.includes(t))) &&
      value(c, settings.x) !== undefined &&
      value(c, settings.y) !== undefined,
  );
  const x = axis(settings.x, attrs.get(settings.x), items.map((c) => value(c, settings.x)!));
  const y = axis(settings.y, attrs.get(settings.y), items.map((c) => value(c, settings.y)!));

  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const evidence = new Set(settings.evidence ?? []);
  const usedBy = new Map<string, string[]>();
  for (const r of expedition.relationships) {
    const from = byId.get(r.from);
    if (!evidence.has(r.type) || !from || hidden.has(r.from)) continue;
    if (!usedBy.has(r.to)) usedBy.set(r.to, []);
    usedBy.get(r.to)!.push(from.title);
  }

  const xi = new Map(x.values.map((v, i) => [v.value, i]));
  const yi = new Map(y.values.map((v, i) => [v.value, i]));
  const cells: QuadrantCard[][][] = y.values.map(() => x.values.map(() => []));
  for (const c of items) {
    const users = [...new Set(usedBy.get(c.id) ?? [])].sort(byText);
    cells[yi.get(value(c, settings.y)!)!]![xi.get(value(c, settings.x)!)!]!.push({ concept: c, usedBy: users });
  }
  for (const row of cells)
    for (const cell of row)
      cell.sort((a, b) => b.usedBy.length - a.usedBy.length || byText(a.concept.title, b.concept.title) || byText(a.concept.id, b.concept.id));
  return { x, y, cells, placed: items.length, progression: settings.progression === true };
}

function axis(attribute: string, def: AttributeDef | undefined, held: string[]): QuadrantAxis {
  const counts = new Map<string, number>();
  for (const v of held) counts.set(v, (counts.get(v) ?? 0) + 1);
  const known = def?.values ?? [];
  const extra = [...counts.keys()].filter((v) => !known.includes(v)).sort(byText);
  return {
    attribute,
    label: def?.label ?? attribute,
    values: [...known, ...extra].map((v) => ({ value: v, label: capitalize(v), count: counts.get(v) ?? 0 })),
  };
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
