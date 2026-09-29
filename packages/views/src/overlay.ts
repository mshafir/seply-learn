// What a View layers over a computed layout (hidden Concepts, the lit set,
// badges, bridges) and the pure functions that build it. No React here.
import type { Concept, Expedition, LearningPathSettings, View } from "./model.ts";
import { learningScope, leversOf, readingOrder, type LearningMap, type Scope, type Trace } from "./scope.ts";

/** Badge tones map to CSS classes `umbel-badge--<tone>` (see canvas.css). */
export type BadgeTone = "positive" | "caution" | "negative" | "neutral" | "accent";
export type Badge = { text: string; tone: BadgeTone };

/**
 * What a View layers over a fixed layout: Concepts hidden (without moving the
 * rest), the set lit up, badges, and dashed bridges standing in for a chain of
 * hidden Concepts. Changing it never re-runs the layout, except that the
 * Learning path lays out only what is visible.
 */
export type Overlay = {
  hidden: Set<string>;
  lit?: Set<string>;
  badges: Map<string, Badge[]>;
  bridges: { from: string; to: string; hops: number }[];
  fit?: string[]; // bring these into view whenever the list changes
};

const consensusTone: Record<string, BadgeTone> = { settled: "positive", emerging: "caution", contested: "negative" };

/** Badges a canvas View puts on a Concept when no overlay supplies them. */
export function badgesFor(view: View, scope: Scope, c: Concept, tr?: Trace): Badge[] {
  const out: Badge[] = [];
  if (view.viewType === "lineage" && c.date) out.push({ text: c.date.slice(0, 4), tone: "neutral" });
  const attr = (k?: string) => (k ? c.attributes?.[k] : undefined);
  if (view.viewType === "evidence") {
    const consensus = attr(view.settings.consensus);
    if (consensus) out.push({ text: String(consensus), tone: consensusTone[String(consensus)] ?? "neutral" });
    const type = attr(view.settings.evidenceType);
    if (type) out.push({ text: String(type), tone: type === "Dissent" ? "negative" : "accent" });
  }
  if (view.viewType === "cause-and-effect") {
    const rank = attr(view.settings.rankBy);
    if (rank !== undefined) out.push({ text: `#${rank}`, tone: "neutral" });
    const folded = scope.folded.get(c.id);
    if (folded) out.push({ text: `+${folded.length} build steps`, tone: "neutral" });
    const chip = actsOn(view.settings, scope, c.id);
    if (chip) out.push({ text: chip, tone: "neutral" });
    const eff = tr?.downstream.get(c.id) ?? tr?.upstream.get(c.id);
    if (tr && eff) {
      const up = tr.upstream.has(c.id);
      const word = eff.sign === "mixed" ? "mixed" : up ? `${eff.sign} it` : eff.sign === "raises" ? "▲ raised" : "▼ lowered";
      out.push({ text: word, tone: eff.sign === "raises" ? "negative" : eff.sign === "lowers" ? "positive" : "caution" });
    }
  }
  return out;
}

/**
 * Risk mode draws every lever pointing at the outcome; the "acts on …" chip
 * says what it really acts on. Undefined outside risk mode, for non-levers,
 * and for levers that act on the outcome directly.
 */
export function actsOn(s: Extract<View, { viewType: "cause-and-effect" }>["settings"], scope: Scope, id: string) {
  if (s.mode !== "risk" || !leversOf(scope, s).has(id)) return undefined;
  const outcomes = new Set(s.outcomes);
  const titles = new Map(scope.concepts.map((x) => [x.id, x.title]));
  const on = scope.relationships.filter((r) => r.from === id && !outcomes.has(r.to)).map((r) => titles.get(r.to));
  return on.length ? `acts on ${on.join(", ")}` : undefined;
}

/** Reader state a Learning path overlay depends on. */
export type LearningPathState = {
  selected?: string;
  focus?: string;
  known: Set<string>;
  showAll: boolean;
  matches?: Set<string>;
  /**
   * `known` is the reader's Reading status (read or known), drawn as a check:
   * no "known" badge, and covered Concepts aren't pulled into view.
   */
  readingStatus?: boolean;
  /** "Hide what I've read": covered Concepts are hidden (bridged over), except the selection and focus. */
  hideKnown?: boolean;
  /** Steps per target, excluding what the reader has covered (default: the map's counts). */
  targetSteps?: Map<string, number>;
};

/** The focus tree: the focused target and what it needs, minus what the reader knows. */
export function focusTree(expedition: Expedition, s: LearningPathSettings, focus: string | undefined, known: Set<string>) {
  return focus ? learningScope(expedition, s.relationshipTypes, focus, known) : undefined;
}

/**
 * Learning path overlay: core Concepts are always drawn; the steps between
 * appear when the reader picks something connected. Hidden chains are
 * bridged by dashed edges so the core stays connected.
 */
export function learningPathOverlay(map: LearningMap, tree: Scope | undefined, st: LearningPathState): Overlay {
  const { scope, targets, core } = map;
  const treeIds = new Set(tree?.concepts.map((c) => c.id));
  const around = (id?: string) =>
    id ? scope.relationships.filter((r) => r.from === id || r.to === id).flatMap((r) => [r.from, r.to]) : [];
  const visible = new Set([...core, ...treeIds, ...around(st.selected), ...around(st.focus), ...(st.readingStatus ? [] : st.known)]);
  if (st.matches) for (const id of st.matches) visible.add(id);
  const hidden = new Set(st.showAll ? [] : scope.concepts.map((c) => c.id).filter((id) => !visible.has(id)));
  if (st.hideKnown) for (const id of st.known) if (id !== st.selected && id !== st.focus) hidden.add(id);

  const bridges: Overlay["bridges"] = [];
  const direct = new Set(scope.relationships.map((r) => `${r.from}>${r.to}`));
  for (const v of visible) {
    if (hidden.has(v)) continue;
    const seen = new Set<string>();
    const walk = (at: string, hops: number) => {
      for (const r of scope.relationships) {
        if (r.from !== at || seen.has(r.to)) continue;
        seen.add(r.to);
        if (hidden.has(r.to)) walk(r.to, hops + 1);
        else if (hops > 0 && !direct.has(`${v}>${r.to}`) && !bridges.some((b) => b.from === v && b.to === r.to))
          bridges.push({ from: v, to: r.to, hops });
      }
    };
    walk(v, 0);
  }

  const badges = new Map<string, Badge[]>();
  const add = (id: string, b: Badge) => badges.set(id, [...(badges.get(id) ?? []), b]);
  if (st.focus && tree) {
    add(st.focus, { text: "goal", tone: "accent" });
    steps(tree, st.focus, st.known).forEach((id, i) => add(id, { text: `step ${i + 1}`, tone: "neutral" }));
  } else {
    for (const [id, n] of st.targetSteps ?? targets) add(id, { text: `${n} steps`, tone: "neutral" });
  }
  if (!st.readingStatus) for (const id of st.known) add(id, { text: "known", tone: "positive" });

  return { hidden, lit: st.focus ? treeIds : undefined, badges, bridges, fit: st.focus ? [...treeIds] : undefined };
}

/** Steps before a focus, in reading order, skipping what the reader knows. */
export function steps(tree: Scope, focus: string, known: Set<string>) {
  return readingOrder(tree).filter((id) => id !== focus && !known.has(id));
}
