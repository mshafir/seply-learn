import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { timer } from "d3-timer";
import { interpolateNumber } from "d3-interpolate";
import clsx from "clsx";
import type { Concept, Graph, KindDef, View } from "../lib/types";
import { leversOf, sign, trace, type Scope, type Trace } from "../lib/view";
import { layout, nodeSize, type Extras, type Positions } from "../views/layouts";
import { KindIcon } from "./icons";

export type Badge = { text: string; tone: "green" | "amber" | "red" | "slate" | "indigo" };

/**
 * What a View layers over a fixed layout: Concepts hidden (without moving the
 * rest), the set lit up, badges, and dashed bridges standing in for a chain of
 * hidden Concepts. Changing it never re-runs the layout.
 */
export type Overlay = {
  hidden: Set<string>;
  lit?: Set<string>;
  badges: Map<string, Badge[]>;
  bridges: { from: string; to: string; hops: number }[];
  fit?: string[]; // bring these into view whenever the list changes
};
type ConceptData = {
  concept: Concept;
  kind?: KindDef;
  weight: number;
  dim: boolean;
  selected: boolean;
  badges: Badge[];
};

const tones: Record<Badge["tone"], string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  slate: "bg-stone-100 text-stone-600 ring-stone-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

function ConceptNode({ data }: NodeProps<Node<ConceptData>>) {
  const { concept, kind, weight, dim, selected, badges } = data;
  const size = nodeSize(weight);
  return (
    <div
      title={concept.summary}
      style={{ width: size.width, minHeight: size.height, borderLeftColor: kind?.color }}
      className={clsx(
        "relative flex items-center gap-2 rounded-lg border border-l-4 bg-white px-2.5 py-1.5 shadow-sm transition-opacity",
        weight > 1 ? "text-[20px] font-semibold" : weight > 0.6 ? "text-[15px] font-semibold" : weight > 0.3 ? "text-[13px] font-medium" : "text-xs text-stone-600",
        dim && "opacity-20",
        selected ? "border-stone-900 ring-2 ring-stone-900/20" : "border-stone-200",
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <KindIcon name={kind?.icon ?? kind?.id} className="size-4 shrink-0" style={{ color: kind?.color }} />
      <span className="leading-tight">{concept.title}</span>
      {badges.length > 0 && (
        <div className="absolute -top-2.5 right-2 flex gap-1">
          {badges.map((b) => (
            <span key={b.text} className={clsx("whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold ring-1", tones[b.tone])}>
              {b.text}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

// Straight edge between node borders, so it reads the same in every layout.
function FloatingEdge({ id, source, target, markerEnd, style, label }: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const [sx, sy] = border(s, t);
  const [tx, ty] = border(t, s);
  return (
    <BaseEdge
      id={id}
      path={`M ${sx},${sy} L ${tx},${ty}`}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={(sx + tx) / 2}
      labelY={(sy + ty) / 2}
      labelStyle={{ fontSize: 11, fill: "#44403c" }}
      labelBgStyle={{ fill: "#fafaf9" }}
    />
  );
}

type Internal = NonNullable<ReturnType<typeof useInternalNode>>;
function border(a: Internal, b: Internal): [number, number] {
  const w = a.measured.width ?? 0;
  const h = a.measured.height ?? 0;
  const ax = a.internals.positionAbsolute.x + w / 2;
  const ay = a.internals.positionAbsolute.y + h / 2;
  const bx = b.internals.positionAbsolute.x + (b.measured.width ?? 0) / 2;
  const by = b.internals.positionAbsolute.y + (b.measured.height ?? 0) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const scale = 1 / Math.max(Math.abs(dx) / (w / 2 || 1), Math.abs(dy) / (h / 2 || 1), 1e-6);
  return [ax + dx * scale, ay + dy * scale];
}

const nodeTypes = { concept: ConceptNode };
const edgeTypes = { floating: FloatingEdge };

type Props = {
  graph: Graph;
  view: View;
  scope: Scope;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
  overlay?: Overlay;
};

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

const consensusTone: Record<string, Badge["tone"]> = { settled: "green", emerging: "amber", contested: "red" };

function badgesFor(view: View, scope: Scope, c: Concept, tr?: Trace): Badge[] {
  const out: Badge[] = [];
  if (view.viewType === "lineage" && c.date) out.push({ text: c.date.slice(0, 4), tone: "slate" });
  const attr = (k?: string) => (k ? c.attributes?.[k] : undefined);
  if (view.viewType === "evidence") {
    const consensus = attr(view.settings.consensus);
    if (consensus) out.push({ text: String(consensus), tone: consensusTone[String(consensus)] ?? "slate" });
    const type = attr(view.settings.evidenceType);
    if (type) out.push({ text: String(type), tone: type === "Dissent" ? "red" : "indigo" });
  }
  if (view.viewType === "cause-and-effect") {
    const rank = attr(view.settings.rankBy);
    if (rank !== undefined) out.push({ text: `#${rank}`, tone: "slate" });
    const folded = scope.folded.get(c.id);
    if (folded) out.push({ text: `+${folded.length} build steps`, tone: "slate" });
    // Risk mode draws every lever pointing at the outcome; say what it really acts on.
    if (view.settings.mode === "risk" && leversOf(scope, view.settings).has(c.id)) {
      const outcomes = new Set(view.settings.outcomes);
      const titles = new Map(scope.concepts.map((x) => [x.id, x.title]));
      const on = scope.relationships.filter((r) => r.from === c.id && !outcomes.has(r.to)).map((r) => titles.get(r.to));
      if (on.length) out.push({ text: `acts on ${on.join(", ")}`, tone: "slate" });
    }
    const eff = tr?.downstream.get(c.id) ?? tr?.upstream.get(c.id);
    if (eff) {
      const up = tr!.upstream.has(c.id);
      const word = eff.sign === "mixed" ? "mixed" : up ? `${eff.sign} it` : eff.sign === "raises" ? "▲ raised" : "▼ lowered";
      out.push({ text: word, tone: eff.sign === "raises" ? "red" : eff.sign === "lowers" ? "green" : "amber" });
    }
  }
  return out;
}

/** Each Concept's topic: the root it reaches by following part-of upward. */
function topicRoots(graph: Graph) {
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));
  const parent = new Map<string, string>();
  for (const r of graph.relationships) if (r.type === "part-of" && !parent.has(r.from)) parent.set(r.from, r.to);
  const out = new Map<string, { id: string; title: string }>();
  for (const c of graph.concepts) {
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

function Inner({ graph, view, scope, selected, onSelect, matches, overlay }: Props) {
  const [positions, setPositions] = useState<Positions>(new Map());
  const [extras, setExtras] = useState<Extras>({});
  const current = useRef<Positions>(new Map());
  const { fitView } = useReactFlow();
  const fitIds = overlay?.fit?.join(",");
  const hiddenKey = overlay ? [...overlay.hidden].sort().join(",") : "";
  const fit = (duration: number) =>
    fitView({ duration, padding: 0.12, maxZoom: 1.4, nodes: fitIds ? fitIds.split(",").map((id) => ({ id })) : undefined });
  const fitRef = useRef(fit);
  fitRef.current = fit;
  // Wait a beat: selecting often opens the side panel, which resizes the canvas.
  useEffect(() => {
    if (!current.current.size) return;
    const t = setTimeout(() => fitRef.current(500), 80);
    return () => clearTimeout(t);
  }, [fitIds]);

  // Lay out, then animate every Concept from where it was to where it goes.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const visible =
      view.viewType === "learning-path" && overlay
        ? { hidden: overlay.hidden, bridges: overlay.bridges, topics: topicRoots(graph) }
        : undefined;
    layout(scope, view, visible).then(({ positions: next, extras }) => {
      if (cancelled) return;
      setExtras(extras);
      const from = current.current;
      const interp = [...next].map(([id, p]) => {
        const f = from.get(id) ?? p;
        return [id, interpolateNumber(f.x, p.x), interpolateNumber(f.y, p.y)] as const;
      });
      const t = timer((elapsed) => {
        const k = Math.min(1, elapsed / 650);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const frame: Positions = new Map(interp.map(([id, ix, iy]) => [id, { x: ix(e), y: iy(e) }]));
        current.current = frame;
        setPositions(frame);
        if (k >= 1) {
          t.stop();
          fitRef.current(500);
        }
      });
      stop = () => t.stop();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
    // Re-run when what's hidden changes, but only for layouts that depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, view, fitView, view.viewType === "learning-path" ? hiddenKey : ""]);

  const kinds = useMemo(() => new Map(graph.kinds.map((k) => [k.id, k])), [graph]);
  const relTypes = useMemo(() => new Map(graph.relationshipTypes.map((t) => [t.id, t])), [graph]);

  // Trace mode (Cause & Effect): everything upstream and downstream of the
  // selection. Elsewhere, selecting lights up direct neighbours.
  const ce = view.viewType === "cause-and-effect" ? view.settings : undefined;
  const tr = useMemo(
    () => (ce && selected && scope.concepts.some((c) => c.id === selected) ? trace(ce, scope.relationships, selected) : undefined),
    [ce, selected, scope],
  );
  const lit = useMemo(() => {
    if (overlay) return overlay.lit;
    if (!selected || !scope.concepts.some((c) => c.id === selected)) return undefined;
    if (tr) return new Set([selected, ...tr.upstream.keys(), ...tr.downstream.keys()]);
    return new Set([selected, ...scope.relationships.filter((r) => r.from === selected || r.to === selected).flatMap((r) => [r.from, r.to])]);
  }, [selected, tr, scope, overlay]);
  const shown = (id: string) => !overlay?.hidden.has(id);

  const nodes: Node<ConceptData>[] = scope.concepts
    .filter((c) => positions.has(c.id) && shown(c.id))
    .map((c) => {
      const w = scope.weights.get(c.id) ?? 0;
      const size = nodeSize(w);
      const p = positions.get(c.id)!;
      return {
        id: c.id,
        type: "concept",
        position: { x: p.x - size.width / 2, y: p.y - size.height / 2 },
        data: {
          concept: c,
          kind: kinds.get(c.kind),
          weight: w,
          dim: (!!matches && !matches.has(c.id)) || (!!lit && !lit.has(c.id)),
          selected: c.id === selected,
          badges: overlay ? overlay.badges.get(c.id) ?? [] : badgesFor(view, scope, c, tr),
        },
      };
    });

  // Risk mode: a lever's real edges are drawn only while its path is traced;
  // by default each lever points straight at the outcome, keeping the ranked
  // column readable as a priority list.
  const riskLevers = ce?.mode === "risk" ? leversOf(scope, ce) : new Set<string>();
  const outcome = ce?.mode === "risk" ? ce.outcomes[0] : undefined;
  const drawn = scope.relationships.filter(
    (r) => shown(r.from) && shown(r.to) && (!riskLevers.has(r.from) || r.to === outcome || (tr && tr.edges.has(r))),
  );
  const direct = new Set(drawn.filter((r) => riskLevers.has(r.from) && r.to === outcome).map((r) => r.from));
  const synthetic = [...riskLevers]
    .filter((id) => !direct.has(id) && !(tr && selected === id))
    .map((id) => ({ from: id, to: outcome!, type: ce!.negative[0] ?? "lowers", note: undefined as string | undefined }));
  const edges: Edge[] = [...drawn, ...synthetic].map((r, i) => {
    const t = relTypes.get(r.type);
    const touches = !!selected && (r.from === selected || r.to === selected);
    const on = tr ? tr.edges.has(r) : lit && overlay ? lit.has(r.from) && lit.has(r.to) : touches;
    const dim = (matches && !(matches.has(r.from) && matches.has(r.to))) || ((overlay ? lit : selected) && !on);
    // Cause & Effect carries the sign in colour: red raises, green lowers.
    const color = ce ? (sign(ce, r.type) > 0 ? "#dc2626" : "#16a34a") : t?.color ?? "#a8a29e";
    return {
      id: `${r.from}-${r.type}-${r.to}-${i}`,
      source: r.from,
      target: r.to,
      type: "floating",
      label: on && (!overlay || touches) ? [t?.label, r.note].filter(Boolean).join(" · ") : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: {
        stroke: color,
        strokeWidth: on ? 2.4 : 1.4,
        strokeDasharray: t?.dashed ? "6 4" : undefined,
        opacity: dim ? 0.1 : 0.85,
      },
    };
  });
  for (const b of overlay?.bridges ?? []) {
    const dim = (matches && !(matches.has(b.from) && matches.has(b.to))) || (lit && !(lit.has(b.from) && lit.has(b.to)));
    edges.push({
      id: `bridge-${b.from}-${b.to}`,
      source: b.from,
      target: b.to,
      type: "floating",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#a8a29e", width: 14, height: 14 },
      style: { stroke: "#a8a29e", strokeWidth: 1.2, strokeDasharray: "2 4", opacity: dim ? 0.1 : 0.8 },
    });
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(undefined)}
      nodesConnectable={false}
      minZoom={0.05}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} color="#e7e5e4" />
      <Controls showInteractive={false} />
      {extras.bands && (
        <ViewportPortal>
          {extras.bands.map((b) => (
            <div
              key={b.label}
              className="pointer-events-none absolute -z-10 rounded-xl border border-dashed border-cyan-300 bg-cyan-50/60"
              style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.width, height: b.height }}
            >
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-700">{b.label}</div>
            </div>
          ))}
        </ViewportPortal>
      )}
      {view.viewType === "evidence" && positions.size > 0 && <EvidenceHeadings positions={positions} />}
      {extras.ticks && positions.size > 0 && (
        <ViewportPortal>
          {extras.ticks.map((t) => (
            <div
              key={t.label}
              className="pointer-events-none absolute text-sm font-semibold text-stone-400"
              style={{ transform: `translate(${t.x}px, -40px) translateX(-50%)` }}
            >
              {t.label}
            </div>
          ))}
        </ViewportPortal>
      )}
    </ReactFlow>
  );
}

function EvidenceHeadings({ positions }: { positions: Positions }) {
  const top = Math.min(...[...positions.values()].map((p) => p.y)) - 80;
  const heads = [
    { x: -430, label: "Supports", cls: "text-indigo-600" },
    { x: 0, label: "Claims", cls: "text-yellow-700" },
    { x: 430, label: "Challenges", cls: "text-amber-700" },
  ];
  return (
    <ViewportPortal>
      {heads.map((h) => (
        <div
          key={h.label}
          className={clsx("pointer-events-none absolute text-sm font-semibold uppercase tracking-wider", h.cls)}
          style={{ transform: `translate(${h.x}px, ${top}px) translateX(-50%)` }}
        >
          {h.label}
        </div>
      ))}
    </ViewportPortal>
  );
}
