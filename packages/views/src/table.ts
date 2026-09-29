// Comparison Table, as data: which rows, which columns in which bands, and
// what each cell says (docs/view-types/comparison-table.md, spec §4.3). Pure,
// so the renderer only draws it. Ported from the prototype's
// `src/components/ComparisonTable.tsx`.
import type { AttributeDef, ComparisonTableSettings, Concept, Expedition, Relationship } from "./model.ts";
import { matchesFilter } from "./scope.ts";

/** A band of columns above the headers. Facts are Attributes; the rest are criteria by priority. */
export type TableBand = "Facts" | "Must-haves" | "Nice-to-haves" | "Criteria";
const BAND_ORDER: readonly TableBand[] = ["Facts", "Must-haves", "Nice-to-haves", "Criteria"];

export type TableColumn =
  | { key: string; band: TableBand; kind: "attribute"; attribute: string; label: string; def?: AttributeDef }
  | { key: string; band: TableBand | undefined; kind: "concept"; concept: Concept; label: string };

/** A verdict's tone: meets, partly meets, fails, or some other Relationship. */
export type VerdictTone = "meets" | "partly" | "fails" | "other";

export type TableCell =
  | { kind: "fact"; value: string | number | boolean; text: string; def?: AttributeDef }
  /** No value for this Attribute. */
  | { kind: "no-fact" }
  | { kind: "verdict"; relationship: Relationship; tone: VerdictTone }
  /** No verdict: research still to do ("?"). */
  | { kind: "unknown" };

export type Standing = "chosen" | "in-play" | "ruled-out" | undefined;

export type TableRow = {
  concept: Concept;
  standing: Standing;
  /** A fail on a must-have: the row is tinted. */
  failsMustHave: boolean;
  cells: TableCell[];
};

export type ComparisonTableModel = {
  columns: TableColumn[];
  /** Runs of columns in one band, left to right; only when must-haves or nice-to-haves exist. */
  bands: { band: TableBand | undefined; span: number }[] | undefined;
  rows: TableRow[];
  /** Criteria dropped along the way: listed under the table, not as columns. */
  dropped: Concept[];
};

/** A built-in id (`builtin:fails`) or a plain one (`fails`) by its name. */
const named = (id: string) => (id.startsWith("builtin:") ? id.slice("builtin:".length) : id);
const isCriterion = (c: Concept) => named(c.kind) === "criterion";
const VERDICT: Record<string, VerdictTone> = { meets: "meets", "partly-meets": "partly", partly: "partly", fails: "fails" };
export const verdictTone = (type: string): VerdictTone => VERDICT[named(type)] ?? "other";

