// Layouts for the View Types drawn on the canvas. Each is a pure function
// (scope, view, visible?) → node centres in canvas pixels (+ bands, ticks).
// React Flow only renders what these compute; positions are never stored.
// Ported from the prototype's `src/views/layouts.ts`.
import ELK from "elkjs/lib/elk.bundled.js";
import type { CauseEffectSettings, Concept, EvidenceSettings, View } from "./model.ts";
import { leversOf, type Scope, type Topic } from "./scope.ts";

export type Point = { x: number; y: number };
export type Positions = Map<string, Point>;
export type Band = { x: number; y: number; width: number; height: number; label: string };
export type Tick = { x: number; label: string };
export type Extras = { bands?: Band[]; ticks?: Tick[] };
export type LayoutResult = { positions: Positions; extras: Extras };

/** Card size for a Concept of this weight. Weight above 1 marks a View's focal Concept (the outcome in risk mode). */
export const nodeSize = (w: number) =>
  w > 1 ? { width: 300, height: 88 } : { width: Math.round(150 + w * 70), height: Math.round(38 + w * 18) };

const elk = new ELK();

/** ELK layered defaults shared by every directed layout (spec §4.3). */
const layered = {
  "elk.algorithm": "layered",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
};

/** What a View currently hides; layouts that depend on it re-run when it changes. */
export type Visible = {
  hidden: Set<string>;
  /** Dashed edges standing in for a chain of hidden Concepts. */
  bridges: { from: string; to: string }[];
  /** Topic each Concept belongs to (its part-of root), for layouts that group by topic. */
  topics?: Map<string, Topic>;
};

export async function layout(scope: Scope, view: View, visible?: Visible): Promise<LayoutResult> {
  if (view.viewType === "evidence") return { positions: evidence(scope, view.settings), extras: {} };
  if (view.viewType === "cause-and-effect") return causeEffect(scope, view.settings);
  if (view.viewType === "lineage") return lineage(scope, view.settings.groupBy);
  if (view.viewType === "learning-path") return learningPath(scope, visible);
  return { positions: new Map(), extras: {} };
}

const size = (scope: Scope, id: string) => nodeSize(scope.weights.get(id) ?? 0);

/** Stack items in a column near their wanted y without overlapping. */
function stack(items: { id: string; want: number; h: number }[], gap: number) {
  items.sort((a, b) => a.want - b.want);
  const ys: number[] = [];
  items.forEach((it, i) => {
    const prev = i ? ys[i - 1] + items[i - 1].h / 2 + gap + it.h / 2 : -Infinity;
    ys.push(Math.max(it.want, prev));
  });
  // Shift the column so it sits centred on what it wanted, not pushed down.
  const drift = items.reduce((s, it, i) => s + ys[i] - it.want, 0) / Math.max(1, items.length);
  return new Map(items.map((it, i) => [it.id, ys[i] - drift]));
}

/** x offset of the evidence columns from the claims. */
export const EVIDENCE_COLUMN = 430;

