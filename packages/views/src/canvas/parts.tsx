// The canvas's node and edge components.
import { CircleCheckIcon } from "lucide-react";
import { BaseEdge, Handle, Position, useInternalNode, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import type { Concept, KindDef } from "../model.ts";
import { nodeSize } from "../layouts.ts";
import type { Badge } from "../overlay.ts";
import { KindIcon } from "./KindIcon.tsx";
import { paletteColor } from "./color.ts";

export const cx = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(" ");

/** The check on a Concept the reader has read or knows, in every View. */
export const ReadCheck = () => <CircleCheckIcon className="seply-check" role="img" aria-label="Read" data-testid="read-check" />;

export type ConceptData = {
  concept: Concept;
  kind?: KindDef;
  weight: number;
  dim: boolean;
  selected: boolean;
  /** Appearing in the current reflow: fades in as the others arrive. */
  entering?: boolean;
  /** The reader has read or knows it: a check. */
  covered?: boolean;
  badges: Badge[];
};

/** Size class by weight: focal (outcome), major, medium, minor. */
const weightClass = (w: number) =>
  w > 1 ? "seply-concept--focal" : w > 0.6 ? "seply-concept--major" : w > 0.3 ? "seply-concept--medium" : "seply-concept--minor";

export function ConceptNode({ data }: NodeProps<Node<ConceptData>>) {
  const { concept, kind, weight, dim, selected, entering, covered, badges } = data;
  const size = nodeSize(weight, concept.title);
  return (
    <div
      title={concept.summary}
      // The Kind's accent colour is Expedition data, not a UI colour.
      style={{ width: size.width, minHeight: size.height, borderLeftColor: paletteColor(kind?.color) }}
      className={cx(
        "seply-concept",
        weightClass(weight),
        dim && "seply-concept--dim",
        selected && "seply-concept--selected",
        entering && "seply-concept--entering",
      )}
      data-concept={concept.id}
      data-covered={covered || undefined}
    >
      <Handle type="target" position={Position.Left} className="seply-handle" />
      <KindIcon name={kind?.icon ?? kind?.id} className="seply-concept__icon" style={{ color: paletteColor(kind?.color) }} />
      <span className="seply-concept__title">{concept.title}</span>
      {covered && <ReadCheck />}
      {badges.length > 0 && (
        <div className="seply-concept__badges">
          {badges.map((b) => (
            <span key={b.text} className={cx("seply-badge", `seply-badge--${b.tone}`)}>
              {b.text}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="seply-handle" />
    </div>
  );
}

// Straight edge between node borders, so it reads the same in every layout.
export function FloatingEdge({ id, source, target, markerEnd, style, label }: EdgeProps) {
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
      labelStyle={{ fontSize: 11, fill: "var(--seply-canvas-label)" }}
      labelBgStyle={{ fill: "var(--seply-canvas-bg)" }}
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

export const nodeTypes = { concept: ConceptNode };
export const edgeTypes = { floating: FloatingEdge };
