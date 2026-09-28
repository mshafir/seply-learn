import { useMemo } from "react";
import clsx from "clsx";
import type { Concept, Graph, RatesSettings } from "../lib/types";

const W = 820; // plot width
const MIN = 0.001;
const MAX = 2000;
const lx = (v: number) => ((Math.log10(v) - Math.log10(MIN)) / (Math.log10(MAX) - Math.log10(MIN))) * W;
const ticks = [0.001, 0.01, 0.1, 1 / 3, 1, 3, 10, 100, 1000];

const tone: Record<string, string> = {
  independent: "#059669",
  academic: "#2563eb",
  analyst: "#d97706",
  interested: "#dc2626",
  "self-reported": "#9333ea",
};

// Rates & estimates View Type: every per-year rate on one log scale, grouped
// by the quantity it estimates. Rises go right of 1×; falls are drawn as
// 1/rate so "falls 10×/yr" sits left. Several estimates of one quantity show
// how much the method and the source matter.
export function Rates({
  graph,
  settings: s,
  selected,
  onSelect,
  matches,
}: {
  graph: Graph;
  settings: RatesSettings;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
}) {
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));
  const groups = useMemo(() => {
    const out = new Map<string, Concept[]>();
    for (const c of graph.concepts) {
      const q = c.attributes?.[s.group];
      if (q === undefined || c.attributes?.[s.low] === undefined) continue;
      out.set(String(q), [...(out.get(String(q)) ?? []), c]);
    }
    return [...out];
  }, [graph, s]);
  const source = (c: Concept) => {
    const r = graph.relationships.find((r) => r.type === s.sourceRelationship && r.from === c.id);
    return r ? byId.get(r.to) : undefined;
  };
  const num = (c: Concept, k: string) => Number(c.attributes?.[k]);
  const fall = (c: Concept) => c.attributes?.[s.direction] === "fall";
  const at = (c: Concept, k: string) => lx(fall(c) ? 1 / num(c, k) : num(c, k));

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <span>Per year, log scale. Left of 1× = falling, right = rising. Colour = how independent the source is:</span>
        {Object.entries(tone).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-full" style={{ background: c }} /> {k}
          </span>
        ))}
      </div>
      <table className="border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr>
            <th />
            <th className="relative h-8" style={{ width: W }}>
              {ticks.map((t) => (
                <span key={t} className="absolute bottom-1 -translate-x-1/2 text-[11px] font-normal text-stone-400" style={{ left: lx(t) }}>
                  {t < 1 ? `÷${Math.round(1 / t)}` : `${t}×`}
                </span>
              ))}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([q, list]) => (
            <tr key={q}>
              <td className="w-64 border-t border-stone-200 pr-4 pt-2 align-top font-semibold text-stone-700">{q}</td>
              <td className="border-t border-stone-200 pt-2">
                <svg width={W} height={list.length * 30 + 4} className="overflow-visible">
                  <line x1={lx(1)} x2={lx(1)} y1={0} y2={list.length * 30} stroke="#a8a29e" strokeDasharray="3 3" />
                  <line x1={lx(1.41)} x2={lx(1.41)} y1={0} y2={list.length * 30} stroke="#e7e5e4" />
                  {list.map((c, i) => {
                    const src = source(c);
                    const color = tone[String(src?.attributes?.[s.independence ?? ""] ?? "")] ?? "#78716c";
                    const a = at(c, s.low);
                    const b = at(c, s.high);
                    const [x0, x1] = [Math.min(a, b), Math.max(a, b)];
                    const y = i * 30 + 14;
                    const dim = matches && !matches.has(c.id);
                    return (
                      <g key={c.id} onClick={() => onSelect(c.id)} className={clsx("cursor-pointer", dim && "opacity-20")}>
                        <title>{[c.title, c.attributes?.[s.method ?? ""], src && `Source: ${src.title}`].filter(Boolean).join(" — ")}</title>
                        {x1 - x0 > 2 ? (
                          <rect x={x0} y={y - 5} width={x1 - x0} height={10} rx={5} fill={color} opacity={0.35} stroke={color} />
                        ) : (
                          <circle cx={x0} cy={y} r={6} fill={color} />
                        )}
                        {c.id === selected && <rect x={x0 - 8} y={y - 9} width={x1 - x0 + 16} height={18} rx={9} fill="none" stroke="#1c1917" strokeWidth={2} />}
                        <text x={x1 + 10} y={y + 4} className="fill-stone-700 text-[12px]">
                          {c.title}
                          {src && <tspan className="fill-stone-400"> · {src.title}</tspan>}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-stone-500">Dashed line: no change. Grey line: Moore's law (~1.41×/yr), for scale.</p>
    </div>
  );
}