// Claims down the middle; supporting evidence fans left, challenges right.
// Evidence shared by several claims is drawn once, level with their middle.
function evidence(scope: Scope, s: EvidenceSettings): Positions {
  const claims = scope.concepts.filter((c) => s.claimKinds.includes(c.kind) && scope.relationships.some((r) => r.to === c.id));
  const claimIds = new Set(claims.map((c) => c.id));
  const first = scope.relationships.filter((r) => claimIds.has(r.to));
  const side = (id: string) => {
    const rs = first.filter((r) => r.from === id);
    const pro = rs.filter((r) => s.supports.includes(r.type)).length;
    return pro >= rs.length - pro ? -1 : 1;
  };
  const load = (claim: string, sd: number) => first.filter((r) => r.to === claim && side(r.from) === sd).length;

  const pos: Positions = new Map();
  let y = 0;
  for (const c of claims) {
    const block = Math.max(1, load(c.id, -1), load(c.id, 1)) * 62;
    pos.set(c.id, { x: 0, y: y + block / 2 });
    y += block + 70;
  }
  const place = (ids: string[], x: number, target: (id: string) => number) => {
    const ys = stack(
      ids.map((id) => ({ id, want: target(id), h: size(scope, id).height })),
      18,
    );
    for (const [id, yy] of ys) pos.set(id, { x, y: yy });
  };
  const evidenceIds = [...new Set(first.map((r) => r.from))].filter((id) => !claimIds.has(id));
  const meanClaimY = (id: string) => {
    const ys = first.filter((r) => r.from === id).map((r) => pos.get(r.to)!.y);
    return ys.reduce((a, b) => a + b, 0) / ys.length;
  };
  for (const sd of [-1, 1])
    place(
      evidenceIds.filter((id) => side(id) === sd),
      sd * EVIDENCE_COLUMN,
      meanClaimY,
    );

  // Evidence about evidence: one step further out, on the same side.
  const second = scope.relationships.filter((r) => !claimIds.has(r.to) && pos.has(r.to) && !pos.has(r.from));
  for (const sd of [-1, 1]) {
    const ids = [...new Set(second.filter((r) => Math.sign(pos.get(r.to)!.x) === sd).map((r) => r.from))];
    place(ids, sd * EVIDENCE_COLUMN * 1.8, (id) => pos.get(second.find((r) => r.from === id)!.to)!.y);
  }
  return pos;
}

/** Risk mode: vertical distance between ranked levers, and the column's gap from the outcome. */
export const RISK_LEVER_STEP = 76;
const RISK_LEVER_GAP = 330;

// Influence flows toward the outcomes. Levers (things you can pull) get a
// band of their own: across the top in mechanism mode. In risk mode they form
// one column beside the (large, centred) outcome, ranked by impact: that is
// the priority list the View exists to show. Each lever is drawn pointing at
// the outcome; what it actually acts on is a chip, and its real path lights
// up when selected (see Canvas).
async function causeEffect(scope: Scope, s: CauseEffectSettings): Promise<LayoutResult> {
  const leverIds = leversOf(scope, s);
  const levers = scope.concepts.filter((c) => leverIds.has(c.id));
  const risk = s.mode === "risk";

  const flow = risk ? scope.concepts.filter((c) => !leverIds.has(c.id)) : scope.concepts;
  const flowIds = new Set(flow.map((c) => c.id));
  const res = await elk.layout({
    id: "root",
    layoutOptions: {
      ...layered,
      "elk.direction": risk ? "RIGHT" : "DOWN",
      "elk.spacing.nodeNode": "30",
      "elk.layered.spacing.nodeNodeBetweenLayers": risk ? "110" : "80",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
    },
    children: flow.map((c) => ({
      id: c.id,
      ...size(scope, c.id),
      layoutOptions: !risk && leverIds.has(c.id)
          ? { "elk.layered.layering.layerConstraint": "FIRST" }
          : ({} as Record<string, string>),
    })),
    edges: scope.relationships
      .filter((r) => flowIds.has(r.from) && flowIds.has(r.to))
      .map((r, i) => ({ id: `e${i}`, sources: [r.from], targets: [r.to] })),
  });
  const pos: Positions = new Map();
  for (const n of res.children ?? []) {
    pos.set(n.id, { x: (n.x ?? 0) + (n.width ?? 0) / 2, y: (n.y ?? 0) + (n.height ?? 0) / 2 });
  }

  const bands: Band[] = [];
  const pad = 22;
  const bbox = (ids: string[]) => {
    const xs = ids.flatMap((id) => [pos.get(id)!.x - size(scope, id).width / 2, pos.get(id)!.x + size(scope, id).width / 2]);
    const ys = ids.flatMap((id) => [pos.get(id)!.y - size(scope, id).height / 2, pos.get(id)!.y + size(scope, id).height / 2]);
    return {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad - 18,
      width: Math.max(...xs) - Math.min(...xs) + 2 * pad,
      height: Math.max(...ys) - Math.min(...ys) + 2 * pad + 18,
    };
  };

  if (risk && levers.length) {
    const outcome = pos.get(s.outcomes[0]) ?? { x: 0, y: 0 };
    const rank = (c: Concept) => Number(c.attributes?.[s.rankBy ?? ""] ?? 99);
    const sorted = [...levers].sort((a, b) => rank(a) - rank(b));
    const x = outcome.x + size(scope, s.outcomes[0]).width / 2 + RISK_LEVER_GAP;
    sorted.forEach((c, i) => pos.set(c.id, { x, y: outcome.y + (i - (sorted.length - 1) / 2) * RISK_LEVER_STEP }));
    bands.push({ ...bbox(sorted.map((c) => c.id)), label: s.rankBy ? "What to do · by impact" : "What you can do" });
  } else if (levers.length) {
    // Levers share the first layers with other sources; lift them into one
    // row of their own so the band holds only levers.
    const others = flow.filter((c) => !leverIds.has(c.id));
    const top = others.length ? Math.min(...others.map((c) => pos.get(c.id)!.y)) : 0;
    const row = [...levers].sort((a, b) => pos.get(a.id)!.x - pos.get(b.id)!.x);
    let right = -Infinity;
    for (const c of row) {
      const w = size(scope, c.id).width;
      const x = Math.max(pos.get(c.id)!.x, right + 24 + w / 2);
      pos.set(c.id, { x, y: top - 150 });
      right = x + w / 2;
    }
    bands.push({ ...bbox(levers.map((c) => c.id)), label: "Levers · things you can change" });
  }
  return { positions: pos, extras: { bands } };
}

