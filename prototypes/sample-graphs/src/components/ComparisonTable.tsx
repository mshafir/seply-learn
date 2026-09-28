import clsx from "clsx";
import type { ComparisonTableSettings, Concept, Graph } from "../lib/types";
import { matchesFilter } from "../lib/view";
import { KindIcon } from "./icons";

type Column =
  | { key: string; group: string; attribute: string }
  | { key: string; group: string; concept: Concept };

const groupOrder = ["Facts", "Must-haves", "Nice-to-haves", "Criteria"];

// Comparison Table View Type (docs/view-types/comparison-table.md): options
// down the side, what matters across the top. A criterion cell is the row's
// Relationship to that criterion, with its note as the text; no Relationship
// is "?", research still to do.
export function ComparisonTable({
  graph,
  settings: s,
  selected,
  onSelect,
  matches,
}: {
  graph: Graph;
  settings: ComparisonTableSettings;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
}) {
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));
  const attrs = new Map((graph.attributes ?? []).map((a) => [a.id, a]));
  const relTypes = new Map(graph.relationshipTypes.map((t) => [t.id, t]));
  const kinds = new Map(graph.kinds.map((k) => [k.id, k]));

  const num = (c: Concept) => {
    const v = s.sortBy ? c.attributes?.[s.sortBy] : undefined;
    return typeof v === "number" ? v : Number.POSITIVE_INFINITY;
  };
  const rows = graph.concepts
    .filter((c) => matchesFilter(c, s.rows))
    .sort((a, b) => (num(a) === num(b) ? 0 : num(a) < num(b) ? -1 : 1));
  const rowIds = new Set(rows.map((r) => r.id));

  const priority = (c: Concept) => (s.priority ? String(c.attributes?.[s.priority] ?? "") : "");
  const dropped: Concept[] = [];
  const criterionGroup = (c: Concept) =>
    priority(c) === "hard" ? "Must-haves" : priority(c) === "nice" ? "Nice-to-haves" : "Criteria";
  const listed: Column[] = s.columns.flatMap((col): Column[] => {
    if ("attribute" in col) return [{ key: col.attribute, group: "Facts", attribute: col.attribute }];
    if ("concept" in col) {
      const c = byId.get(col.concept)!;
      return [{ key: col.concept, group: c.kind === "criterion" ? criterionGroup(c) : "", concept: c }];
    }
    // criteria: auto — every criterion the rows have a verdict on, dropped ones left out
    const ids = new Set(graph.relationships.filter((r) => rowIds.has(r.from)).map((r) => r.to));
    const criteria = graph.concepts.filter((c) => c.kind === "criterion" && ids.has(c.id));
    dropped.push(...criteria.filter((c) => priority(c) === "dropped"));
    return criteria
      .filter((c) => priority(c) !== "dropped")
      .map((c) => ({ key: c.id, group: criterionGroup(c), concept: c }))
      .sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));
  });
  // Criterion columns listed one by one are banded like "criteria: auto": each run of them is
  // ordered must-haves first, so the band above the headers reads cleanly.
  const isCriterion = (c: Column) => c.group !== "Facts" && groupOrder.includes(c.group);
  const columns: Column[] = [];
  for (let i = 0; i < listed.length; ) {
    if (!isCriterion(listed[i])) columns.push(listed[i++]);
    else {
      const run: Column[] = [];
      while (i < listed.length && isCriterion(listed[i])) run.push(listed[i++]);
      columns.push(...run.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group)));
    }
  }
  const groups: { label: string; span: number }[] = [];
  for (const c of columns) {
    const last = groups[groups.length - 1];
    if (last && last.label === c.group) last.span++;
    else groups.push({ label: c.group, span: 1 });
  }
  const showGroups = columns.some((c) => c.group === "Must-haves" || c.group === "Nice-to-haves");

  const standing = (c: Concept) => (s.standing ? String(c.attributes?.[s.standing] ?? "") : "");

  // A fail on a must-have is what knocks an option out: tint it.
  const failsMustHave = (row: Concept, col: Column) =>
    "concept" in col &&
    col.group === "Must-haves" &&
    graph.relationships.some((r) => r.from === row.id && r.to === col.concept.id && r.type === "fails");

  const header = (col: Column) => ("attribute" in col ? attrs.get(col.attribute)?.label ?? col.attribute : col.concept.title);

  const cell = (row: Concept, col: Column) => {
    if ("attribute" in col) {
      const v = row.attributes?.[col.attribute];
      const def = attrs.get(col.attribute);
      if (v === undefined) return <span className="text-stone-300">—</span>;
      if (def?.type === "money" && typeof v === "number") return <span className="tabular-nums">${v.toLocaleString()}</span>;
      if (typeof v === "boolean") return v ? "✓" : "✗";
      return <span className={clsx(typeof v === "number" && "tabular-nums")}>{`${v}${def?.unit ? ` ${def.unit}` : ""}`}</span>;
    }
    const rel = graph.relationships.find((r) => r.from === row.id && r.to === col.concept.id);
    if (!rel) return <span className="font-medium text-stone-300" title="Not researched">?</span>;
    const t = relTypes.get(rel.type);
    return (
      <span title={rel.note ? `${t?.label}: ${rel.note}` : t?.label} className="inline-flex items-baseline gap-1.5">
        <span className="inline-block size-2.5 shrink-0 translate-y-px rounded-full" style={{ background: t?.color }} />
        <span className="line-clamp-2">
          <span className="font-medium" style={{ color: t?.color }}>{t?.label}</span>
          {rel.note && <span className="text-stone-500"> · {rel.note}</span>}
        </span>
      </span>
    );
  };

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-stone-50">
          {showGroups && (
            <tr>
              <th className="sticky left-0 z-30 bg-stone-50" />
              {groups.map((g, i) => (
                <th
                  key={i}
                  colSpan={g.span}
                  className={clsx(
                    "px-2 pt-3 text-left text-[11px] font-semibold uppercase tracking-wide",
                    g.label === "Must-haves" ? "text-rose-700" : g.label === "Nice-to-haves" ? "text-emerald-700" : "text-stone-400",
                  )}
                >
                  <div className={clsx(g.label && "border-b-2 pb-1", g.label === "Must-haves" ? "border-rose-300" : g.label === "Nice-to-haves" ? "border-emerald-300" : "border-stone-200")}>
                    {g.label}
                  </div>
                </th>
              ))}
            </tr>
          )}
          <tr>
            <th className="sticky left-0 z-30 border-b border-stone-300 bg-stone-50 p-2 pl-6 text-left font-semibold">Option</th>
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  "min-w-28 border-b border-stone-300 p-2 text-left align-bottom font-semibold",
                  "concept" in col && "cursor-pointer hover:underline",
                )}
                onClick={() => "concept" in col && onSelect(col.concept.id)}
              >
                {header(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = standing(r);
            const bg = r.id === selected ? "bg-amber-50" : st === "chosen" ? "bg-emerald-50" : "bg-white";
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={clsx(
                  "group cursor-pointer",
                  bg,
                  matches && !matches.has(r.id) ? "opacity-20" : st === "ruled-out" && "text-stone-400",
                )}
              >
                <td className={clsx("sticky left-0 z-10 min-w-64 border-b border-stone-200 p-2 pl-6 font-medium group-hover:bg-stone-100", bg, st === "chosen" && "shadow-[inset_4px_0_0_#059669]")}>
                  <span className="flex items-center gap-2">
                    <KindIcon name={kinds.get(r.kind)?.icon ?? r.kind} className="size-4 shrink-0" style={{ color: kinds.get(r.kind)?.color }} />
                    <span className={clsx(st === "ruled-out" ? "text-stone-400 line-through decoration-stone-300" : "text-stone-900")}>{r.title}</span>
                    {st === "chosen" && <span className="rounded-full bg-emerald-600 px-1.5 py-px text-[10px] font-semibold uppercase text-white">chosen</span>}
                  </span>
                </td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={clsx(
                      "max-w-64 border-b border-stone-200 p-2 align-top group-hover:bg-stone-100",
                      st === "ruled-out" ? "opacity-60" : "text-stone-700",
                      failsMustHave(r, col) && "bg-rose-50",
                    )}
                  >
                    {cell(r, col)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {dropped.length > 0 && (
        <p className="px-6 py-3 text-xs text-stone-500">
          Dropped along the way, so not shown:{" "}
          {dropped.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <button className="underline decoration-stone-300 hover:decoration-stone-700" onClick={() => onSelect(c.id)}>
                {c.title}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
