import type {
  CauseEffectSettings,
  Concept,
  ConceptFilter,
  EvidenceSettings,
  Graph,
  LearningPathSettings,
  LineageSettings,
  Relationship,
  View,
} from "./types";

/** The part of a Graph a graph-drawn View shows. */
export type Scope = {
  concepts: Concept[];
  relationships: Relationship[];
  weights: Map<string, number>; // 0..1
  folded: Map<string, Concept[]>; // Concepts folded into another (e.g. a lever's build steps)
};

export function matchesFilter(c: Concept, f: ConceptFilter) {
  return (
    (!f.kinds || f.kinds.includes(c.kind)) &&
    (!f.tags || (c.tags ?? []).some((t) => f.tags!.includes(t))) &&
    (!f.hasAttribute || c.attributes?.[f.hasAttribute] !== undefined)
  );
}

/** Scope for the View Types drawn on the canvas (Evidence, Cause & Effect). */
export function scopeFor(graph: Graph, view: View): Scope {
  if (view.viewType === "evidence") return evidenceScope(graph, view.settings);
  if (view.viewType === "cause-and-effect") return causeEffectScope(graph, view.settings);
  if (view.viewType === "lineage") return lineageScope(graph, view.settings);
  if (view.viewType === "learning-path") return learningMap(graph, view.settings).scope;
  return { concepts: [], relationships: [], weights: new Map(), folded: new Map() };
}

// Claims are the hubs; evidence fans out from them, and evidence about the
// evidence (a sponsor behind a trial) hangs one step further out.
function evidenceScope(graph: Graph, s: EvidenceSettings): Scope {
  const types = new Set([...s.supports, ...s.challenges]);
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));
  const bearing = graph.relationships.filter((r) => types.has(r.type));
  const claims = new Set(
    bearing.filter((r) => s.claimKinds.includes(byId.get(r.to)!.kind)).map((r) => r.to),
  );
  const first = bearing.filter((r) => claims.has(r.to));
  const evidence = new Set(first.map((r) => r.from));
  const second = bearing.filter((r) => evidence.has(r.to) && !claims.has(r.from));
  const relationships = [...first, ...second];
  const ids = new Set([...claims, ...relationships.flatMap((r) => [r.from, r.to])]);
  const concepts = graph.concepts.filter((c) => ids.has(c.id));
  const weights = computeWeights(concepts, relationships);
  for (const id of claims) weights.set(id, Math.max(weights.get(id) ?? 0, 0.85)); // claims are the prominent cards
  return { concepts, relationships, weights, folded: new Map() };
}

// Mechanism mode shows every signed influence; risk mode only what flows
// into the outcomes. Folded Relationship Types collapse into their target.
function causeEffectScope(graph: Graph, s: CauseEffectSettings): Scope {
  const signed = graph.relationships.filter((r) => sign(s, r.type) !== 0);
  let ids: Set<string>;
  if (s.mode === "risk") {
    ids = new Set(s.outcomes);
    const queue = [...s.outcomes];
    while (queue.length) {
      const id = queue.shift()!;
      for (const r of signed) if (r.to === id && !ids.has(r.from)) (ids.add(r.from), queue.push(r.from));
    }
  } else {
    ids = new Set(signed.flatMap((r) => [r.from, r.to]));
  }
  const relationships = signed.filter((r) => ids.has(r.from) && ids.has(r.to));
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));
  const folded = new Map<string, Concept[]>();
  for (const r of graph.relationships) {
    if (s.fold?.includes(r.type) && ids.has(r.to) && !ids.has(r.from)) {
      folded.set(r.to, [...(folded.get(r.to) ?? []), byId.get(r.from)!]);
    }
  }
  const concepts = graph.concepts.filter((c) => ids.has(c.id));
  const weights = computeWeights(concepts, relationships);
  // In risk mode the outcome is the point of the View: draw it largest.
  if (s.mode === "risk") for (const o of s.outcomes) if (weights.has(o)) weights.set(o, 1.3);
  return { concepts, relationships, weights, folded };
}