// Learning path: prerequisites flow left to right into the target. Only what
// is visible is laid out (hidden steps are replaced by their bridges), so the
// map stays compact however many steps are hidden. Concepts are grouped by
// topic (their part-of root), each topic a labelled block, so an economics
// path and an architecture path don't interleave.
async function learningPath(scope: Scope, visible?: Visible): Promise<LayoutResult> {
  const shown = scope.concepts.filter((c) => !visible?.hidden.has(c.id));
  const ids = new Set(shown.map((c) => c.id));
  const edges = [
    ...scope.relationships.filter((r) => ids.has(r.from) && ids.has(r.to)),
    ...(visible?.bridges ?? []).filter((b) => ids.has(b.from) && ids.has(b.to)),
  ].map((r, i) => ({ id: `e${i}`, sources: [r.from], targets: [r.to] }));
  const options = {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "26",
    "elk.layered.spacing.nodeNodeBetweenLayers": "70",
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  };
  const topicOf = (id: string) => visible?.topics?.get(id);
  const groups = new Map<string, { title: string; ids: string[] }>();
  for (const c of shown) {
    const t = topicOf(c.id) ?? { id: "", title: "" };
    groups.set(t.id, { title: t.title, ids: [...(groups.get(t.id)?.ids ?? []), c.id] });
  }
  const layoutOf = async (nodeIds: string[]) => {
    const inGroup = new Set(nodeIds);
    const res = await elk.layout({
      id: "root",
      layoutOptions: options,
      children: nodeIds.map((id) => ({ id, ...size(scope, id) })),
      edges: edges.filter((e) => inGroup.has(e.sources[0]) && inGroup.has(e.targets[0])),
    });
    const kids = res.children ?? [];
    return {
      children: kids,
      width: Math.max(0, ...kids.map((n) => (n.x ?? 0) + (n.width ?? 0))),
      height: Math.max(0, ...kids.map((n) => (n.y ?? 0) + (n.height ?? 0))),
    };
  };
  if (groups.size < 2) {
    const res = await layoutOf(shown.map((c) => c.id));
    const pos: Positions = new Map();
    for (const n of res.children) pos.set(n.id, { x: (n.x ?? 0) + (n.width ?? 0) / 2, y: (n.y ?? 0) + (n.height ?? 0) / 2 });
    return { positions: pos, extras: {} };
  }

  // Order topics so the ones others build on come first (sources of cross-topic edges).
  const gOf = new Map<string, string>();
  for (const [gid, g] of groups) for (const id of g.ids) gOf.set(id, gid);
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  for (const e of edges) {
    const a = gOf.get(e.sources[0])!;
    const b = gOf.get(e.targets[0])!;
    if (a === b) continue;
    out.set(a, (out.get(a) ?? 0) + 1);
    into.set(b, (into.get(b) ?? 0) + 1);
  }
  const order = [...groups.keys()].sort(
    (a, b) => (into.get(a) ?? 0) - (out.get(a) ?? 0) - ((into.get(b) ?? 0) - (out.get(b) ?? 0)),
  );

  // Lay out each topic on its own, then shelf-pack the blocks into rows.
  const pad = { top: 34, side: 18, bottom: 18 };
  const blocks = await Promise.all(order.map(async (gid) => ({ gid, res: await layoutOf(groups.get(gid)!.ids) })));
  const rowWidth = Math.max(1400, ...blocks.map((b) => b.res.width + 2 * pad.side));
  const pos: Positions = new Map();
  const bands: Band[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const { gid, res } of blocks) {
    const w = res.width + 2 * pad.side;
    const h = res.height + pad.top + pad.bottom;
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      y += rowH + 40;
      rowH = 0;
    }
    if (gid) bands.push({ x, y, width: w, height: h, label: groups.get(gid)!.title });
    for (const n of res.children)
      pos.set(n.id, { x: x + pad.side + (n.x ?? 0) + (n.width ?? 0) / 2, y: y + pad.top + (n.y ?? 0) + (n.height ?? 0) / 2 });
    x += w + 40;
    rowH = Math.max(rowH, h);
  }
  return { positions: pos, extras: { bands } };
}

