// The Timeline View as data: fuzzy dates at their own precision, lanes and
// the opening window, on the synthetic trip and the compute sample.
import { afterEach, describe, expect, it } from "vitest";
import computeFile from "@seply/domain/fixtures/compute.json" with { type: "json" };
import tripFile from "@seply/domain/fixtures/trip.json" with { type: "json" };
import { openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { readExpedition } from "../src/live.ts";
import { formatCalendarDate, formatWhen, parseCalendarDate, timelineModel } from "../src/timeline/items.ts";
import type { Expedition, View } from "../src/model.ts";

let open: LiveFixture[] = [];
afterEach(() => {
  open.forEach((f) => f.dispose());
  open = [];
});
const live = (file: unknown) => {
  const f = openLiveFixture(file);
  open.push(f);
  return { f, e: readExpedition(f.collections) };
};
const timelineOf = (e: Expedition) => e.views.find((v) => v.viewType === "timeline")!;
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("calendar dates", () => {
  it("keep their precision", () => {
    expect(parseCalendarDate("1987")).toEqual({ start: day(1987, 1, 1), end: day(1988, 1, 1), precision: "year" });
    expect(parseCalendarDate("2026-11")).toEqual({ start: day(2026, 11, 1), end: day(2026, 12, 1), precision: "month" });
    expect(parseCalendarDate("2026-12-31")).toEqual({ start: day(2026, 12, 31), end: day(2027, 1, 1), precision: "day" });
    expect(parseCalendarDate("soon")).toBeUndefined();
  });

  it("read as their precision says", () => {
    expect(formatCalendarDate("1987")).toBe("1987");
    expect(formatCalendarDate("2026-11")).toBe("Nov 2026");
    expect(formatCalendarDate("2026-11-03")).toBe("3 Nov 2026");
    expect(formatWhen({ date: "2027-03", dateApprox: true })).toBe("c. Mar 2027");
    expect(formatWhen({ date: "2026", dateEnd: "2031", dateApprox: true })).toBe("c. 2026 – 2031");
    expect(formatWhen({ date: "2020-03", dateEnd: "ongoing" })).toBe("Mar 2020 – ongoing");
  });
});

describe("Timeline", () => {
  it("draws days as points, spans as bars, and coarser dates as soft bars over their whole month or year", () => {
    const { f, e } = live(tripFile);
    const m = timelineModel(e, timelineOf(e));
    const item = (id: string) => m.items.find((i) => i.conceptId === f.concept(id))!;

    expect(item("arrive")).toMatchObject({ type: "point", fuzzy: false, start: day(2027, 6, 5) });
    expect(item("arrive").end).toBeUndefined();
    // A span is inclusive at its own precision: two nights, the 5th and 6th.
    expect(item("stay-lucerne")).toMatchObject({ type: "range", fuzzy: false, start: day(2027, 6, 5), end: day(2027, 6, 7) });
    // "2027-04": the whole of April, not the 1st.
    expect(item("seats")).toMatchObject({ type: "range", fuzzy: true, approx: false, start: day(2027, 4, 1), end: day(2027, 5, 1) });
    expect(item("pass")).toMatchObject({ fuzzy: true, approx: true, when: "c. Mar 2027" });
    expect(item("idea")).toMatchObject({ start: day(2026, 1, 1), end: day(2027, 1, 1), when: "c. 2026" });
  });

  it("puts Concepts in their lanes, in the View's lane order, and opens on the focus", () => {
    const { f, e } = live(tripFile);
    const m = timelineModel(e, timelineOf(e));
    expect(m.lanes.map((l) => l.label)).toEqual(["Planning", "Travel", "Stays", "Day trips"]);
    const lane = (id: string) => m.items.find((i) => i.conceptId === f.concept(id))!.lane;
    expect([lane("pass"), lane("arrive"), lane("stay-zermatt"), lane("day-rigi")]).toEqual(["planning", "travel", "stays", "days"]);
    // Places have no date: they are on the Map, not here.
    expect(m.undated).toContain(f.concept("zermatt"));
    expect(m.window).toEqual({ start: day(2027, 6, 3), end: day(2027, 6, 15) });
  });

  it("orders items by date whatever the file's order", () => {
    const { e } = live(tripFile);
    const shuffled = { ...e, concepts: [...e.concepts].reverse() };
    const ids = (x: Expedition) => timelineModel(x, timelineOf(x)).items.map((i) => i.conceptId);
    expect(ids(shuffled)).toEqual(ids(e));
  });

  it("runs ongoing spans to now, and sends lane-less Concepts to Other", () => {
    const { e } = live(tripFile);
    const view: View = { id: "t", label: "t", viewType: "timeline", settings: { lanes: [{ id: "travel", label: "Travel" }] } };
    const withOngoing: Expedition = {
      ...e,
      concepts: [...e.concepts, { id: "x", title: "Saving for the next one", kind: "builtin:action", date: "2027-07", dateEnd: "ongoing" }],
    };
    const now = day(2028, 2, 1);
    const m = timelineModel(withOngoing, view, now);
    expect(m.items.find((i) => i.conceptId === "x")).toMatchObject({ ongoing: true, end: now, lane: "__other" });
    expect(m.lanes.map((l) => l.label)).toEqual(["Travel", "Other"]);
  });

  it("draws the compute sample's Timeline in its three lanes, opening on the modern era", () => {
    const { e } = live(computeFile);
    const m = timelineModel(e, timelineOf(e));
    expect(m.lanes.map((l) => l.label)).toEqual(["Ideas", "Models", "Compute & market"]);
    expect(m.items.length).toBeGreaterThan(60);
    expect(m.items.every((i) => i.lane !== "__other")).toBe(true);
    expect(m.window).toEqual({ start: day(2016, 6, 1), end: day(2027, 7, 1) });
  });
});