/** Levers: Concepts matching the View's lever filter that nothing else drives. */
export function leversOf(scope: Scope, s: CauseEffectSettings): Set<string> {
  const incoming = new Set(scope.relationships.map((r) => r.to));
  return new Set(scope.concepts.filter((c) => matchesFilter(c, s.levers) && !incoming.has(c.id)).map((c) => c.id));
}

// Lineage: dated Concepts linked by "led to", oldest on the left.
function lineageScope(graph: Graph, s: LineageSettings): Scope {
  const ok = (c: Concept) => !!c.date && (!s.tags || (c.tags ?? []).some((t) => s.tags!.includes(t)));
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));
  const relationships = graph.relationships.filter(
    (r) => s.relationshipTypes.includes(r.type) && ok(byId.get(r.from)!) && ok(byId.get(r.to)!),
  );
  const ids = new Set(relationships.flatMap((r) => [r.from, r.to]));
  const concepts = graph.concepts.filter((c) => ids.has(c.id));
  return { concepts, relationships, weights: computeWeights(concepts, relationships), folded: new Map() };
}

/**
 * Learning path: the target and everything it needs, transitively. A Concept
 * the reader already knows ends the walk there: its own prerequisites drop out.
 */
export function learningScope(graph: Graph, types: string[], target: string, known: Set<string>): Scope {
  const prereqs = graph.relationships.filter((r) => types.includes(r.type));
  const ids = new Set([target]);
  const queue = [target];
  while (queue.length) {
    const id = queue.shift()!;
    if (known.has(id)) continue;
    for (const r of prereqs) if (r.to === id && !ids.has(r.from)) (ids.add(r.from), queue.push(r.from));
  }
  const concepts = graph.concepts.filter((c) => ids.has(c.id));
  const relationships = prereqs.filter((r) => ids.has(r.from) && ids.has(r.to) && !known.has(r.to));
  const weights = new Map(concepts.map((c) => [c.id, c.id === target ? 0.9 : known.has(c.id) ? 0.1 : 0.45]));
  return { concepts, relationships, weights, folded: new Map() };
}

/**
 * All learning paths at once: every Concept on a prerequisite, sized by role.
 * Targets (specific techniques with a deep enough path) and the foundations
 * many paths share are core, drawn from the start; the steps in between are
 * auxiliary and appear when the reader picks something connected to them.
 */
export type LearningMap = {
  scope: Scope;
  targets: Map<string, number>; // target -> steps behind it
  core: Set<string>;
};

export function learningMap(graph: Graph, s: LearningPathSettings): LearningMap {
  const relationships = graph.relationships.filter((r) => s.relationshipTypes.includes(r.type));
  const ids = new Set(relationships.flatMap((r) => [r.from, r.to]));
  const concepts = graph.concepts.filter((c) => ids.has(c.id));
  const closure = (id: string) => learningScope(graph, s.relationshipTypes, id, new Set()).concepts.map((c) => c.id);

  const targets = new Map<string, number>();
  const sharedBy = new Map<string, number>();
  for (const c of concepts) {
    if (s.targets && !matchesFilter(c, s.targets)) continue;
    const path = closure(c.id);
    if (path.length - 1 < (s.minSteps ?? 2)) continue;
    targets.set(c.id, path.length - 1);
    for (const id of path) if (id !== c.id) sharedBy.set(id, (sharedBy.get(id) ?? 0) + 1);
  }
  const minShared = s.coreShared ?? Math.max(2, Math.ceil(targets.size / 3));
  const core = new Set(
    concepts
      .filter((c) => c.weight !== "aux")
      .filter((c) => targets.has(c.id) || (sharedBy.get(c.id) ?? 0) >= minShared || (c.weight === "core" && sharedBy.has(c.id)))
      .map((c) => c.id),
  );
  const weights = new Map(concepts.map((c) => [c.id, targets.has(c.id) ? 0.7 : core.has(c.id) ? 0.5 : 0.2]));
  return { scope: { concepts, relationships, weights, folded: new Map() }, targets, core };
}

