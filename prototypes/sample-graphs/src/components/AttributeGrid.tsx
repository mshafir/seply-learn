import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import type { Concept, Graph } from "../lib/types";
import { KindIcon } from "./icons";

// Quadrant View Type: Concepts in a grid by two enum Attributes, one per axis,
// in the enum's value order. When the x axis is a progression (research →
// standard) it draws as a ladder: tinted stage headers with arrows.
export function AttributeGrid({
  graph,
  x,
  y,
  tags,
  evidence,
  variant,
  selected,
  onSelect,
  matches,
}: {
  graph: Graph;
  x: string;
  y?: string;
  tags?: string[];
  evidence?: string[];
  variant: "ladder" | "quadrant";
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
}) {
  const attrs = new Map((graph.attributes ?? []).map((a) => [a.id, a]));
  const xDef = attrs.get(x)!;
  const yDef = y ? attrs.get(y) : undefined;
  const xs = xDef.values ?? [];
  const ys = yDef?.values ?? [""];
  const kinds = new Map(graph.kinds.map((k) => [k.id, k]));
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));

  const items = graph.concepts.filter(
    (c) =>
      (!tags || (c.tags ?? []).some((t) => tags.includes(t))) &&
      c.attributes?.[x] !== undefined &&
      (!y || c.attributes?.[y] !== undefined),
  );
  const cell = (xv: string, yv: string) =>
    items.filter((c) => c.attributes?.[x] === xv && (!y || c.attributes?.[y] === yv));
  const adopters = (c: Concept) =>
    graph.relationships.filter((r) => evidence?.includes(r.type) && r.to === c.id).map((r) => byId.get(r.from)!.title);

  const Card = ({ c }: { c: Concept }) => {
    const users = adopters(c);
    return (
      <button
        title={[c.summary, users.length ? `Used by ${users.join(", ")}` : ""].filter(Boolean).join("\n")}
        onClick={() => onSelect(c.id)}
        className={clsx(
          "flex w-full items-start gap-1.5 rounded-md border bg-white px-2 py-1 text-left text-xs shadow-sm hover:border-stone-400",
          c.id === selected ? "border-stone-900 ring-1 ring-stone-900" : "border-stone-200",
          matches && !matches.has(c.id) && "opacity-20",
        )}
      >
        <KindIcon name={kinds.get(c.kind)?.icon ?? c.kind} className="mt-px size-3.5 shrink-0" style={{ color: kinds.get(c.kind)?.color }} />
        <span className="font-medium leading-tight">{c.title}</span>
        {users.length > 0 && <span className="ml-auto shrink-0 rounded-full bg-orange-50 px-1.5 text-[10px] font-semibold text-orange-700">{users.length}</span>}
      </button>
    );
  };

  const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
  const headTone =
    variant === "ladder"
      ? (i: number) => ["bg-stone-100 text-stone-600", "bg-amber-50 text-amber-800", "bg-sky-50 text-sky-800", "bg-emerald-50 text-emerald-800"][i] ?? ""
      : () => "bg-stone-100 text-stone-700";

  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid gap-2" style={{ gridTemplateColumns: `${yDef ? "9rem " : ""}repeat(${xs.length}, minmax(11rem, 1fr))` }}>
        {yDef && (
          <div className="flex items-end pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
            {yDef.label} ↓ · {xDef.label} →
          </div>
        )}
        {xs.map((xv, i) => (
          <div key={xv} className={clsx("flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-semibold", headTone(i))}>
            {cap(xv)}
            {variant === "ladder" && i < xs.length - 1 && <ArrowRight className="ml-auto size-4 opacity-40" />}
            <span className="ml-auto text-xs font-normal opacity-60">{items.filter((c) => c.attributes?.[x] === xv).length}</span>
          </div>
        ))}
        {ys.map((yv) => (
          <div key={yv} className="contents">
            {yDef && <div className="pt-2 text-sm font-semibold text-stone-600">{cap(yv)}</div>}
            {xs.map((xv) => (
              <div
                key={xv}
                className={clsx(
                  "flex min-h-14 flex-col gap-1 rounded-lg p-1.5",
                  variant === "quadrant" ? "border border-dashed border-stone-300 bg-white/60" : "bg-stone-100/60",
                )}
              >
                {cell(xv, yv).map((c) => (
                  <Card key={c.id} c={c} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {evidence && (
        <p className="mt-4 text-xs text-stone-500">
          <span className="rounded-full bg-orange-50 px-1.5 font-semibold text-orange-700">n</span> = number of models in this graph that use it.
        </p>
      )}
    </div>
  );
}
