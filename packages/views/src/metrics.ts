// Layout quality for the canvas Views of an Expedition, using the real
// layout functions (spec §4.4). The curator agent's `view.inspect` returns
// these, and reshapes structure (never positions) when a View won't read well.
// Ported from the prototype's `scripts/layout-metrics.ts`.
import { isCanvasView, type Expedition, type View } from "./model.ts";
import { layout, nodeSize, type Point, type Visible } from "./layouts.ts";
import { learningMap, scopeFor, topicRoots } from "./scope.ts";
import { drawnRelationships } from "./drawn.ts";

export type LayoutMetrics = {
  viewId: string;
  label: string;
  viewType: View["viewType"];
  shown: number;
  edges: number;
  crossings: number;
  /** Edges drawn straight through a Concept they don't belong to. */
  edgesThroughNodes: number;
  /** Edges more than 3× the median edge length. */
  veryLongEdges: number;
  /** Learning path only: visible prerequisites whose ends sit in different topics. */
  crossTopic?: number;
  verdict: "reads well" | "cluttered";
};

/** Thresholds calibrated on the hand-made samples, which all read well. */
export const READS_WELL = { crossings: 0.2, edgesThroughNodes: 0.1 } as const;

type Seg = { a: Point; b: Point; from: string; to: string };
const orient = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
const cross = (s: Seg, t: Seg) => {
  if ([s.from, s.to].some((id) => id === t.from || id === t.to)) return false;
  return orient(s.a, s.b, t.a) !== orient(s.a, s.b, t.b) && orient(t.a, t.b, s.a) !== orient(t.a, t.b, s.b);
};

/**
 * Metrics for one View as a reader first sees it (for a Learning path: the
 * core, with the steps between hidden). Undefined for View Types not drawn on
 * the canvas.
 */
export async function layoutMetrics(expedition: Expedition, view: View): Promise<LayoutMetrics | undefined> {
  if (!isCanvasView(view)) return undefined;
  const scope = scopeFor(expedition, view);
  let visible: Visible | undefined;
  let crossTopic: number | undefined;
  if (view.viewType === "learning-path") {
    const m = learningMap(expedition, view.settings);
    const hidden = new Set(scope.concepts.map((c) => c.id).filter((id) => !m.core.has(id)));
    const topics = topicRoots(expedition);
    visible = { hidden, bridges: [], topics };
    crossTopic = scope.relationships.filter(
      (r) => !hidden.has(r.from) && !hidden.has(r.to) && topics.get(r.from)?.id !== topics.get(r.to)?.id,
    ).length;
  }
  const isShown = (id: string) => !visible?.hidden.has(id);
  const { positions } = await layout(scope, view, visible);
  const shown = scope.concepts.filter((c) => positions.has(c.id) && isShown(c.id));
  // Measure the lines the reader sees by default (nothing selected), from the
  // same list the renderer draws: in risk mode, levers point at the outcome
  // and their real edges stay hidden until traced.
  const ce = view.viewType === "cause-and-effect" ? view.settings : undefined;
  const segs: Seg[] = drawnRelationships(scope, ce, { shown: isShown })
    .filter((r) => positions.has(r.from) && positions.has(r.to))
    .map((r) => ({ a: positions.get(r.from)!, b: positions.get(r.to)!, from: r.from, to: r.to }));

  let crossings = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (cross(segs[i], segs[j])) crossings++;

  const lens = segs.map((s) => Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y)).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)] ?? 0;
  const veryLongEdges = lens.filter((l) => l > 3 * median).length;

  let edgesThroughNodes = 0;
  for (const s of segs)
    for (const c of shown) {
      if (c.id === s.from || c.id === s.to) continue;
      const p = positions.get(c.id)!;
      const { width, height } = nodeSize(scope.weights.get(c.id) ?? 0);
      let hit = false;
      for (let k = 3; k < 18 && !hit; k++) {
        const x = s.a.x + ((s.b.x - s.a.x) * k) / 20;
        const y = s.a.y + ((s.b.y - s.a.y) * k) / 20;
        hit = Math.abs(x - p.x) < width * 0.35 && Math.abs(y - p.y) < height * 0.35;
      }
      if (hit) edgesThroughNodes++;
    }

  const readsWell =
    crossings <= segs.length * READS_WELL.crossings && edgesThroughNodes <= segs.length * READS_WELL.edgesThroughNodes;
  return {
    viewId: view.id,
    label: view.label,
    viewType: view.viewType,
    shown: shown.length,
    edges: segs.length,
    crossings,
    edgesThroughNodes,
    veryLongEdges,
    ...(crossTopic !== undefined && { crossTopic }),
    verdict: readsWell ? "reads well" : "cluttered",
  };
}

/** Metrics for every canvas View of an Expedition, in the Expedition's View order. */
export async function expeditionLayoutMetrics(expedition: Expedition): Promise<LayoutMetrics[]> {
  const out: LayoutMetrics[] = [];
  for (const view of expedition.views) {
    const m = await layoutMetrics(expedition, view);
    if (m) out.push(m);
  }
  return out;
}

/** One line per View, as the prototype script printed it. */
export function formatLayoutMetrics(m: LayoutMetrics): string {
  return (
    `${m.label} (${m.viewType}): ${m.shown} shown, ${m.edges} edges, ${m.crossings} crossings, ` +
    `${m.edgesThroughNodes} edges through other nodes, ${m.veryLongEdges} very long edges` +
    (m.crossTopic !== undefined ? `, ${m.crossTopic} prerequisites cross topics` : "") +
    ` → ${m.verdict}`
  );
}
