// A canvas View drawn frame by frame: @seply/views' own Concept cards and
// lines (nodeTypes, edgeTypes, buildEdges) in React Flow, at positions the
// scene computes from the real layout for this frame. The app's Canvas tweens
// with a timer; a video frame has to be a pure function of the frame instead.
import { useMemo, type ReactNode } from "react";
import { Background, ReactFlow, ReactFlowProvider, type Node } from "@xyflow/react";
import {
  badgesFor,
  buildEdges,
  edgeTypes,
  nodeSize,
  nodeTypes,
  type ConceptData,
  type Expedition,
  type Overlay,
  type Positions,
  type Scope,
  type View,
} from "@seply/views";

export type Viewport = { x: number; y: number; zoom: number };

export type FlowStageProps = {
  expedition: Expedition;
  view: View;
  scope: Scope;
  overlay?: Overlay;
  /** Where each Concept's centre is this frame (flow coordinates). */
  positions: Positions;
  viewport: Viewport;
  width: number;
  height: number;
  /** How far in each Concept is (0 hidden … 1 drawn). Default 1. */
  shown?: (id: string) => number;
  /** How far each line has drawn (0 … 1). Default: in with its later end. */
  drawn?: (from: string, to: string) => number;
  selected?: string;
  suggested?: { concepts: ReadonlySet<string>; relationships: ReadonlySet<string> };
  /** Screen-space layers over the canvas (labels, cursors). */
  children?: ReactNode;
};

/** The viewport that fits these Concepts into width × height. */
export function fitViewport(scope: Scope, positions: Positions, width: number, height: number, pad = 48, maxZoom = 1.2): Viewport {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of scope.concepts) {
    const p = positions.get(c.id);
    if (!p) continue;
    const s = nodeSize(scope.weights.get(c.id) ?? 0, c.title);
    x0 = Math.min(x0, p.x - s.width / 2);
    x1 = Math.max(x1, p.x + s.width / 2);
    y0 = Math.min(y0, p.y - s.height / 2);
    y1 = Math.max(y1, p.y + s.height / 2);
  }
  const zoom = Math.min((width - 2 * pad) / (x1 - x0), (height - 2 * pad) / (y1 - y0), maxZoom);
  return { zoom, x: width / 2 - ((x0 + x1) / 2) * zoom, y: height / 2 - ((y0 + y1) / 2) * zoom };
}

export const toScreen = (vp: Viewport, p: { x: number; y: number }) => ({ x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y });

export function FlowStage(props: FlowStageProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

const noop = () => {};

function Inner({ expedition, view, scope, overlay, positions, viewport, width, height, shown, drawn, selected, suggested, children }: FlowStageProps) {
  const kinds = useMemo(() => new Map(expedition.kinds.map((k) => [k.id, k])), [expedition]);
  const relTypes = useMemo(() => new Map(expedition.relationshipTypes.map((t) => [t.id, t])), [expedition]);
  const alpha = (id: string) => (shown ? shown(id) : 1);

  const nodes: Node<ConceptData>[] = scope.concepts
    .filter((c) => positions.has(c.id) && alpha(c.id) > 0)
    .map((c) => {
      const w = scope.weights.get(c.id) ?? 0;
      const size = nodeSize(w, c.title);
      const p = positions.get(c.id)!;
      const a = alpha(c.id);
      return {
        id: c.id,
        type: "concept",
        // Cards rise a few pixels as they fade in.
        position: { x: p.x - size.width / 2, y: p.y - size.height / 2 + (1 - a) * 14 },
        measured: size,
        style: { opacity: a },
        data: {
          concept: c,
          kind: kinds.get(c.kind),
          weight: w,
          dim: false,
          selected: c.id === selected,
          suggested: !!suggested?.concepts.has(c.id),
          badges: overlay ? (overlay.badges.get(c.id) ?? []) : badgesFor(view, scope, c),
        },
      };
    });

  const edges = buildEdges({
    scope,
    relTypes,
    shown: (id) => !overlay?.hidden.has(id) && alpha(id) > 0,
    overlay,
    suggested: suggested?.relationships,
  }).map((e) => {
    const k = drawn ? drawn(e.source, e.target) : Math.min(alpha(e.source), alpha(e.target));
    if (k >= 1) return e;
    // Drawing: a dash as long as the gap between the centres, slid in.
    const a = positions.get(e.source)!;
    const b = positions.get(e.target)!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      ...e,
      markerEnd: k > 0.9 ? e.markerEnd : undefined,
      style: { ...e.style, strokeDasharray: `${len} ${len}`, strokeDashoffset: len * (1 - k), opacity: k > 0 ? e.style?.opacity : 0 },
    };
  });

  return (
    <div style={{ position: "relative", width, height }}>
      <ReactFlow
        className="seply-canvas"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={viewport}
        onViewportChange={noop}
        nodesConnectable={false}
        nodesDraggable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} color="var(--seply-canvas-grid)" />
      </ReactFlow>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{children}</div>
    </div>
  );
}
