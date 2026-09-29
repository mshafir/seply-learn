// The Rates & estimates View (docs/view-types/rates.md), as pure functions:
// every per-year rate on one log scale, grouped by the quantity it measures.
// A fall is drawn as 1/rate, so falls sit left of 1× and rises right of it.
// Each estimate carries its source (the `sourceRelationship`) and how
// independent that source is.
import type { ViewOverrides } from "@umbel/domain";
import type { Concept, Expedition, RatesSettings } from "../model.ts";

export type RatesViewSettings = RatesSettings & ViewOverrides;

export type RateEstimate = {
  concept: Concept;
  /** The range on the axis, as multipliers per year (a fall is below 1): lo ≤ hi. */
  lo: number;
  hi: number;
  direction: "rise" | "fall";
  method?: string;
  source?: Concept;
  /** The source's independence (independent, academic, analyst, interested, self-reported …). */
  independence?: string;
};

export type RatesModel = {
  groups: { quantity: string; estimates: RateEstimate[] }[];
  axis: LogAxis;
  /** The independence values, in the Attribute's order: the legend. */
  independence: string[];
};

export function ratesModel(expedition: Expedition, settings: RatesViewSettings): RatesModel {
  const hidden = new Set(settings.hide ?? []);
  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const sourceOf = new Map<string, Concept>();
  if (settings.sourceRelationship)
    for (const r of expedition.relationships) {
      const to = byId.get(r.to);
      if (r.type === settings.sourceRelationship && to && !hidden.has(to.id) && !sourceOf.has(r.from)) sourceOf.set(r.from, to);
    }
  const text = (c: Concept | undefined, attr: string | undefined) => {
    const v = attr ? c?.attributes?.[attr] : undefined;
    return v === undefined || v === null || v === "" ? undefined : String(v);
  };

  const groups = new Map<string, RateEstimate[]>();
  for (const c of expedition.concepts) {
    if (hidden.has(c.id)) continue;
    const quantity = text(c, settings.group);
    const low = Number(c.attributes?.[settings.low]);
    const highRaw = c.attributes?.[settings.high];
    const high = highRaw === undefined || highRaw === "" ? low : Number(highRaw);
    if (quantity === undefined || !(low > 0) || !(high > 0)) continue;
    const direction = text(c, settings.direction) === "fall" ? "fall" : "rise";
    const [a, b] = direction === "fall" ? [1 / low, 1 / high] : [low, high];
    const source = sourceOf.get(c.id);
    const estimate: RateEstimate = { concept: c, lo: Math.min(a, b), hi: Math.max(a, b), direction };
    const method = text(c, settings.method);
    if (method) estimate.method = method;
    if (source) estimate.source = source;
    const independence = text(source, settings.independence);
    if (independence) estimate.independence = independence;
    if (!groups.has(quantity)) groups.set(quantity, []);
    groups.get(quantity)!.push(estimate);
  }

  const all = [...groups.values()].flat();
  const def = expedition.attributes?.find((a) => a.id === settings.independence);
  const held = new Set(all.map((e) => e.independence).filter((v): v is string => !!v));
  const independence = [...(def?.values ?? []).filter((v) => held.has(v)), ...[...held].filter((v) => !def?.values?.includes(v)).sort()];
  return {
    groups: [...groups].map(([quantity, estimates]) => ({ quantity, estimates })),
    axis: logAxis(all.flatMap((e) => [e.lo, e.hi])),
    independence,
  };
}

export type LogAxis = {
  /** The ends of the axis: whole decades that hold every value, and 1×. */
  min: number;
  max: number;
  /** Where a value sits along the axis, 0 (min) to 1 (max). Values outside are clamped. */
  at: (value: number) => number;
  ticks: { value: number; label: string }[];
};

/**
 * A log axis for multipliers: from the decade below the smallest value to
 * the decade above the largest (strictly, so no value sits on an end),
 * always including 1× (no change). Ticks at
 * every decade, plus ×3 and ÷3 when the axis spans at most four decades.
 */
export function logAxis(values: number[]): LogAxis {
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  // Room past the extremes: a value on a decade gets the next one out, so no mark sits on the edge.
  const lo = Math.ceil(Math.log10(Math.min(1, ...finite)) - 1e-9) - 1;
  const hi = Math.floor(Math.log10(Math.max(1, ...finite)) + 1e-9) + 1;
  const span = hi - lo;
  const at = (v: number) => Math.min(1, Math.max(0, (Math.log10(v) - lo) / span));
  const ticks: LogAxis["ticks"] = [];
  for (let d = lo; d <= hi; d++) {
    ticks.push({ value: 10 ** d, label: rateLabel(10 ** d) });
    if (span <= 4 && d < hi) {
      const v = d < 0 ? 10 ** (d + 1) / 3 : 3 * 10 ** d;
      ticks.push({ value: v, label: rateLabel(v) });
    }
  }
  return { min: 10 ** lo, max: 10 ** hi, at, ticks };
}

/** A multiplier as a reader says it: "3×", "1,000×", "1×", "÷10". */
export function rateLabel(v: number): string {
  const n = (x: number) => (x >= 10 ? Math.round(x) : Math.round(x * 100) / 100).toLocaleString("en");
  return v >= 1 ? `${n(v)}×` : `÷${n(1 / v)}`;
}