// Lineage: one band per area (or per connected family), one column per
// distinct year so 1991 and a busy 2025 can share a readable axis.
function lineage(scope: Scope, groupBy?: string): LayoutResult {
  const byId = new Map(scope.concepts.map((c) => [c.id, c]));
  const year = (id: string) => Number(byId.get(id)!.date!.slice(0, 4));
  const parent = new Map(scope.concepts.map((c) => [c.id, c.id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  for (const r of scope.relationships) parent.set(find(r.from), find(r.to));
  const familyOf = (id: string) => (groupBy ? String(byId.get(id)!.attributes?.[groupBy] ?? "other") : find(id));
  const families = new Map<string, string[]>();
  for (const c of scope.concepts) families.set(familyOf(c.id), [...(families.get(familyOf(c.id)) ?? []), c.id]);
  const sorted = [...families.values()]
    .map((ids) => ids.sort((a, b) => year(a) - year(b)))
    .sort((a, b) => year(a[0]) - year(b[0]));

  const years = [...new Set(scope.concepts.map((c) => year(c.id)))].sort((a, b) => a - b);
  const col = new Map(years.map((y, i) => [y, i * 250]));
  const pos: Positions = new Map();
  const bands: Band[] = [];
  let top = 0;
  for (const ids of sorted) {
    const perYear = new Map<number, number>();
    let rows = 1;
    for (const id of ids) {
      const k = perYear.get(year(id)) ?? 0;
      perYear.set(year(id), k + 1);
      rows = Math.max(rows, k + 1);
      pos.set(id, { x: col.get(year(id))!, y: top + 62 + k * 64 });
    }
    const xs = ids.map((id) => col.get(year(id))!);
    const first = byId.get(ids[0])!;
    const area = groupBy ? first.attributes?.[groupBy] : undefined;
    bands.push({
      x: Math.min(...xs) - 125,
      y: top,
      width: Math.max(...xs) - Math.min(...xs) + 250,
      height: rows * 64 + 44,
      label: area ? String(area) : `From ${first.title}`,
    });
    top += rows * 64 + 72;
  }
  return { positions: pos, extras: { bands, ticks: years.map((y) => ({ x: col.get(y)!, label: String(y) })) } };
}
