import { useEffect, useMemo, useRef } from "react";
import { Timeline as VisTimeline, type DataItem, type TimelineOptions } from "vis-timeline/standalone";
import "vis-timeline/styles/vis-timeline-graph2d.css";
import type { Concept, Graph, TimelineSettings } from "../lib/types";
import { endOfPeriod, formatDate, parseDate } from "../lib/view";

const OTHER = "__other";

// Timeline View Type (docs/view-types/timeline.md): dated Concepts in lanes
// on a zoomable axis. A day-precise date is a point; a span or a fuzzy date
// ("1987", "Nov 2026") is a bar covering the period it names, so nothing
// claims more precision than the source gave. The red line is now.
export function Timeline({
  graph,
  settings: s,
  selected,
  onSelect,
  matches,
}: {
  graph: Graph;
  settings: TimelineSettings;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const tl = useRef<VisTimeline | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  const dated = useMemo(() => graph.concepts.filter((c) => parseDate(c.date)), [graph]);
  const kinds = useMemo(() => new Map(graph.kinds.map((k) => [k.id, k])), [graph]);
  const end = useMemo(() => {
    const last = Math.max(Date.now(), ...dated.map((c) => +endOfPeriod(c.dateEnd && c.dateEnd !== "ongoing" ? c.dateEnd : c.date!)));
    return new Date(last + 1000 * 60 * 60 * 24 * 60);
  }, [dated]);

  const toItem = (c: Concept): DataItem => {
    const color = kinds.get(c.kind)?.color ?? "#78716c";
    const precise = c.date!.length === 10;
    const span = !!c.dateEnd;
    const ongoing = c.dateEnd === "ongoing";
    const dim = matches && !matches.has(c.id);
    const classes = [
      span ? "mm-span" : precise ? "mm-point" : "mm-fuzzy",
      ongoing && "mm-ongoing",
      c.dateApprox && "mm-approx",
      dim && "mm-dim",
      c.id === selected && "mm-selected",
    ].filter(Boolean);
    return {
      id: c.id,
      group: s.lanes.some((l) => l.id === c.lane) ? c.lane! : OTHER,
      content: label(c.title, formatDate(c) ?? "") as unknown as string, // an element: vis sanitizes HTML strings
      title: [c.title, formatDate(c), c.summary].filter(Boolean).join(" — "),
      start: parseDate(c.date)!,
      end: span ? (ongoing ? end : endOfPeriod(c.dateEnd!)) : precise ? undefined : endOfPeriod(c.date!),
      type: span || !precise ? "range" : "point",
      className: classes.join(" "),
      style: `--mm-color:${color}`,
    };
  };

  // Create once per graph/view; items update in place.
  useEffect(() => {
    const lanes = [...s.lanes];
    if (dated.some((c) => !s.lanes.some((l) => l.id === c.lane))) lanes.push({ id: OTHER, label: "Other" });
    // Lane labels carry their count, so a lane outside the window isn't mistaken for empty.
    const laneOf = (c: Concept) => (s.lanes.some((l) => l.id === c.lane) ? c.lane! : OTHER);
    const groups = lanes.map((l, i) => ({
      id: l.id,
      content: laneLabel(l.label, dated.filter((c) => laneOf(c) === l.id).length) as unknown as string,
      order: i,
    }));
    const options: TimelineOptions = {
      stack: true,
      showCurrentTime: true,
      zoomMin: 1000 * 60 * 60 * 24 * 3,
      orientation: { axis: "top", item: "top" },
      margin: { item: { horizontal: 6, vertical: 8 } },
      groupOrder: "order",
      start: s.focus ? parseDate(s.focus[0]) : undefined,
      end: s.focus ? parseDate(s.focus[1]) : undefined,
      tooltip: { followMouse: true, delay: 200 },
      maxHeight: el.current!.clientHeight,
      verticalScroll: true,
    };
    const t = new VisTimeline(el.current!, dated.map(toItem), groups, options);
    t.on("select", ({ items: ids }: { items: string[] }) => select.current(ids[0]));
    tl.current = t;
    return () => {
      t.destroy();
      tl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dated, s]);

  // Selection and search restyle items without rebuilding the timeline.
  useEffect(() => {
    tl.current?.setItems(dated.map(toItem));
    tl.current?.setSelection(selected && dated.some((c) => c.id === selected) ? [selected] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, matches, dated]);

  const range = (from?: string, to?: string) => {
    if (from && to) tl.current?.setWindow(parseDate(from)!, parseDate(to)!, { animation: true });
    else tl.current?.fit({ animation: true });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-stone-200 bg-white px-4 py-1.5 text-xs text-stone-500">
        <span>Scroll to zoom, drag to pan.</span>
        {s.focus && (
          <button className="rounded border border-stone-200 px-2 py-0.5 hover:bg-stone-100" onClick={() => range(...s.focus!)}>
            Focus
          </button>
        )}
        <button className="rounded border border-stone-200 px-2 py-0.5 hover:bg-stone-100" onClick={() => range()}>
          Fit everything
        </button>
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm border border-stone-400 bg-stone-300" /> span</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm border border-dashed border-stone-400 bg-stone-100" /> year / month only</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-px bg-red-500" /> now</span>
        </span>
      </div>
      <div ref={el} className="mm-timeline min-h-0 flex-1 bg-white" />
    </div>
  );
}

function laneLabel(text: string, count: number) {
  const el = document.createElement("span");
  el.textContent = text;
  const n = el.appendChild(document.createElement("span"));
  n.className = "mm-lane-count";
  n.textContent = String(count);
  return el;
}

function label(title: string, date: string) {
  const el = document.createElement("span");
  const t = el.appendChild(document.createElement("span"));
  t.className = "mm-title";
  t.textContent = title;
  const d = el.appendChild(document.createElement("span"));
  d.className = "mm-date";
  d.textContent = date;
  return el;
}
