import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { Concept, Graph, OutlineSettings } from "../lib/types";
import { KindIcon } from "./icons";

const UNSORTED = "__unsorted";

// Outline View Type (docs/view-types/outline.md): topics, the Concepts that
// belong to each, and a one-line summary on every line. Relationships read
// child -> parent; siblings follow their curated order (seq).
export function Outline({
  graph,
  settings: s,
  selected,
  onSelect,
  matches,
}: {
  graph: Graph;
  settings: OutlineSettings;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
}) {
  const kinds = new Map(graph.kinds.map((k) => [k.id, k]));
  const { children, parent, roots, unsorted } = useMemo(() => {
    const byId = new Map(graph.concepts.map((c) => [c.id, c]));
    const index = new Map(graph.concepts.map((c, i) => [c.id, i]));
    const bySeq = (a: Concept, b: Concept) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || index.get(a.id)! - index.get(b.id)!;
    const children = new Map<string, Concept[]>();
    const parent = new Map<string, string>();
    for (const r of graph.relationships) {
      if (!s.relationshipTypes.includes(r.type) || parent.has(r.from)) continue; // one primary parent
      children.set(r.to, [...(children.get(r.to) ?? []), byId.get(r.from)!]);
      parent.set(r.from, r.to);
    }
    for (const list of children.values()) list.sort(bySeq);
    const roots = graph.concepts
      .filter((c) => (s.rootTag ? c.tags?.includes(s.rootTag) : !parent.has(c.id)))
      .sort(bySeq);
    // Anything no root reaches is un-homed: list it so curators can see it.
    const reached = new Set<string>();
    const visit = (id: string) => {
      if (reached.has(id)) return;
      reached.add(id);
      for (const c of children.get(id) ?? []) visit(c.id);
    };
    roots.forEach((r) => visit(r.id));
    const unsorted = graph.concepts.filter((c) => !reached.has(c.id) && !parent.has(c.id));
    for (const c of unsorted) parent.set(c.id, UNSORTED);
    return { children, parent, roots, unsorted };
  }, [graph, s]);

  const [open, setOpen] = useState<Set<string>>(() => {
    const out = new Set<string>();
    const walk = (list: Concept[], depth: number) => {
      if (depth >= (s.openDepth ?? 1)) return;
      for (const c of list) (out.add(c.id), walk(children.get(c.id) ?? [], depth + 1));
    };
    walk(roots, 0);
    return out;
  });
  // Search opens the path to every match.
  const expanded = useMemo(() => {
    if (!matches) return open;
    const out = new Set(open);
    for (const id of matches) for (let p = parent.get(id); p; p = parent.get(p)) out.add(p);
    return out;
  }, [open, matches, parent]);

  const toggle = (id: string) =>
    setOpen((cur) => {
      const n = new Set(cur);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const Row = ({ id, depth, title, summary, icon, color, count }: {
    id: string; depth: number; title: string; summary?: string; icon?: string; color?: string; count: number;
  }) => (
    <div
      className={clsx(
        "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white",
        id === selected && "bg-amber-50",
        matches && !matches.has(id) && "opacity-30",
      )}
      style={{ paddingLeft: depth * 24 + 8 }}
      onClick={() => (id === UNSORTED ? toggle(id) : onSelect(id))}
    >
      <button
        className={clsx("mt-0.5 size-4 shrink-0 text-stone-400 hover:text-stone-900", !count && "invisible")}
        onClick={(e) => {
          e.stopPropagation();
          toggle(id);
        }}
      >
        <ChevronRight className={clsx("size-4 transition-transform", expanded.has(id) && "rotate-90")} />
      </button>
      {icon && <KindIcon name={icon} className="mt-0.5 size-4 shrink-0" style={{ color }} />}
      <div className="min-w-0">
        <div className={clsx(depth === 0 ? "text-base font-semibold" : "font-medium")}>
          {title}
          {count > 0 && !expanded.has(id) && <span className="ml-2 text-xs font-normal text-stone-400">{count}</span>}
        </div>
        {summary && <div className="text-sm text-stone-500">{summary}</div>}
      </div>
    </div>
  );

  const render = (c: Concept, depth: number): React.ReactNode => {
    const kids = children.get(c.id) ?? [];
    const k = kinds.get(c.kind);
    return (
      <li key={c.id}>
        <Row id={c.id} depth={depth} title={c.title} summary={c.summary} icon={k?.icon ?? c.kind} color={k?.color} count={kids.length} />
        {expanded.has(c.id) && kids.length > 0 && <ul>{kids.map((kid) => render(kid, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="h-full overflow-auto p-6">
      <ul className="max-w-3xl space-y-1">
        {roots.map((r) => render(r, 0))}
        {unsorted.length > 0 && (
          <li className="mt-4 border-t border-dashed border-stone-300 pt-3">
            <Row id={UNSORTED} depth={0} title="Unsorted" summary="Concepts no topic reaches yet: a curator's to-do list." count={unsorted.length} />
            {expanded.has(UNSORTED) && <ul>{unsorted.map((c) => render(c, 1))}</ul>}
          </li>
        )}
      </ul>
    </div>
  );
}
