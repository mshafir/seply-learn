// The Views read from live collections: the compute fixture imported the way
// a first build is (@umbel/domain), in an @umbel/sync op engine.
import { afterEach, describe, expect, it } from "vitest";
import computeFile from "@umbel/domain/fixtures/compute.json" with { type: "json" };
import { builtinId, relKey } from "@umbel/domain";
import { compute, computeRiskView } from "../fixtures/index.ts";
import { computeRiskViewOp, openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { readExpedition } from "../src/live.ts";
import { expeditionLayoutMetrics, formatLayoutMetrics, layoutMetrics, type LayoutMetrics } from "../src/metrics.ts";
import { learningMap } from "../src/scope.ts";
import type { Expedition, LearningPathSettings } from "../src/model.ts";
import { learningPathOverlaps } from "./learningPathStates.ts";

let open: LiveFixture[] = [];
afterEach(() => {
  open.forEach((f) => f.dispose());
  open = [];
});
const live = () => {
  const f = openLiveFixture(computeFile);
  open.push(f);
  return f;
};
/** Metrics without the View's id, which the import mints anew. */
const sansId = (m: LayoutMetrics): Omit<LayoutMetrics, "viewId"> => {
  const out: Partial<LayoutMetrics> = { ...m };
  delete out.viewId;
  return out as Omit<LayoutMetrics, "viewId">;
};
const lpOf = (e: Expedition) => e.views.find((v) => v.viewType === "learning-path")!;

describe("the imported compute fixture, read live", () => {
  it("has the sample's Concepts, Relationships and Views", () => {
    const e = readExpedition(live().collections);
    expect(e.title).toBe(compute.title);
    expect(e.concepts).toHaveLength(compute.concepts.length);
    expect(e.relationships).toHaveLength(compute.relationships.length);
    expect(e.views.map((v) => v.label)).toEqual(compute.views.map((v) => v.label));
  });

  it("lays out the Learning path as the static sample does", async () => {
    const e = readExpedition(live().collections);
    const fromLive = (await layoutMetrics(e, lpOf(e)))!;
    const fromStatic = (await layoutMetrics(compute, compute.views.find((v) => v.id === "learn")!))!;
    // Printed so the numbers show up in CI logs and PRs.
    console.log(`live:   ${formatLayoutMetrics(fromLive)}\nstatic: ${formatLayoutMetrics(fromStatic)}`);
    // A collection lists Relationships by key (from|type|to) and the import
    // mints new ids, but the layouts sort their input by what a reader sees
    // (#60), so the numbers are the same.
    expect(sansId(fromLive)).toEqual(sansId(fromStatic));
    expect(formatLayoutMetrics(fromLive)).toBe(
      "Learning path (learning-path): 24 shown, 18 edges, 1 crossings, 0 edges through other nodes, 1 very long edges, 0 overlapping Concepts, 2 prerequisites cross topics → reads well",
    );
  });

  it("no Learning path state draws Concepts over each other, read live either (#62)", async () => {
    const { found } = await learningPathOverlaps(readExpedition(live().collections));
    expect(found).toEqual([]);
  });

  it("lays out the same way every time the same rows are read", async () => {
    const a = readExpedition(live().collections);
    const b = readExpedition(live().collections);
    expect(formatLayoutMetrics((await layoutMetrics(a, lpOf(a)))!)).toBe(formatLayoutMetrics((await layoutMetrics(b, lpOf(b)))!));
  });

  it("measures the other canvas Views as the static sample does", async () => {
    const f = live();
    f.pull([computeRiskViewOp(f)]);
    const e = readExpedition(f.collections);
    const all = await expeditionLayoutMetrics(e);
    const risk = await layoutMetrics(e, e.views.find((v) => v.id === computeRiskView.id)!);
    console.log([...all, risk!].map(formatLayoutMetrics).join("\n"));
    // Exactly the numbers the static sample gets (tests/metrics.test.ts).
    // Before #60, mechanism-mode Cause & Effect drew 2 crossings here and 0
    // from the file.
    const fromStatic = await expeditionLayoutMetrics(compute);
    expect(all.filter((m) => m.label !== computeRiskView.label).map(sansId)).toEqual(fromStatic.map(sansId));
    expect(sansId(risk!)).toEqual(sansId((await layoutMetrics(compute, computeRiskView))!));
    const byLabel = new Map(all.map((m) => [m.label, m]));
    expect(byLabel.get("Compute economics")).toMatchObject({ shown: 16, edges: 19, crossings: 0, verdict: "reads well" });
  });

  it("sees another tab's edit as soon as it is pulled", () => {
    const f = live();
    const before = readExpedition(f.collections);
    const lp = lpOf(before);
    const s = lp.settings as LearningPathSettings;
    const targets = learningMap(before, s).targets.size;

    // Another tab adds a technique with a deep enough path: a new target.
    const mla = f.concept("mla");
    f.pull([
      { kind: "concept.create", target: "c-new", value: { title: "New attention", kind: builtinId("idea"), tags: ["technique"] } },
      { kind: "relationship.add", target: relKey(mla, builtinId("prerequisite"), "c-new"), value: {} },
    ]);
    const after = readExpedition(f.collections);
    expect(after.concepts.find((c) => c.id === "c-new")?.title).toBe("New attention");
    expect(learningMap(after, s).targets.size).toBe(targets + 1);
  });
});
