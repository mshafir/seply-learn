// The Views read from live collections: the compute fixture imported the way
// a first build is (@umbel/domain), in an @umbel/sync op engine.
import { afterEach, describe, expect, it } from "vitest";
import computeFile from "@umbel/domain/fixtures/compute.json" with { type: "json" };
import { builtinId, relKey } from "@umbel/domain";
import { compute, computeRiskView } from "../fixtures/index.ts";
import { computeRiskViewOp, openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { readExpedition } from "../src/live.ts";
import { expeditionLayoutMetrics, formatLayoutMetrics, layoutMetrics } from "../src/metrics.ts";
import { learningMap } from "../src/scope.ts";
import type { Expedition, LearningPathSettings } from "../src/model.ts";

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
    // Same Concepts drawn, same lines, same crossings and topics. Only ELK's
    // tie-breaking can differ: a collection lists Relationships by key
    // (from|type|to), not in the order the file wrote them, which moves one
    // edge in the static sample's very-long count (1 there, 0 here).
    const same = ({ shown, edges, crossings, edgesThroughNodes, crossTopic, verdict }: typeof fromLive) => ({
      shown,
      edges,
      crossings,
      edgesThroughNodes,
      crossTopic,
      verdict,
    });
    expect(same(fromLive)).toEqual(same(fromStatic));
    expect(formatLayoutMetrics(fromLive)).toBe(
      "Learning path (learning-path): 24 shown, 18 edges, 1 crossings, 1 edges through other nodes, 0 very long edges, 2 prerequisites cross topics → reads well",
    );
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
    const byLabel = new Map(all.map((m) => [m.label, m]));
    // The same numbers as tests/metrics.test.ts prints for the static sample.
    expect(risk).toMatchObject({ shown: 16, edges: 17, crossings: 0, edgesThroughNodes: 2 });
    expect(byLabel.get("Evidence")).toMatchObject({ shown: 36, edges: 27, crossings: 0, verdict: "reads well" });
    expect(byLabel.get("Lineage")).toMatchObject({ shown: 33, edges: 26, crossings: 6 });
    // Known gap (not this work package's Views): mechanism-mode Cause & Effect
    // is sensitive to Relationship order. In the file's hand order it reads
    // well (0 crossings); in the collections' key order ELK draws 2 crossings.
    expect(byLabel.get("Compute economics")).toMatchObject({ shown: 16, edges: 19 });
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