/** Reading order for a learning path: prerequisites first (topological). */
export function readingOrder(scope: Scope): string[] {
  const indeg = new Map(scope.concepts.map((c) => [c.id, 0]));
  for (const r of scope.relationships) indeg.set(r.to, (indeg.get(r.to) ?? 0) + 1);
  const index = new Map(scope.concepts.map((c, i) => [c.id, i]));
  const ready = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  const out: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => index.get(a)! - index.get(b)!);
    const id = ready.shift()!;
    out.push(id);
    for (const r of scope.relationships) {
      if (r.from !== id) continue;
      indeg.set(r.to, indeg.get(r.to)! - 1);
      if (indeg.get(r.to) === 0) ready.push(r.to);
    }
  }
  return out;
}

export function sign(s: CauseEffectSettings, type: string) {
  return s.positive.includes(type) ? 1 : s.negative.includes(type) ? -1 : 0;
}

export type NetEffect = { sign: "raises" | "lowers" | "mixed"; paths: number };
export type Trace = {
  upstream: Map<string, NetEffect>; // what drives the selection, and how
  downstream: Map<string, NetEffect>; // what the selection affects, and how
  edges: Set<Relationship>;
};

/**
 * Trace mode: every path from and to a Concept through signed influences,
 * multiplying signs along the way (statins ⊣ mevalonate → cholesterol means
 * statins lower cholesterol).
 */
export function trace(s: CauseEffectSettings, rels: Relationship[], id: string): Trace {
  const edges = new Set<Relationship>();
  const walk = (dir: "down" | "up") => {
    const signs = new Map<string, number[]>();
    const go = (at: string, acc: number, path: Set<string>) => {
      for (const r of rels) {
        const [here, next] = dir === "down" ? [r.from, r.to] : [r.to, r.from];
        if (here !== at || path.has(next)) continue;
        const k = acc * sign(s, r.type);
        edges.add(r);
        signs.set(next, [...(signs.get(next) ?? []), k]);
        go(next, k, new Set(path).add(next));
      }
    };
    go(id, 1, new Set([id]));
    const out = new Map<string, NetEffect>();
    for (const [n, ks] of signs) {
      const all = new Set(ks);
      out.set(n, { sign: all.size > 1 ? "mixed" : ks[0] > 0 ? "raises" : "lowers", paths: ks.length });
    }
    return out;
  };
  return { downstream: walk("down"), upstream: walk("up"), edges };
}

/**
 * Weight: how central a Concept is, from structure (degree within the View,
 * with incoming edges counting a bit more), overridden by curator pins.
 */
export function computeWeights(concepts: Concept[], rels: Relationship[]) {
  const score = new Map<string, number>(concepts.map((c) => [c.id, 0]));
  for (const r of rels) {
    score.set(r.from, (score.get(r.from) ?? 0) + 1);
    score.set(r.to, (score.get(r.to) ?? 0) + 1.5);
  }
  const max = Math.max(1, ...score.values());
  const weights = new Map<string, number>();
  for (const c of concepts) {
    let w = Math.sqrt((score.get(c.id) ?? 0) / max);
    if (c.weight === "core") w = Math.max(w, 0.9);
    if (c.weight === "aux") w = Math.min(w, 0.25);
    weights.set(c.id, w);
  }
  return weights;
}

/** Parse "YYYY", "YYYY-MM" or "YYYY-MM-DD" to the start of that period. */
export function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const [y, m = "1", d = "1"] = s.split("-");
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The end of the period a fuzzy date names: 1987 → 1988-01-01. */
export function endOfPeriod(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (d) return new Date(Date.UTC(y, m - 1, d + 1));
  if (m) return new Date(Date.UTC(y, m, 1));
  return new Date(Date.UTC(y + 1, 0, 1));
}

export function formatDate(c: Concept) {
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    if (!m) return String(y);
    const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" });
    return d ? `${month} ${d}, ${y}` : `${month} ${y}`;
  };
  if (!c.date) return undefined;
  const start = `${c.dateApprox ? "~" : ""}${fmt(c.date)}`;
  if (!c.dateEnd) return start;
  return `${start} → ${c.dateEnd === "ongoing" ? "ongoing" : fmt(c.dateEnd)}`;
}

export function neighbours(graph: Graph, id: string) {
  const out = graph.relationships.filter((r) => r.from === id);
  const inc = graph.relationships.filter((r) => r.to === id);
  return { out, inc };
}
