import { describe, expect, it } from "vitest";
import { compute, tiny, viewOf } from "../fixtures/index.ts";
import { layout, nodeSize, type Positions } from "../src/layouts.ts";
import { learningMap, scopeFor, topicRoots, trace } from "../src/scope.ts";
import { actsOn } from "../src/overlay.ts";
import { drawnRelationships } from "../src/drawn.ts";

const round = (p: Positions) => Object.fromEntries([...p].sort(([a], [b]) => a.localeCompare(b)).map(([id, q]) => [id, [Math.round(q.x), Math.round(q.y)]]));

describe("layouts are deterministic", () => {
  for (const view of tiny.views) {
    it(`${view.label}: same positions every run`, async () => {
      const scope = scopeFor(tiny, view);
      const visible = view.viewType === "learning-path" ? { hidden: new Set<string>(), bridges: [], topics: topicRoots(tiny) } : undefined;
      const a = await layout(scope, view, visible);
      const b = await layout(scopeFor(tiny, view), view, visible);
      expect(round(a.positions)).toEqual(round(b.positions));
      expect(a.extras).toEqual(b.extras);
      expect(round(a.positions)).toMatchSnapshot();
    });
  }
});

describe("learning path", () => {
  const view = viewOf(tiny, "learn", "learning-path");
  const scope = scopeFor(tiny, view);
  const topics = topicRoots(tiny);

  it("lays out only visible Concepts", async () => {
    const hidden = new Set(["b", "c"]);
    const { positions } = await layout(scope, view, { hidden, bridges: [{ from: "a", to: "d" }], topics });
    expect([...positions.keys()].sort()).toEqual(["a", "d", "e", "t", "u"]);
  });

  it("re-runs compactly when steps are hidden", async () => {
    const all = await layout(scope, view, { hidden: new Set(), bridges: [], topics: undefined });
    const some = await layout(scope, view, { hidden: new Set(["b", "c"]), bridges: [{ from: "a", to: "d" }], topics: undefined });
    const width = (p: Positions) => Math.max(...[...p.values()].map((q) => q.x)) - Math.min(...[...p.values()].map((q) => q.x));
    expect(width(some.positions)).toBeLessThan(width(all.positions));
  });

  it("groups by topic, foundational topics first", async () => {
    const { positions, extras } = await layout(scope, view, { hidden: new Set(), bridges: [], topics });
    expect(extras.bands?.map((b) => b.label)).toEqual(["MATHS", "MODELS"]);
    const [maths, models] = extras.bands!;
    const inside = (id: string, b: typeof maths) => {
      const p = positions.get(id)!;
      return p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height;
    };
    for (const id of ["a", "b", "c"]) expect(inside(id, maths)).toBe(true);
    for (const id of ["d", "e", "t", "u"]) expect(inside(id, models)).toBe(true);
  });

  it("the compute sample lays out just its core", async () => {
    const lp = viewOf(compute, "learn", "learning-path");
    const m = learningMap(compute, lp.settings);
    const hidden = new Set(m.scope.concepts.map((c) => c.id).filter((id) => !m.core.has(id)));
    const { positions } = await layout(m.scope, lp, { hidden, bridges: [], topics: topicRoots(compute) });
    expect(positions.size).toBe(m.core.size);
    expect(positions.size).toBeLessThan(m.scope.concepts.length);
  });
});

