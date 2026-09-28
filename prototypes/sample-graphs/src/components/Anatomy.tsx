import clsx from "clsx";
import type { AnatomySettings, Concept, Graph } from "../lib/types";

const stageColors = ["#a8a29e", "#f59e0b", "#0ea5e9", "#059669"]; // enum order: least → most proven

// Anatomy View Type: the thing itself as nested parts, with the Concepts
// that change each part pinned onto it. Containment is drawn, not linked.
export function Anatomy({
  graph,
  settings: s,
  selected,
  onSelect,
  matches,
}: {
  graph: Graph;
  settings: AnatomySettings;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
}) {
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));
  const index = new Map(graph.concepts.map((c, i) => [c.id, i]));
  const order = (a: Concept, b: Concept) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || index.get(a.id)! - index.get(b.id)!;
  const children = (id: string) =>
    graph.relationships
      .filter((r) => s.containment.includes(r.type) && r.to === id)
      .map((r) => byId.get(r.from)!)
      .filter((c) => !graph.relationships.some((r) => s.pins.includes(r.type) && r.from === c.id))
      .sort(order);
  const pinsOn = (id: string) =>
    graph.relationships.filter((r) => s.pins.includes(r.type) && r.to === id).map((r) => byId.get(r.from)!);

  const def = (graph.attributes ?? []).find((a) => a.id === s.colorBy);
  const color = (c: Concept) => {
    const v = s.colorBy ? c.attributes?.[s.colorBy] : undefined;
    const i = def?.values?.indexOf(String(v)) ?? -1;
    return i >= 0 ? stageColors[Math.min(i, stageColors.length - 1)] : "#78716c";
  };
  const dim = (id: string) => !!matches && !matches.has(id);

  const Box = ({ c, depth }: { c: Concept; depth: number }) => {
    const kids = children(c.id);
    const pins = pinsOn(c.id);
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelect(c.id);
        }}
        className={clsx(
          "flex min-w-40 cursor-pointer flex-col gap-2 rounded-xl border p-3 transition-opacity",
          depth === 0 ? "border-stone-300 bg-white" : depth % 2 ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-white",
          c.id === selected && "ring-2 ring-stone-900",
          dim(c.id) && !pins.some((p) => !dim(p.id)) && "opacity-40",
          kids.length ? "flex-1" : "",
        )}
      >
        <div>
          <div className={clsx("font-semibold leading-tight", depth === 0 ? "text-lg" : "text-sm")}>{c.title}</div>
          {c.summary && <div className="mt-0.5 text-xs text-stone-500">{c.summary}</div>}
        </div>
        {pins.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pins.map((p) => (
              <button
                key={p.id}
                title={p.summary}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(p.id);
                }}
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow-sm",
                  p.id === selected && "ring-2 ring-stone-900 ring-offset-1",
                  dim(p.id) && "opacity-25",
                )}
                style={{ background: color(p) }}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}
        {kids.length > 0 && (
          <div className={clsx("flex flex-wrap gap-2", depth === 0 && "flex-col")}>
            {kids.map((k) => (
              <Box key={k.id} c={k} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto p-6" onClick={() => onSelect(undefined)}>
      {def?.values && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
          <span>Pinned techniques, coloured by {def.label.toLowerCase()}:</span>
          {def.values.map((v, i) => (
            <span key={v} className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-full" style={{ background: stageColors[i] }} /> {v}
            </span>
          ))}
        </div>
      )}
      <div className="flex max-w-6xl flex-col gap-4">
        {s.roots.map((id) => byId.get(id) && <Box key={id} c={byId.get(id)!} depth={0} />)}
      </div>
    </div>
  );
}