export function comparisonTable(expedition: Expedition, s: ComparisonTableSettings): ComparisonTableModel {
  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const attrs = new Map((expedition.attributes ?? []).map((a) => [a.id, a]));
  const verdicts = expedition.relationships.filter((r) => verdictTone(r.type) !== "other");
  // Every Relationship from an option to a column Concept, first one wins.
  const cellRel = new Map<string, Relationship>();
  for (const r of [...verdicts, ...expedition.relationships]) {
    const k = `${r.from}\n${r.to}`;
    if (!cellRel.has(k)) cellRel.set(k, r);
  }

  // Rows: the live options, ordered by the sort Attribute (unknowns last).
  const sortValue = (c: Concept) => {
    const v = s.sortBy ? c.attributes?.[s.sortBy] : undefined;
    return typeof v === "number" ? v : Number.POSITIVE_INFINITY;
  };
  const rowConcepts = expedition.concepts
    .filter((c) => matchesFilter(c, s.rows))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => sortValue(a.c) - sortValue(b.c) || a.i - b.i)
    .map(({ c }) => c);
  const rowIds = new Set(rowConcepts.map((c) => c.id));

  const priority = (c: Concept) => (s.priority ? String(c.attributes?.[s.priority] ?? "") : "");
  const bandOf = (c: Concept): TableBand => {
    const p = priority(c);
    return p === "hard" || p === "must" ? "Must-haves" : p === "nice" ? "Nice-to-haves" : "Criteria";
  };
  const dropped: Concept[] = [];
  const listed: TableColumn[] = s.columns.flatMap((col): TableColumn[] => {
    if ("attribute" in col) {
      const def = attrs.get(col.attribute);
      return [{ key: `a:${col.attribute}`, band: "Facts", kind: "attribute", attribute: col.attribute, label: def?.label ?? col.attribute, def }];
    }
    if ("concept" in col) {
      const c = byId.get(col.concept);
      if (!c) return []; // deleted since the View was set up
      if (isCriterion(c) && priority(c) === "dropped") {
        dropped.push(c);
        return [];
      }
      return [{ key: `c:${c.id}`, band: isCriterion(c) ? bandOf(c) : undefined, kind: "concept", concept: c, label: c.title }];
    }
    // criteria: auto: every criterion the rows have a verdict on, dropped ones left out.
    const judged = new Set(verdicts.filter((r) => rowIds.has(r.from)).map((r) => r.to));
    const criteria = expedition.concepts.filter((c) => isCriterion(c) && judged.has(c.id));
    dropped.push(...criteria.filter((c) => priority(c) === "dropped"));
    return criteria
      .filter((c) => priority(c) !== "dropped")
      .map((c): TableColumn => ({ key: `c:${c.id}`, band: bandOf(c), kind: "concept", concept: c, label: c.title }));
  });

  // Each run of criterion columns is ordered must-haves first, so the bands read cleanly.
  const rank = (c: TableColumn) => BAND_ORDER.indexOf(c.band ?? "Criteria");
  const isCriterionColumn = (c: TableColumn) => c.kind === "concept" && c.band !== undefined;
  const columns: TableColumn[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < listed.length; ) {
    if (!isCriterionColumn(listed[i])) columns.push(listed[i++]);
    else {
      const run: TableColumn[] = [];
      while (i < listed.length && isCriterionColumn(listed[i])) run.push(listed[i++]);
      columns.push(...run.map((c, j) => ({ c, j })).sort((a, b) => rank(a.c) - rank(b.c) || a.j - b.j).map(({ c }) => c));
    }
  }
  const unique = columns.filter((c) => !seen.has(c.key) && !!seen.add(c.key));

  const banded = unique.some((c) => c.band === "Must-haves" || c.band === "Nice-to-haves");
  const bands: ComparisonTableModel["bands"] = banded ? [] : undefined;
  if (bands)
    for (const c of unique) {
      const last = bands[bands.length - 1];
      if (last && last.band === c.band) last.span++;
      else bands.push({ band: c.band, span: 1 });
    }

  const standingOf = (c: Concept): Standing => {
    const v = s.standing ? c.attributes?.[s.standing] : undefined;
    return v === "chosen" || v === "in-play" || v === "ruled-out" ? v : undefined;
  };
  const rows = rowConcepts.map((row): TableRow => {
    const cells = unique.map((col): TableCell => {
      if (col.kind === "attribute") {
        const v = row.attributes?.[col.attribute];
        return v === undefined ? { kind: "no-fact" } : { kind: "fact", value: v, text: formatValue(v, col.def), def: col.def };
      }
      const r = cellRel.get(`${row.id}\n${col.concept.id}`);
      return r ? { kind: "verdict", relationship: r, tone: verdictTone(r.type) } : { kind: "unknown" };
    });
    const failsMustHave = unique.some(
      (col, i) => col.band === "Must-haves" && cells[i].kind === "verdict" && (cells[i] as { tone: VerdictTone }).tone === "fails",
    );
    return { concept: row, standing: standingOf(row), failsMustHave, cells };
  });

  return { columns: unique, bands, rows, dropped };
}

/** An Attribute value as text: money and numbers formatted, yes/no as words. */
export function formatValue(v: string | number | boolean, def?: AttributeDef): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    const n = v.toLocaleString("en-US");
    if (def?.type === "money") return def.unit ? `${n} ${def.unit}` : `$${n}`;
    return def?.unit ? `${n} ${def.unit}` : n;
  }
  return def?.unit ? `${v} ${def.unit}` : v;
}
