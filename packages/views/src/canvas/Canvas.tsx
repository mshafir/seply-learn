// The React Flow canvas for graph-drawn Views. It renders what the pure
// layout functions compute and tweens Concepts by id when the layout changes.
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Background, Controls, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type Node } from "@xyflow/react";
import { timer } from "d3-timer";
import { interpolateNumber } from "d3-interpolate";
import type { Expedition, View } from "../model.ts";
import { layout, nodeSize, EVIDENCE_COLUMN, type Extras, type Positions } from "../layouts.ts";
import { topicRoots, trace, type Scope } from "../scope.ts";
import { badgesFor, type Overlay } from "../overlay.ts";
import { buildEdges } from "./edges.ts";
import { useInheritedColorMode } from "./colorMode.ts";
import { cx, edgeTypes, nodeTypes, type ConceptData } from "./parts.tsx";

export type CanvasProps = {
  expedition: Expedition;
  view: View;
  scope: Scope;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
  overlay?: Overlay;
  /** Tween length in ms when the layout changes (0 to jump). */
  transitionMs?: number;
  /** Called once a layout has settled and the view is fitted. */
  onSettled?: () => void;
  /**
   * Where the last canvas drew each Concept. Shared across View switches (see
   * ExpeditionView), so a newly mounted canvas tweens Concepts from where the
   * previous View had them. Held in memory only; positions are never stored.
   */
  memory?: PositionMemory;
  /** Concepts the reader has read or knows: drawn with a check. */
  covered?: ReadonlySet<string>;
};

