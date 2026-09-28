import { describe, expect, it } from "vitest";
import { compute, computeRiskView, tiny } from "../fixtures/index.ts";
import { expeditionLayoutMetrics, formatLayoutMetrics, layoutMetrics } from "../src/metrics.ts";

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
