// What a Timeline View draws, as a pure function of the Expedition and the
// View's settings (docs/view-types/timeline.md). No vis-timeline here: the
// renderer turns this into its items and groups.
//
// Dates carry their own precision ("1987", "2026-11", "2026-11-03"), and the
// Timeline never fakes more than the date says:
// - a day with no end is a point;
// - a month or a year with no end is a soft bar over that whole month or year;
// - a span runs from the start of its first date to the end of its last
//   (both inclusive, at their own precision); "ongoing" runs to now;
// - `dateApprox` reads "c." and is drawn soft too.
// Dates are calendar dates: they are built in local time, so a day stays
// that day whatever the reader's time zone.
import type { Concept, Expedition, TimelineSettings, View } from "../model.ts";
import { paletteColor } from "../canvas/color.ts";

export type Precision = "year" | "month" | "day";

export type CalendarDate = {
  /** The first moment of the date (local time). */
  start: Date;
  /** The first moment after it: the next year, month or day. */
  end: Date;
  precision: Precision;
};

const DATE_RE = /^(-?\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** A stored date string at its own precision; undefined if it isn't one. */
export function parseCalendarDate(s: string): CalendarDate | undefined {
  const m = DATE_RE.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : undefined;
  const d = m[3] ? Number(m[3]) : undefined;
  const at = (yy: number, mm = 0, dd = 1) => {
    const date = new Date(2000, 0, 1);
    date.setFullYear(yy, mm, dd); // years before 100 stay themselves; overflow rolls into yy's next month or year
    return date;
  };
  if (mo === undefined) return { start: at(y), end: at(y + 1), precision: "year" };
  if (d === undefined) return { start: at(y, mo), end: at(y, mo + 1), precision: "month" };
  return { start: at(y, mo, d), end: at(y, mo, d + 1), precision: "day" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date as its precision reads: "1987", "Nov 2026", "3 Nov 2026". */
export function formatCalendarDate(s: string): string {
  const d = parseCalendarDate(s);
  if (!d) return s;
  const y = d.start.getFullYear();
  if (d.precision === "year") return `${y}`;
  const m = MONTHS[d.start.getMonth()];
  return d.precision === "month" ? `${m} ${y}` : `${d.start.getDate()} ${m} ${y}`;
}

/** When a Concept happens, as a reader would say it: "c. 2026", "5 Jun 2027 – 6 Jun 2027", "Mar 2020 – ongoing". */
export function formatWhen(c: Pick<Concept, "date" | "dateEnd" | "dateApprox">): string {
  if (!c.date) return "";
  const from = formatCalendarDate(c.date);
  const to = c.dateEnd === "ongoing" ? "ongoing" : c.dateEnd ? formatCalendarDate(c.dateEnd) : undefined;
  return `${c.dateApprox ? "c. " : ""}${to ? `${from} – ${to}` : from}`;
}

export type TimelineLane = { id: string; label: string };

export type TimelineItem = {
  conceptId: string;
  title: string;
  kind: string;
  /** The Kind's colour, as CSS (`var(--kind-*)`). */
  color?: string;
  lane: string;
  start: Date;
  /** Set for bars (spans and dates coarser than a day); points have none. */
  end?: Date;
  type: "point" | "range";
  /** Coarser than a day, or approximate: drawn soft. */
  fuzzy: boolean;
  approx: boolean;
  ongoing: boolean;
  /** "c. Mar 2027", for labels and tooltips. */
  when: string;
};

export type TimelineModel = {
  lanes: TimelineLane[];
  items: TimelineItem[];
  /** Concepts in scope with no (valid) date: not drawn. */
  undated: string[];
  /** The initial viewport: the View's focus, else everything, padded. */
  window?: { start: Date; end: Date };
};

export const OTHER_LANE: TimelineLane = { id: "__other", label: "Other" };

/**
 * A Timeline View's lanes and items. A Concept goes in the lane it names
 * (`lane`), else the first lane one of its Tags names, else "Other". With no
 * lanes in the settings, lanes are the Kinds in use.
 */
export function timelineModel(expedition: Expedition, view: View, now: Date = new Date()): TimelineModel {
  const settings = (view.viewType === "timeline" ? view.settings : { lanes: [] }) as TimelineSettings;
  const kinds = new Map(expedition.kinds.map((k) => [k.id, k]));
  const byKind = !settings.lanes?.length;
  const laneIds = new Set((settings.lanes ?? []).map((l) => l.id));
  const laneOf = (c: Concept): string => {
    if (byKind) return c.kind;
    if (c.lane && laneIds.has(c.lane)) return c.lane;
    return c.tags?.find((t) => laneIds.has(t)) ?? OTHER_LANE.id;
  };

  const items: TimelineItem[] = [];
  const undated: string[] = [];
  const hidden = new Set((settings as { hide?: string[] }).hide ?? []);
  for (const c of expedition.concepts) {
    if (hidden.has(c.id)) continue;
    const start = c.date ? parseCalendarDate(c.date) : undefined;
    if (!start) {
      undated.push(c.id);
      continue;
    }
    const ongoing = c.dateEnd === "ongoing";
    const endDate = c.dateEnd && !ongoing ? parseCalendarDate(c.dateEnd) : undefined;
    const approx = !!c.dateApprox;
    const span = ongoing || !!endDate;
    const point = !span && start.precision === "day";
    const end = ongoing ? new Date(Math.max(now.getTime(), start.end.getTime())) : endDate ? endDate.end : start.end;
    items.push({
      conceptId: c.id,
      title: c.title,
      kind: c.kind,
      color: paletteColor(kinds.get(c.kind)?.color),
      lane: laneOf(c),
      start: start.start,
      ...(point ? {} : { end: end < start.end ? start.end : end }),
      type: point ? "point" : "range",
      fuzzy: approx || (!span && start.precision !== "day"),
      approx,
      ongoing,
      when: formatWhen(c),
    });
  }
  // A reader's order, not the file's: by start, then title, then id.
  items.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      a.title.localeCompare(b.title) ||
      (a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0),
  );

  const used = new Set(items.map((i) => i.lane));
  const lanes: TimelineLane[] = byKind
    ? expedition.kinds.filter((k) => used.has(k.id)).map((k) => ({ id: k.id, label: k.label }))
    : [...(settings.lanes ?? []), ...(used.has(OTHER_LANE.id) ? [OTHER_LANE] : [])];

  return { lanes, items, undated, window: windowOf(settings, items) };
}

function windowOf(settings: TimelineSettings, items: TimelineItem[]): TimelineModel["window"] {
  const [a, b] = settings.focus ?? [];
  const from = a ? parseCalendarDate(a) : undefined;
  const to = b ? parseCalendarDate(b) : undefined;
  if (from && to) return { start: from.start, end: to.end };
  if (!items.length) return undefined;
  const start = Math.min(...items.map((i) => i.start.getTime()));
  const end = Math.max(...items.map((i) => (i.end ?? i.start).getTime()));
  const pad = Math.max((end - start) * 0.05, 24 * 3600 * 1000);
  return { start: new Date(start - pad), end: new Date(end + pad) };
}
