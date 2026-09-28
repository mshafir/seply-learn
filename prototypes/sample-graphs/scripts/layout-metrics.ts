// Layout quality for every graph-drawn View of an Expedition, using the
// viewer's own layout code. A curator agent runs this to see whether a View
// will read well, and reshapes structure (never positions) when it won't.
//
// Build + run: npx vite build --ssr scripts/layout-metrics.ts --outDir .metrics && node .metrics/layout-metrics.js <graph.json>
import { readFileSync } from "node:fs";
import type { Graph } from "../src/lib/types";
import { learningMap, scopeFor, type Scope } from "../src/lib/view";
import { layout, nodeSize, type Visible } from "../src/views/layouts";

const graph: Graph = JSON.parse(readFileSync(process.argv[2], "utf8"));

function topicRoots(g: Graph) {
  const byId = new Map(g.concepts.map((c) => [c.id, c]));
  const parent = new Map<string, string>();
  for (const r of g.relationships) if (r.type === "part-of" && !parent.has(r.from)) parent.set(r.from, r.to);
  const out = new Map<string, { id: string; title: string }>();
  for (const c of g.concepts) {
    let id = c.id;
    const seen = new Set<string>();
    while (parent.has(id) && !seen.has(id)) {
      seen.add(id);
      id = parent.get(id)!;
    }
    if (id !== c.id && byId.has(id)) out.set(c.id, { id, title: byId.get(id)!.title });
  }
  return out;
}

type Seg = { a: { x: number; y: number }; b: { x: number; y: number }; from: string; to: string };
const cross = (s: Seg, t: Seg) => {
  if ([s.from, s.to].some((id) => id === t.from || id === t.to)) return false;
  const o = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(s.a, s.b, t.a) !== o(s.a, s.b, t.b) && o(t.a, t.b, s.a) !== o(t.a, t.b, s.b);
};

for (const view of graph.views) {
  if (!["cause-and-effect", "learning-path", "evidence", "lineage"].includes(view.viewType)) continue;
  let scope: Scope = scopeFor(graph, view);
  let visible: Visible | undefined;
  let crossTopic = 0;
  if (view.viewType === "learning-path") {
    // What a reader sees first: the core (targets and shared foundations).
    const m = learningMap(graph, view.settings);
    const hidden = new Set(scope.concepts.map((c) => c.id).filter((id) => !m.core.has(id)));
    const topics = topicRoots(graph);
    visible = { hidden, bridges: [], topics };
    crossTopic = scope.relationships.filter(
      (r) => !hidden.has(r.from) && !hidden.has(r.to) && topics.get(r.from)?.id !== topics.get(r.to)?.id,
    ).length;
  }
  const { positions } = await layout(scope, view, visible);
  const shown = scope.concepts.filter((c) => positions.has(c.id) && !visible?.hidden.has(c.id));
  const segs: Seg[] = scope.relationships
    .filter((r) => positions.has(r.from) && positions.has(r.to) && !visible?.hidden.has(r.from) && !visible?.hidden.has(r.to))
    .map((r) => ({ a: positions.get(r.from)!, b: positions.get(r.to)!, from: r.from, to: r.to }));
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (cross(segs[i], segs[j])) crossings++;
  const lens = segs.map((s) => Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y)).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)] ?? 0;
  const long = lens.filter((l) => l > 3 * median).length;
  // Edges drawn straight through a node they don't belong to.
  let through = 0;
  for (const s of segs)
    for (const c of shown) {
      if (c.id === s.from || c.id === s.to) continue;
      const p = positions.get(c.id)!;
      const { width, height } = nodeSize(scope.weights.get(c.id) ?? 0);
      for (let k = 3; k < 18; k++) {
        const x = s.a.x + ((s.b.x - s.a.x) * k) / 20, y = s.a.y + ((s.b.y - s.a.y) * k) / 20;
        if (Math.abs(x - p.x) < width * 0.35 && Math.abs(y - p.y) < height * 0.35) {
          through++;
          break;
        }
      }
    }
  // Calibrated on the hand-made sample graphs, which all read well.
  const verdict = crossings <= segs.length * 0.2 && through <= segs.length * 0.1 ? "reads well" : "cluttered";
  console.log(
    `${view.label} (${view.viewType}): ${shown.length} shown, ${segs.length} edges, ${crossings} crossings, ` +
      `${through} edges through other nodes, ${long} very long edges` +
      (view.viewType === "learning-path" ? `, ${crossTopic} prerequisites cross topics` : "") +
      ` → ${verdict}`,
  );
}