/** The last drawn positions, by Concept id; kept by whoever switches Views. */
export type PositionMemory = { current: Positions };

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function Inner({ expedition, view, scope, selected, onSelect, matches, overlay, transitionMs = 650, onSettled, memory, covered }: CanvasProps) {
  // After a View switch, the Concepts the two Views share start where the
  // last one drew them, then glide.
  const [positions, setPositions] = useState<Positions>(() => memory?.current ?? new Map());
  const [extras, setExtras] = useState<Extras>({});
  const own = useRef<Positions>(new Map());
  const current = memory ?? own;
  // What the last finished layout was for (View and visible set). A new View,
  // or a change in what's visible, refits the view; new data alone reflows in place.
  const laidOut = useRef<string | undefined>(undefined);
  const flowRef = useRef<HTMLDivElement>(null);
  const colorMode = useInheritedColorMode(flowRef);
  const { fitView } = useReactFlow();
  const fitIds = overlay?.fit?.join(",");
  const isLearningPath = view.viewType === "learning-path";
  // The Learning path lays out only what is visible, so it re-runs when that changes.
  const hiddenKey = isLearningPath && overlay ? [...overlay.hidden].sort().join(",") : "";
  const topics = useMemo(() => (isLearningPath ? topicRoots(expedition) : undefined), [expedition, isLearningPath]);

  const fit = useEffectEvent((duration: number) =>
    fitView({ duration, padding: 0.12, maxZoom: 1.4, nodes: fitIds ? fitIds.split(",").map((id) => ({ id })) : undefined }),
  );
  const settled = useEffectEvent(() => onSettled?.());
  const visibleNow = useEffectEvent(() =>
    isLearningPath && overlay ? { hidden: overlay.hidden, bridges: overlay.bridges, topics } : undefined,
  );

  // Wait a beat: selecting often opens the side panel, which resizes the canvas.
  useEffect(() => {
    if (!current.current.size) return;
    const t = setTimeout(() => fit(500), 80);
    return () => clearTimeout(t);
  }, [fitIds, current]);

  // Lay out, then animate every Concept from where it was to where it goes.
  // Runs again whenever the data changes (an edit, or someone else's arriving
  // by pull): Concepts glide to their new places and nothing blinks.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const key = `${view.id}\n${hiddenKey}`;
    layout(scope, view, visibleNow()).then(({ positions: next, extras }) => {
      if (cancelled) return;
      const refit = laidOut.current !== key;
      laidOut.current = key;
      setExtras((was) => (sameExtras(was, extras) ? was : extras));
      const from = current.current;
      // A reflow that moves nothing (say, a title edit) just redraws.
      if (!refit && samePositions(from, next)) {
        setPositions(from);
        return;
      }
      const interp = [...next].map(([id, p]) => {
        const f = from.get(id) ?? p;
        return [id, interpolateNumber(f.x, p.x), interpolateNumber(f.y, p.y)] as const;
      });
      const t = timer((elapsed) => {
        const k = transitionMs > 0 ? Math.min(1, elapsed / transitionMs) : 1;
        const e = ease(k);
        const frame: Positions = new Map(interp.map(([id, ix, iy]) => [id, { x: ix(e), y: iy(e) }]));
        current.current = frame;
        setPositions(frame);
        if (k >= 1) {
          t.stop();
          if (refit) fit(transitionMs > 0 ? 500 : 0);
          setTimeout(() => settled(), transitionMs > 0 ? 550 : 50);
        }
      });
      stop = () => t.stop();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [scope, view, hiddenKey, transitionMs, current]);

  const kinds = useMemo(() => new Map(expedition.kinds.map((k) => [k.id, k])), [expedition]);
  const relTypes = useMemo(() => new Map(expedition.relationshipTypes.map((t) => [t.id, t])), [expedition]);

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
    return new Set([
      selected,
      ...scope.relationships.filter((r) => r.from === selected || r.to === selected).flatMap((r) => [r.from, r.to]),
    ]);
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
          covered: !!covered?.has(c.id),
          badges: overlay ? (overlay.badges.get(c.id) ?? []) : badgesFor(view, scope, c, tr),
        },
      };
    });

  const edges = buildEdges({ scope, ce, relTypes, shown, tr, selected, lit, matches, overlay });

  return (
    <ReactFlow
      ref={flowRef}
      colorMode={colorMode}
      className="umbel-canvas"
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
      <Background gap={24} color="var(--umbel-canvas-grid)" />
      <Controls showInteractive={false} />
      {extras.bands && (
        <ViewportPortal>
          {extras.bands.map((b) => (
            <div
              key={b.label}
              className="umbel-band"
              style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.width, height: b.height }}
            >
              <div className="umbel-band__label">{b.label}</div>
            </div>
          ))}
        </ViewportPortal>
      )}
      {view.viewType === "evidence" && positions.size > 0 && <EvidenceHeadings positions={positions} />}
      {extras.ticks && positions.size > 0 && (
        <ViewportPortal>
          {extras.ticks.map((t) => (
            <div key={t.label} className="umbel-tick" style={{ transform: `translate(${t.x}px, -40px) translateX(-50%)` }}>
              {t.label}
            </div>
          ))}
        </ViewportPortal>
      )}
    </ReactFlow>
  );
}

const samePositions = (a: Positions, b: Positions) =>
  a.size === b.size &&
  [...b].every(([id, p]) => {
    const q = a.get(id);
    return !!q && Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5;
  });
const sameExtras = (a: Extras, b: Extras) => JSON.stringify(a) === JSON.stringify(b);

function EvidenceHeadings({ positions }: { positions: Positions }) {
  const top = Math.min(...[...positions.values()].map((p) => p.y)) - 80;
  const heads = [
    { x: -EVIDENCE_COLUMN, label: "Supports", tone: "supports" },
    { x: 0, label: "Claims", tone: "claims" },
    { x: EVIDENCE_COLUMN, label: "Challenges", tone: "challenges" },
  ];
  return (
    <ViewportPortal>
      {heads.map((h) => (
        <div
          key={h.label}
          className={cx("umbel-heading", `umbel-heading--${h.tone}`)}
          style={{ transform: `translate(${h.x}px, ${top}px) translateX(-50%)` }}
        >
          {h.label}
        </div>
      ))}
    </ViewportPortal>
  );
}
