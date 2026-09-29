import { describe, expect, it } from "vitest";
import { compute, computeRiskView, tiny } from "../fixtures/index.ts";
import { expeditionLayoutMetrics, formatLayoutMetrics, layoutMetrics, overlappingConcepts } from "../src/metrics.ts";
import { drawnRelationships } from "../src/drawn.ts";
import { scopeFor } from "../src/scope.ts";
import type { CauseEffectSettings, Expedition, View } from "../src/model.ts";
import { learningPathOverlaps } from "./learningPathStates.ts";

describe("layout metrics", () => {
  it("the compute sample's Learning path and Cause & Effect Views read well", async () => {
    const all = await expeditionLayoutMetrics(compute);
    const risk = await layoutMetrics(compute, computeRiskView);
    // Printed so the numbers show up in CI logs and PRs.
    console.log([...all, risk!].map(formatLayoutMetrics).join("\n"));

    const byId = new Map(all.map((m) => [m.viewId, m]));
    expect([...byId.keys()]).toEqual(["learn", "lineage", "evidence", "economics"]);
    expect(byId.get("learn")?.verdict).toBe("reads well");
    expect(byId.get("economics")?.verdict).toBe("reads well");
    expect(byId.get("learn")?.crossTopic).toBeTypeOf("number");
    // Pinned. A layout change that moves them should be deliberate. (#60 made
    // the layouts order-independent: 1 edge through other nodes → 0.)
    expect(formatLayoutMetrics(byId.get("learn")!)).toBe(
      "Learning path (learning-path): 24 shown, 18 edges, 1 crossings, 0 edges through other nodes, 1 very long edges, 0 overlapping Concepts, 2 prerequisites cross topics → reads well",
    );
    expect(byId.get("evidence")).toMatchObject({ crossings: 0, edgesThroughNodes: 0, verdict: "reads well" });
    expect(byId.get("economics")).toMatchObject({ crossings: 0, edgesThroughNodes: 1 });
    expect(byId.get("lineage")).toMatchObject({ crossings: 4, edgesThroughNodes: 9 });
    for (const m of [...all, risk!]) expect(m.overlaps).toBe(0);
  });

  it("no Learning path state draws Concepts over each other, dimmed or not (#62)", async () => {
    const { states, found } = await learningPathOverlaps(compute);
    expect(states).toBeGreaterThan(50);
    expect(found).toEqual([]);
  });

  it("counts Concept cards drawn over each other", () => {
    const e: Expedition = { ...tiny, concepts: [...tiny.concepts] };
    const scope = scopeFor(e, tiny.views.find((v) => v.id === "lineage")!);
    const positions = new Map([
      ["old", { x: 0, y: 0 }],
      ["newer", { x: 40, y: 10 }], // on top of "old"
      ["newest", { x: 1000, y: 0 }],
    ]);
    expect(overlappingConcepts(scope, positions, ["old", "newer", "newest"])).toEqual([["old", "newer"]]);
  });

  it("skips View Types not drawn on the canvas", async () => {
    const outline = compute.views.find((v) => v.viewType === "outline")!;
    expect(await layoutMetrics(compute, outline)).toBeUndefined();
  });

  it("counts crossings on a hand-drawn tangle", async () => {
    // Synthetic: a lineage whose led-to links cross between two year columns.
    const tangle = {
      ...tiny,
      concepts: [
        { id: "p", title: "P", kind: "idea", date: "2000", attributes: { area: "one" } },
        { id: "q", title: "Q", kind: "idea", date: "2000", attributes: { area: "one" } },
        { id: "r", title: "R", kind: "idea", date: "2010", attributes: { area: "one" } },
        { id: "s", title: "S", kind: "idea", date: "2010", attributes: { area: "one" } },
      ],
      relationships: [
        { from: "p", to: "s", type: "led-to" },
        { from: "q", to: "r", type: "led-to" },
      ],
    };
    const m = await layoutMetrics(tangle, tiny.views.find((v) => v.id === "lineage")!);
    expect(m?.edges).toBe(2);
    expect(m?.crossings).toBe(1);
    expect(m?.verdict).toBe("cluttered");
  });
});

