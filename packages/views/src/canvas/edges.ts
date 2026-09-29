// How a canvas View draws its Relationships as React Flow edges. Which lines
// are drawn comes from drawnRelationships (../drawn.ts), which the layout
// metrics share, so they measure what the reader sees.
import { MarkerType, type Edge } from "@xyflow/react";
import type { CauseEffectSettings, RelationshipTypeDef } from "../model.ts";
import { sign, type Scope, type Trace } from "../scope.ts";
import { drawnRelationships } from "../drawn.ts";
import type { Overlay } from "../overlay.ts";
import { paletteColor } from "./color.ts";

// canvas.css points these at @umbel/ui tokens (light and dark).
export const edgeColor = {
  default: "var(--umbel-edge)",
  raises: "var(--umbel-edge-raises)",
  lowers: "var(--umbel-edge-lowers)",
  bridge: "var(--umbel-edge-bridge)",
};

export function buildEdges(args: {
  scope: Scope;
  ce?: CauseEffectSettings;
  relTypes: Map<string, RelationshipTypeDef>;
  shown: (id: string) => boolean;
  tr?: Trace;
  selected?: string;
  lit?: Set<string>;
  matches?: Set<string>;
  overlay?: Overlay;
}): Edge[] {
  const { scope, ce, relTypes, shown, tr, selected, lit, matches, overlay } = args;
  const edges: Edge[] = drawnRelationships(scope, ce, { shown, tr, selected }).map((r, i) => {
    const t = relTypes.get(r.type);
    const touches = !!selected && (r.from === selected || r.to === selected);
    const on = tr ? tr.edges.has(r) : lit && overlay ? lit.has(r.from) && lit.has(r.to) : touches;
    const dim = (matches && !(matches.has(r.from) && matches.has(r.to))) || ((overlay ? lit : selected) && !on);
    // Cause & Effect carries the sign in colour: raises vs lowers. Elsewhere
    // the Relationship Type's colour (Expedition data) is used.
    const color = ce ? (sign(ce, r.type) > 0 ? edgeColor.raises : edgeColor.lowers) : (paletteColor(t?.color) ?? edgeColor.default);
    return {
      id: `${r.from}-${r.type}-${r.to}-${i}`,
      source: r.from,
      target: r.to,
      type: "floating",
      className: r.synthetic ? "umbel-edge--lever" : undefined,
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
      className: "umbel-edge--bridge",
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor.bridge, width: 14, height: 14 },
      style: { stroke: edgeColor.bridge, strokeWidth: 1.2, strokeDasharray: "2 4", opacity: dim ? 0.1 : 0.8 },
    });
  }
  return edges;
}
