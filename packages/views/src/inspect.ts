// What a reader sees in one View, as text, with its layout metrics: the
// ViewReader the curator agent's `view.inspect` reads (spec §5.3, §4.4).
// Exported on its own as `@seply/views/inspect`, with no React, so the apps
// that run the curator job can use it without the renderers.
import { isLive, type DomainState } from "@seply/domain";
import { expeditionFromRows } from "./data.ts";
import { layoutMetrics, type LayoutMetrics } from "./metrics.ts";
import type { Concept, Expedition, View } from "./model.ts";
import { learningMap, leversOf, readingOrder, learningScope, scopeFor, sign, topicRoots, trace } from "./scope.ts";
import { comparisonTable, type TableCell } from "./table.ts";
import { outlineTree, type OutlineItem } from "./outline/outline.ts";
import { quadrantGrid } from "./quadrant/quadrant.ts";
import { rateLabel, ratesModel } from "./rates/rates.ts";
import { anatomy, type AnatomyPart } from "./anatomy/anatomy.ts";
import { mapModel } from "./map/pins.ts";
import { timelineModel } from "./timeline/items.ts";
import { withoutHidden } from "./hidden.ts";

export type ViewReading = {
  /** The View as text, as a reader first sees it. */
  text: string;
  /** Canvas Views only (spec §4.4). */
  layout?: LayoutMetrics;
};

/** Lines past this are cut, with a count of what was left out. */
export const MAX_LINES = 250;

/** The Expedition the Views draw, from a domain state (live entities only). */
export function expeditionFromState(s: DomainState): Expedition {
  const live = <T extends { deletedAt: string | null }>(r: Record<string, T>) => Object.values(r).filter(isLive);
  return expeditionFromRows({
    expedition: s.expedition,
    concepts: live(s.concepts),
    relationships: live(s.relationships),
    kindDefs: Object.values(s.kinds),
    relTypeDefs: Object.values(s.relTypes),
    attributeDefs: live(s.attributes),
    views: live(s.views),
  });
}