describe("layout metrics, Cause & Effect risk mode", () => {
  // Synthetic: two causes feed a risk, and two ranked levers each act on both
  // causes. Drawn by default, each lever points straight at the risk, so the
  // reader sees 4 lines that don't cross. The levers' 4 real edges run back
  // from the lever column to the causes in an X, but stay hidden until a
  // lever is traced, so they must not count.
  const settings: CauseEffectSettings = {
    mode: "risk",
    positive: ["raises"],
    negative: ["lowers"],
    outcomes: ["risk"],
    levers: { tags: ["lever"] },
    rankBy: "impact",
  };
  const riskView: View = { id: "risk", label: "Risk", viewType: "cause-and-effect", settings };
  const mechanismView: View = { ...riskView, id: "mechanism", settings: { ...settings, mode: "mechanism" } };
  const levered: Expedition = {
    ...tiny,
    concepts: [
      { id: "risk", title: "Risk", kind: "idea" },
      { id: "cause-a", title: "Cause A", kind: "idea" },
      { id: "cause-b", title: "Cause B", kind: "idea" },
      { id: "lever-1", title: "Lever 1", kind: "idea", tags: ["lever"], attributes: { impact: 1 } },
      { id: "lever-2", title: "Lever 2", kind: "idea", tags: ["lever"], attributes: { impact: 2 } },
    ],
    relationships: [
      { from: "cause-a", to: "risk", type: "raises" },
      { from: "cause-b", to: "risk", type: "raises" },
      { from: "lever-1", to: "cause-a", type: "lowers" },
      { from: "lever-1", to: "cause-b", type: "lowers" },
      { from: "lever-2", to: "cause-a", type: "lowers" },
      { from: "lever-2", to: "cause-b", type: "lowers" },
    ],
    views: [riskView, mechanismView],
  };

  it("counts the drawn lever→outcome lines, not the levers' hidden real edges", async () => {
    const m = await layoutMetrics(levered, riskView);
    expect(m?.shown).toBe(5);
    expect(m?.edges).toBe(4);
    expect(m?.crossings).toBe(0);
    expect(m?.edgesThroughNodes).toBe(0);
    expect(m?.verdict).toBe("reads well");
  });

  it("counts every real edge in mechanism mode, where all of them are drawn", async () => {
    const m = await layoutMetrics(levered, mechanismView);
    expect(m?.edges).toBe(6);
  });

  it("a lever's hidden real edges don't move the numbers", async () => {
    const more: Expedition = {
      ...levered,
      concepts: [...levered.concepts, { id: "cause-c", title: "Cause C", kind: "idea" }],
      relationships: [
        ...levered.relationships,
        { from: "cause-c", to: "cause-a", type: "raises" },
        { from: "lever-1", to: "cause-c", type: "lowers" },
        { from: "lever-2", to: "cause-c", type: "lowers" },
      ],
    };
    const m = await layoutMetrics(more, riskView);
    // One more cause and its one drawn edge; the two new lever edges stay hidden.
    expect(m?.edges).toBe(5);
    expect(m?.crossings).toBe(0);
  });

  it("measures the same lines the renderer draws for the compute sample", async () => {
    const scope = scopeFor(compute, computeRiskView);
    const drawn = drawnRelationships(scope, settingsOf(computeRiskView), { shown: () => true });
    const m = await layoutMetrics(compute, computeRiskView);
    expect(m?.edges).toBe(drawn.length);
    // 11 causal edges, plus the 6 levers each drawn once, at the outcome.
    expect(drawn.filter((r) => r.synthetic)).toHaveLength(6);
    expect(m?.edges).toBe(17);
    expect(m?.crossings).toBe(0);
  });
});

function settingsOf(view: View): CauseEffectSettings {
  if (view.viewType !== "cause-and-effect") throw new Error("not a Cause & Effect View");
  return view.settings;
}