describe("cause & effect, risk mode", () => {
  const view = viewOf(tiny, "risk", "cause-and-effect");
  const scope = scopeFor(tiny, view);

  it("levers form one ranked column beside a large, centred outcome", async () => {
    const { positions, extras } = await layout(scope, view);
    const levers = ["lever-1", "lever-2", "lever-3"].map((id) => positions.get(id)!);
    const outcome = positions.get("outcome")!;
    expect(new Set(levers.map((p) => p.x)).size).toBe(1);
    expect(levers[0].x).toBeGreaterThan(outcome.x + nodeSize(scope.weights.get("outcome")!).width / 2);
    // Ranked by impact, top to bottom, centred on the outcome.
    expect(levers[0].y).toBeLessThan(levers[1].y);
    expect(levers[1].y).toBeLessThan(levers[2].y);
    expect(levers[1].y).toBeCloseTo(outcome.y);
    expect(scope.weights.get("outcome")).toBeGreaterThan(1);
    expect(extras.bands?.map((b) => b.label)).toEqual(["What to do · by impact"]);
    // Causes flow in from the left.
    expect(positions.get("driver")!.x).toBeLessThan(positions.get("mid")!.x);
    expect(positions.get("mid")!.x).toBeLessThan(outcome.x);
  });

  it('each lever points at the outcome, with an "acts on" chip when its target is upstream', () => {
    const drawn = drawnRelationships(scope, view.settings, { shown: () => true });
    for (const id of ["lever-1", "lever-2", "lever-3"]) {
      expect(drawn.filter((r) => r.from === id).map((r) => r.to)).toEqual(["outcome"]);
    }
    expect(actsOn(view.settings, scope, "lever-1")).toBeUndefined();
    expect(actsOn(view.settings, scope, "lever-2")).toBe("acts on MID");
    expect(actsOn(view.settings, scope, "lever-3")).toBe("acts on DRIVER");
    // The data keeps the accurate links.
    expect(scope.relationships.some((r) => r.from === "lever-3" && r.to === "driver")).toBe(true);
  });

  it("clicking a lever lights its real path", () => {
    const tr = trace(view.settings, scope.relationships, "lever-3");
    const drawn = drawnRelationships(scope, view.settings, { shown: () => true, tr, selected: "lever-3" });
    expect(drawn.filter((r) => r.from === "lever-3").map((r) => r.to)).toEqual(["driver"]);
    expect(tr.downstream.get("outcome")?.sign).toBe("lowers");
  });
});

describe("cause & effect, mechanism mode", () => {
  it("levers sit in one band across the top", async () => {
    const view = viewOf(compute, "economics", "cause-and-effect");
    const scope = scopeFor(compute, view);
    const { positions, extras } = await layout(scope, view);
    const levers = ["reasoning-load", "capex", "serving-opts", "hardware-gens", "distillation", "moe"].filter((id) => positions.has(id));
    expect(levers.length).toBeGreaterThan(1);
    const ys = new Set(levers.map((id) => positions.get(id)!.y));
    expect(ys.size).toBe(1);
    const leverY = [...ys][0];
    for (const [id, p] of positions) if (!levers.includes(id)) expect(p.y).toBeGreaterThan(leverY);
    expect(extras.bands?.[0].label).toBe("Levers · things you can change");
  });
});

describe("evidence", () => {
  it("claims down the middle, support left, challenges right, shared evidence level with its claims", async () => {
    const view = viewOf(tiny, "evidence", "evidence");
    const { positions } = await layout(scopeFor(tiny, view), view);
    expect(positions.get("claim-1")!.x).toBe(0);
    expect(positions.get("claim-2")!.x).toBe(0);
    expect(positions.get("study-1")!.x).toBeLessThan(0);
    expect(positions.get("study-3")!.x).toBeLessThan(0);
    expect(positions.get("study-2")!.x).toBeGreaterThan(0);
    const mid = (positions.get("claim-1")!.y + positions.get("claim-2")!.y) / 2;
    expect(positions.get("study-2")!.y).toBeCloseTo(mid);
  });
});

describe("lineage", () => {
  it("one column per year, one band per area", async () => {
    const view = viewOf(tiny, "lineage", "lineage");
    const { positions, extras } = await layout(scopeFor(tiny, view), view);
    expect(extras.ticks?.map((t) => t.label)).toEqual(["1990", "2001", "2020"]);
    expect(extras.bands?.map((b) => b.label)).toEqual(["x", "y"]);
    expect(positions.get("old")!.x).toBeLessThan(positions.get("newer")!.x);
    expect(positions.get("newer")!.x).toBeLessThan(positions.get("newest")!.x);
  });
});
