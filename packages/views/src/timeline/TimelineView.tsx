// The Timeline View (docs/view-types/timeline.md): dated Concepts on a
// zoomable axis with vis-timeline, in lanes, as points and bars, with fuzzy
// dates drawn soft and a "now" line. The items come from `timelineModel`;
// this only keeps vis-timeline's data sets in step with it.
//
// - Clicking an item selects its Concept; clicking empty space clears it.
// - `matches` dims the rest; `covered` puts a check on read Concepts.
// - Colours come from tokens through the override sheet (timeline.css).
import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import * as vis from "vis-timeline/standalone";
import type { DataGroup, DataItem, Timeline, TimelineOptions } from "vis-timeline/standalone";
import type { DataSet as DataSetType } from "vis-data";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import "./timeline.css";
import type { Expedition, View } from "../model.ts";
import type { ViewInteraction } from "../ExpeditionView.tsx";
import { timelineModel, type TimelineItem } from "./items.ts";

export type TimelineViewProps = ViewInteraction & {
  expedition: Expedition;
  view: View;
};

const DAY = 24 * 3600 * 1000;

// The standalone build bundles its own vis-data (the Timeline checks for its
// DataSet), but its typings don't declare the export.
const { DataSet } = vis as unknown as { DataSet: typeof DataSetType };

export function TimelineView({ expedition, view, selected, onSelect, matches, covered, onSettled }: TimelineViewProps) {
  const model = useMemo(() => timelineModel(expedition, view), [expedition, view]);
  const host = useRef<HTMLDivElement>(null);
  const timeline = useRef<Timeline | null>(null);
  const items = useMemo(() => new DataSet<DataItem>(), []);
  const groups = useMemo(() => new DataSet<DataGroup>(), []);
  const select = useEffectEvent((id?: string) => onSelect(id));
  const settled = useEffectEvent(() => onSettled?.());

  // One vis-timeline per View, opened on the View's window.
  useEffect(() => {
    const options: TimelineOptions = {
      stack: true,
      showCurrentTime: true,
      zoomMin: DAY,
      zoomMax: 1000 * 365 * DAY,
      orientation: { axis: "top" },
      margin: { item: { horizontal: 6, vertical: 6 }, axis: 8 },
      groupOrder: "order",
      selectable: true,
      multiselect: false,
      // Drawn: vis-timeline shows itself once it has opened on the window.
      onInitialDrawComplete: () => settled(),
      ...(model.window ? { start: model.window.start, end: model.window.end } : {}),
    };
    const t = new vis.Timeline(host.current!, items, groups, options);
    timeline.current = t;
    t.on("select", (e?: { items: (string | number)[] }) => select(e?.items[0] as string | undefined));
    return () => {
      t.destroy();
      timeline.current = null;
    };
    // The window is only the opening viewport; later data doesn't move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, groups]);

  // Data, search and Reading status → the data sets (updated in place).
  useEffect(() => {
    groups.update(model.lanes.map((l, order) => ({ id: l.id, content: l.label, order })));
    groups.remove(groups.getIds().filter((id: string | number) => !model.lanes.some((l) => l.id === id)));
    const next = model.items.map((i) => toItem(i, { dim: !!matches && !matches.has(i.conceptId), read: !!covered?.has(i.conceptId) }));
    items.update(next);
    const ids = new Set(next.map((i) => i.id));
    items.remove(items.getIds().filter((id: string | number) => !ids.has(id as string)));
  }, [model, matches, covered, items, groups]);

  useEffect(() => {
    timeline.current?.setSelection(selected && items.get(selected) ? [selected] : []);
  }, [selected, model, items]);

  return (
    <div className="seply-timeline" data-testid="timeline">
      <div className="seply-timeline__chart" ref={host} />
      {model.undated.length > 0 && (
        <p className="seply-timeline__undated">
          {model.undated.length} {model.undated.length === 1 ? "Concept has" : "Concepts have"} no date and{" "}
          {model.undated.length === 1 ? "isn't" : "aren't"} shown.
        </p>
      )}
    </div>
  );
}

function toItem(i: TimelineItem, { dim, read }: { dim: boolean; read: boolean }): DataItem {
  return {
    id: i.conceptId,
    group: i.lane,
    start: i.start,
    ...(i.end ? { end: i.end } : {}),
    type: i.type,
    content: label(i, read),
    className: [
      "seply-tl",
      i.fuzzy && "seply-tl--fuzzy",
      i.ongoing && "seply-tl--ongoing",
      dim && "seply-tl--dim",
    ]
      .filter(Boolean)
      .join(" "),
    style: i.color ? `--seply-item-color: ${i.color}` : undefined,
  } as unknown as DataItem;
}

/** An item's label, built as DOM (never HTML strings: titles are user text). */
function label(i: TimelineItem, read: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = "seply-tl-label";
  el.dataset.conceptId = i.conceptId;
  el.title = `${i.title} · ${i.when}`;
  if (read) {
    el.dataset.covered = "";
    el.append(check());
  }
  el.append(i.title);
  if (i.fuzzy || i.ongoing) {
    const when = document.createElement("span");
    when.className = "seply-tl-when";
    when.textContent = i.when;
    el.append(when);
  }
  return el;
}

/** Lucide's circle-check, as the canvas Views draw it (ReadCheck). */
function check(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "seply-tl-check");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Read");
  svg.dataset.testid = "read-check";
  const circle = document.createElementNS(ns, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  const tick = document.createElementNS(ns, "path");
  tick.setAttribute("d", "m9 12 2 2 4-4");
  svg.append(circle, tick);
  return svg;
}