/** Reads one View of a state the way a reader sees it. Throws for a View that isn't there. */
export async function readView(state: DomainState, viewId: string): Promise<ViewReading> {
  const expedition = expeditionFromState(state);
  const view = expedition.views.find((v) => v.id === viewId);
  if (!view) throw new Error(`View ${viewId} not found`);
  const shown = withoutHidden(expedition, view);
  const lines = [`${view.label} (${view.viewType})${view.description ? `: ${view.description}` : ""}`, ...render(shown, view)];
  const text =
    lines.length > MAX_LINES
      ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more lines`].join("\n")
      : lines.join("\n");
  const layout = await layoutMetrics(shown, view);
  return layout ? { text, layout } : { text };
}

function render(e: Expedition, view: View): string[] {
  const byId = new Map(e.concepts.map((c) => [c.id, c]));
  const t = (id: string) => byId.get(id)?.title ?? id;
  switch (view.viewType) {
    case "comparison-table": {
      const m = comparisonTable(e, view.settings);
      const head = m.columns.map((c) => (c.band ? `${c.label} [${c.band}]` : c.label));
      const cell = (c: TableCell) =>
        c.kind === "fact"
          ? c.text
          : c.kind === "no-fact"
            ? "—"
            : c.kind === "unknown"
              ? "?"
              : `${c.tone}${c.relationship.note ? ` (${c.relationship.note})` : ""}`;
      return [
        `${m.rows.length} rows × ${m.columns.length} columns: ${head.join(" | ")}`,
        ...m.rows.map(
          (r) =>
            `- ${r.concept.title}${r.standing ? ` [${r.standing}]` : ""}${r.failsMustHave ? " [fails a must-have]" : ""}: ` +
            m.columns.map((c, i) => `${c.label}: ${cell(r.cells[i])}`).join("; "),
        ),
        ...(m.dropped.length ? [`Dropped criteria: ${m.dropped.map((c) => c.title).join(", ")}`] : []),
      ];
    }
    case "outline": {
      const m = outlineTree(e, view.settings);
      const walk = (items: OutlineItem[], depth: number): string[] =>
        items.flatMap((i) => [
          `${"  ".repeat(depth)}- ${i.concept.title}${i.folded.length ? ` [+ ${i.folded.map((f) => f.title).join(", ")}]` : ""}`,
          ...walk(i.children, depth + 1),
        ]);
      return [...walk(m.roots, 0), ...(m.unsorted.length ? ["Unsorted:", ...walk(m.unsorted, 1)] : [])];
    }
    case "learning-path": {
      const m = learningMap(e, view.settings);
      const topics = topicRoots(e);
      const targets = [...m.targets].sort((a, b) => b[1] - a[1] || t(a[0]).localeCompare(t(b[0])));
      const foundations = [...m.core].filter((id) => !m.targets.has(id));
      return [
        `${m.targets.size} targets, ${foundations.length} shared foundations, ${m.scope.concepts.length - m.core.size} auxiliary steps`,
        `Foundations: ${foundations.map(t).join(", ") || "none"}`,
        ...targets.map(([id, n]) => {
          const path = readingOrder(learningScope(e, view.settings.relationshipTypes, id, new Set())).filter((x) => x !== id);
          const topic = topics.get(id)?.title;
          return `- To understand ${t(id)}${topic ? ` (${topic})` : ""}: ${n} steps first: ${path.map(t).join(" → ")}`;
        }),
      ];
    }
    case "cause-and-effect": {
      const s = view.settings;
      const scope = scopeFor(e, view);
      const levers = leversOf(scope, s);
      const out = s.outcomes.map((o) => {
        const tr = trace(s, scope.relationships, o);
        const causes = [...tr.upstream].filter(([id]) => !levers.has(id));
        return `Outcome: ${t(o)}. Causes: ${causes.map(([id, n]) => `${t(id)} (${n.sign} it)`).join(", ") || "none"}`;
      });
      const rank = (c: Concept) => (s.rankBy ? Number(c.attributes?.[s.rankBy] ?? Infinity) : 0);
      const ranked = [...levers].map((id) => byId.get(id)!).sort((a, b) => rank(a) - rank(b));
      return [
        ...out,
        `Levers${s.rankBy ? ` by ${s.rankBy}` : ""}:`,
        ...ranked.map((c) => {
          const acts = scope.relationships.filter((r) => r.from === c.id);
          const effect = s.outcomes.map((o) => trace(s, scope.relationships, c.id).downstream.get(o)?.sign).filter(Boolean);
          const folded = scope.folded.get(c.id);
          return (
            `- ${c.title}: acts on ${acts.map((r) => `${t(r.to)} (${sign(s, r.type) > 0 ? "raises" : "lowers"})`).join(", ")}` +
            (effect.length ? `; net effect on the outcome: ${effect.join(", ")}` : "") +
            (folded ? `; build steps: ${folded.map((f) => f.title).join(", ")}` : "")
          );
        }),
      ];
    }
    case "evidence": {
      const s = view.settings;
      const scope = scopeFor(e, view);
      const claims = scope.concepts.filter((c) => s.claimKinds.includes(c.kind));
      const list = (id: string, types: string[]) =>
        scope.relationships.filter((r) => r.to === id && types.includes(r.type)).map((r) => t(r.from));
      return claims.map((c) => {
        const sup = list(c.id, s.supports);
        const ch = list(c.id, s.challenges);
        const cons = s.consensus ? c.attributes?.[s.consensus] : undefined;
        return `- Claim: ${c.title}${cons ? ` [${cons}]` : ""}. Supported by: ${sup.join(", ") || "nothing"}. Challenged by: ${ch.join(", ") || "nothing"}`;
      });
    }
    case "lineage": {
      const scope = scopeFor(e, view);
      const dated = [...scope.concepts].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      return dated.map((c) => {
        const led = scope.relationships.filter((r) => r.from === c.id).map((r) => t(r.to));
        return `- ${c.date} ${c.title}${led.length ? ` → ${led.join(", ")}` : ""}`;
      });
    }
    case "quadrant": {
      const m = quadrantGrid(e, view.settings);
      return [
        `${m.placed} placed; x: ${m.x.label}, y: ${m.y.label}`,
        ...m.y.values.flatMap((yv, yi) =>
          m.x.values.map((xv, xi) => `- ${yv.label} × ${xv.label}: ${m.cells[yi][xi].map((c) => c.concept.title).join(", ") || "(empty)"}`),
        ),
      ];
    }
    case "rates": {
      const m = ratesModel(e, view.settings);
      return m.groups.flatMap((g) => [
        `${g.quantity}:`,
        ...g.estimates.map(
          (r) =>
            `  - ${r.concept.title}: ${rateLabel(r.lo)}${r.hi !== r.lo ? `–${rateLabel(r.hi)}` : ""} (${r.direction})` +
            (r.source ? `, from ${r.source.title}${r.independence ? ` [${r.independence}]` : ""}` : ""),
        ),
      ]);
    }
    case "anatomy": {
      const m = anatomy(e, view.settings);
      const walk = (parts: AnatomyPart[]): string[] =>
        parts.flatMap((p) => [
          `${"  ".repeat(p.depth)}- ${p.concept.title}${p.pins.length ? ` [pins: ${p.pins.map((c) => c.title).join(", ")}]` : ""}`,
          ...walk(p.parts),
        ]);
      return [...walk(m.roots), ...(m.unplaced.length ? [`Unplaced pins: ${m.unplaced.map((c) => c.title).join(", ")}`] : [])];
    }
    case "map": {
      const m = mapModel(e, view);
      return [
        ...m.pins.map((p) => `- ${p.title}${p.home ? " [home]" : ""}${p.via ? ` (in ${t(p.via)})` : ""}: ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`),
        ...(m.unplaced.length ? [`No location: ${m.unplaced.map(t).join(", ")}`] : []),
      ];
    }
    case "timeline": {
      const m = timelineModel(e, view);
      return [
        ...m.lanes.flatMap((l) => {
          const items = m.items.filter((i) => i.lane === l.id);
          return items.length ? [`${l.label}:`, ...items.map((i) => `  - ${i.when} ${i.title}`)] : [];
        }),
        ...(m.undated.length ? [`Undated: ${m.undated.map(t).join(", ")}`] : []),
      ];
    }
  }
}
