// What part of an Expedition each canvas View shows, and the structural
// helpers its layout and renderer share (weights, levers, trace, topics).
// Ported from the prototype's `src/lib/view.ts`.
import type {
  CauseEffectSettings,
  Concept,
  ConceptFilter,
  EvidenceSettings,
  Expedition,
  LearningPathSettings,
  LineageSettings,
  Relationship,
  View,
} from "./model.ts";

/** The part of an Expedition a canvas View shows. */
export type Scope = {
  concepts: Concept[];
  relationships: Relationship[];
  weights: Map<string, number>; // 0..1; above 1 marks the View's focal Concept
  folded: Map<string, Concept[]>; // Concepts folded into another (e.g. a lever's build steps)
};

const emptyScope = (): Scope => ({ concepts: [], relationships: [], weights: new Map(), folded: new Map() });

export function matchesFilter(c: Concept, f: ConceptFilter) {
  return (
    (!f.kinds || f.kinds.includes(c.kind)) &&
    (!f.tags || (c.tags ?? []).some((t) => f.tags!.includes(t))) &&
    (!f.hasAttribute || c.attributes?.[f.hasAttribute] !== undefined)
  );
}

/** Scope for the View Types drawn on the canvas. Other View Types get an empty scope. */
export function scopeFor(expedition: Expedition, view: View): Scope {
  if (view.viewType === "evidence") return evidenceScope(expedition, view.settings);
  if (view.viewType === "cause-and-effect") return causeEffectScope(expedition, view.settings);
  if (view.viewType === "lineage") return lineageScope(expedition, view.settings);
  if (view.viewType === "learning-path") return learningMap(expedition, view.settings).scope;
  return emptyScope();
}

// Claims are the hubs; evidence fans out from them, and evidence about the
// evidence (a sponsor behind a trial) hangs one step further out.
function evidenceScope(expedition: Expedition, s: EvidenceSettings): Scope {
  const types = new Set([...s.supports, ...s.challenges]);
  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const bearing = expedition.relationships.filter((r) => types.has(r.type));
  const claims = new Set(bearing.filter((r) => s.claimKinds.includes(byId.get(r.to)?.kind ?? "")).map((r) => r.to));
  const first = bearing.filter((r) => claims.has(r.to));
  const evidence = new Set(first.map((r) => r.from));
  const second = bearing.filter((r) => evidence.has(r.to) && !claims.has(r.from));
  const relationships = [...first, ...second];
  const ids = new Set([...claims, ...relationships.flatMap((r) => [r.from, r.to])]);
  const concepts = expedition.concepts.filter((c) => ids.has(c.id));
  const weights = computeWeights(concepts, relationships);
  for (const id of claims) weights.set(id, Math.max(weights.get(id) ?? 0, 0.85)); // claims are the prominent cards
  return { concepts, relationships, weights, folded: new Map() };
}

// Mechanism mode shows every signed influence; risk mode only what flows
// into the outcomes. Folded Relationship Types collapse into their target.
function causeEffectScope(expedition: Expedition, s: CauseEffectSettings): Scope {
  const signed = expedition.relationships.filter((r) => sign(s, r.type) !== 0);
  let ids: Set<string>;
  if (s.mode === "risk") {
    ids = new Set(s.outcomes);
    const queue = [...s.outcomes];
    while (queue.length) {
      const id = queue.shift()!;
      for (const r of signed)
        if (r.to === id && !ids.has(r.from)) {
          ids.add(r.from);
          queue.push(r.from);
        }
    }
  } else {
    ids = new Set(signed.flatMap((r) => [r.from, r.to]));
  }
  const relationships = signed.filter((r) => ids.has(r.from) && ids.has(r.to));
  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const folded = new Map<string, Concept[]>();
  for (const r of expedition.relationships) {
    const from = byId.get(r.from);
    if (from && s.fold?.includes(r.type) && ids.has(r.to) && !ids.has(r.from)) {
      folded.set(r.to, [...(folded.get(r.to) ?? []), from]);
    }
  }
  const concepts = expedition.concepts.filter((c) => ids.has(c.id));
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
function lineageScope(expedition: Expedition, s: LineageSettings): Scope {
  const ok = (c?: Concept) => !!c?.date && (!s.tags || (c.tags ?? []).some((t) => s.tags!.includes(t)));
  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const relationships = expedition.relationships.filter(
    (r) => s.relationshipTypes.includes(r.type) && ok(byId.get(r.from)) && ok(byId.get(r.to)),
  );
  const ids = new Set(relationships.flatMap((r) => [r.from, r.to]));
  const concepts = expedition.concepts.filter((c) => ids.has(c.id));
  return { concepts, relationships, weights: computeWeights(concepts, relationships), folded: new Map() };
}

/**
 * Learning path: the target and everything it needs, transitively. A Concept
 * the reader already knows ends the walk there: its own prerequisites drop out.
 */
export function learningScope(expedition: Expedition, types: string[], target: string, known: Set<string>): Scope {
  const prereqs = expedition.relationships.filter((r) => types.includes(r.type));
  const ids = new Set([target]);
  const queue = [target];
  while (queue.length) {
    const id = queue.shift()!;
    if (known.has(id)) continue;
    for (const r of prereqs)
      if (r.to === id && !ids.has(r.from)) {
        ids.add(r.from);
        queue.push(r.from);
      }
  }
  const concepts = expedition.concepts.filter((c) => ids.has(c.id));
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

export function learningMap(expedition: Expedition, s: LearningPathSettings): LearningMap {
  const relationships = expedition.relationships.filter((r) => s.relationshipTypes.includes(r.type));
  const ids = new Set(relationships.flatMap((r) => [r.from, r.to]));
  const concepts = expedition.concepts.filter((c) => ids.has(c.id));
  const closure = (id: string) => learningScope(expedition, s.relationshipTypes, id, new Set()).concepts.map((c) => c.id);

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
      .filter(
        (c) => targets.has(c.id) || (sharedBy.get(c.id) ?? 0) >= minShared || (c.weight === "core" && sharedBy.has(c.id)),
      )
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

/**
 * Each Concept's topic: the root it reaches by following part-of upward.
 * part-of is the built-in type (`builtin:part-of`) or, in fixtures written
 * before the domain types, a type with the plain id `part-of`.
 */
export type Topic = { id: string; title: string };
const PART_OF: readonly string[] = ["builtin:part-of", "part-of"];
export function topicRoots(expedition: Expedition, partOf: string | readonly string[] = PART_OF): Map<string, Topic> {
  const types = new Set(typeof partOf === "string" ? [partOf] : partOf);
  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const parent = new Map<string, string>();
  for (const r of expedition.relationships) if (types.has(r.type) && !parent.has(r.from)) parent.set(r.from, r.to);
  const out = new Map<string, Topic>();
  for (const c of expedition.concepts) {
    let id = c.id;
    const seen = new Set<string>();
    while (parent.has(id) && !seen.has(id)) {
      seen.add(id);
      id = parent.get(id)!;
    }
    const root = byId.get(id);
    if (id !== c.id && root) out.set(c.id, { id, title: root.title });
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
 * multiplying signs along the way (A lowers B, B raises C: A lowers C).
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
