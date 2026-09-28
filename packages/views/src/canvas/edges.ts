// Which Relationships a canvas View draws, and how. Pure, so risk mode's
// lever edges can be tested without a DOM.
import { MarkerType, type Edge } from "@xyflow/react";
import type { CauseEffectSettings, Relationship, RelationshipTypeDef } from "../model.ts";
import { leversOf, sign, type Scope, type Trace } from "../scope.ts";
import type { Overlay } from "../overlay.ts";

// TODO(tokens): wire these to @umbel/ui tokens once they land. canvas.css
// defines the variables with fallbacks.
export const edgeColor = {
  default: "var(--umbel-edge)",
  raises: "var(--umbel-edge-raises)",
  lowers: "var(--umbel-edge-lowers)",
  bridge: "var(--umbel-edge-bridge)",
};

export type DrawnRelationship = Relationship & { synthetic?: boolean };

/**
 * Risk mode: a lever's real edges are drawn only while its path is traced;
 * by default each lever points straight at the outcome, keeping the ranked
 * column readable as a priority list. The data keeps the accurate links.
 */
export function drawnRelationships(
  scope: Scope,
  ce: CauseEffectSettings | undefined,
  opts: { shown: (id: string) => boolean; tr?: Trace; selected?: string },
): DrawnRelationship[] {
  const { shown, tr, selected } = opts;
  const riskLevers = ce?.mode === "risk" ? leversOf(scope, ce) : new Set<string>();
  const outcome = ce?.mode === "risk" ? ce.outcomes[0] : undefined;
  const drawn = scope.relationships.filter(
    (r) => shown(r.from) && shown(r.to) && (!riskLevers.has(r.from) || r.to === outcome || (tr && tr.edges.has(r))),
  );
  const direct = new Set(drawn.filter((r) => riskLevers.has(r.from) && r.to === outcome).map((r) => r.from));
  const synthetic: DrawnRelationship[] = [...riskLevers]
    .filter((id) => !direct.has(id) && !(tr && selected === id) && outcome)
    .map((id) => ({ from: id, to: outcome!, type: ce!.negative[0] ?? "lowers", synthetic: true }));
  return [...drawn, ...synthetic];
}

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
    const color = ce ? (sign(ce, r.type) > 0 ? edgeColor.raises : edgeColor.lowers) : (t?.color ?? edgeColor.default);
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
