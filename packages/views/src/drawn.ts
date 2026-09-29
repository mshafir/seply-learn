// Which Relationships a canvas View draws. The renderer (canvas/edges.ts)
// and the layout metrics (metrics.ts) both read this list, so the metrics
// measure exactly the lines a reader sees. Pure: no React, no DOM.
import type { CauseEffectSettings, Relationship } from "./model.ts";
import { leversOf, type Scope, type Trace } from "./scope.ts";

/** A drawn line. `synthetic` marks a risk-mode lever→outcome line with no Relationship behind it. */
export type DrawnRelationship = Relationship & { synthetic?: boolean };

/**
 * Risk mode: a lever's real edges are drawn only while its path is traced;
 * by default each lever points straight at the outcome, keeping the ranked
 * column readable as a priority list. The data keeps the accurate links.
 * Other modes and View Types draw every Relationship whose ends are shown.
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
    .filter((id) => !direct.has(id) && !(tr && selected === id) && outcome && shown(id) && shown(outcome))
    .map((id) => ({ from: id, to: outcome!, type: ce!.negative[0] ?? "lowers", synthetic: true }));
  return [...drawn, ...synthetic];
}
