// The non-canvas Views' pure parts: the Outline's tree (part-of plus the
// View's own placement/order/hide/fold overrides, and Reading status), the
// Quadrant's grid, and the Rates View's log axis.
import { afterAll, describe, expect, it } from "vitest";
import computeFile from "@umbel/domain/fixtures/compute.json" with { type: "json" };
import { openLiveFixture } from "../fixtures/live.ts";
import { readExpedition } from "../src/live.ts";
import type { Concept, Expedition, View } from "../src/model.ts";
import { ancestorsOf, defaultOpen, outlineTree, UNSORTED, type OutlineItem, type OutlineViewSettings } from "../src/outline/outline.ts";
import { quadrantGrid, type QuadrantViewSettings } from "../src/quadrant/quadrant.ts";
import { logAxis, rateLabel, ratesModel, type RatesViewSettings } from "../src/rates/rates.ts";

const c = (id: string, extra: Partial<Concept> = {}): Concept => ({ id, title: id.toUpperCase(), kind: "idea", ...extra });
const partOf = (from: string, to: string) => ({ from, to, type: "part-of" });

// Two topics; b has two parts; x is un-homed.
const notes: Expedition = {
  id: "notes",
  title: "Notes",
  summary: "",
  kinds: [{ id: "idea", label: "Idea", color: "slate" }],
  relationshipTypes: [{ id: "part-of", label: "is part of", color: "slate" }],
  concepts: [
    c("t1", { tags: ["topic"] }),
    c("t2", { tags: ["topic"] }),
    c("a"),
    c("b"),
    c("b1"),
    c("b2"),
    c("d"),
    c("x"),
  ],
  relationships: [partOf("a", "t1"), partOf("b", "t1"), partOf("b1", "b"), partOf("b2", "b"), partOf("d", "t2")],
  views: [],
};
const base: OutlineViewSettings = { relationshipTypes: ["part-of"], rootTag: "topic" };

/** An outline as nested ids: `t1(a b(b1 b2))`. */
const shape = (items: OutlineItem[]): string =>
  items
    .map((i) => {
      const folded = i.folded.length ? `[${i.folded.map((f) => f.id).join(" ")}]` : "";
      return `${i.concept.id}${folded}${i.children.length ? `(${shape(i.children)})` : ""}`;
    })
    .join(" ");
const tree = (settings: Partial<OutlineViewSettings> = {}, opts = {}) => {
  const m = outlineTree(notes, { ...base, ...settings }, opts);
  return { roots: shape(m.roots), unsorted: shape(m.unsorted), model: m };
};

describe("outlineTree", () => {
  it("hangs Concepts under their part-of parent, topics at the root, the un-homed under Unsorted", () => {
    expect(tree()).toMatchObject({ roots: "t1(a b(b1 b2)) t2(d)", unsorted: "x" });
  });

  it("without a root tag, every Concept with no parent is a root", () => {
    expect(tree({ rootTag: undefined })).toMatchObject({ roots: "t1(a b(b1 b2)) t2(d) x", unsorted: "" });
  });

  it("placement moves a Concept in this View only, over its part-of", () => {
    expect(tree({ placement: { b: "t2", x: "d" } })).toMatchObject({ roots: "t1(a) t2(b(b1 b2) d(x))", unsorted: "" });
    // A topic placed under another is a child there, not a root.
    expect(tree({ placement: { t2: "a" } }).roots).toBe("t1(a(t2(d)) b(b1 b2))");
    // A placement onto an unknown Concept is ignored.
    expect(tree({ placement: { b: "gone" } }).roots).toBe("t1(a b(b1 b2)) t2(d)");
  });

  it("order puts listed siblings first, in that order, and the rest after in data order", () => {
    expect(tree({ order: { t1: ["b"], b: ["b2", "b1"] } }).roots).toBe("t1(b(b2 b1) a) t2(d)");
    // An id that isn't a child there is ignored.
    expect(tree({ order: { t1: ["d", "b", "a"] } }).roots).toBe("t1(b(b1 b2) a) t2(d)");
  });

  it("hide leaves a Concept out and passes its children up to its parent", () => {
    expect(tree({ hide: ["b"] }).roots).toBe("t1(a b1 b2) t2(d)");
    expect(tree({ hide: ["t2"] })).toMatchObject({ roots: "t1(a b(b1 b2))", unsorted: "d x" });
  });

  it("fold draws Concepts inside their host's line, not as lines", () => {
    const { roots, model } = tree({ fold: { b: ["b1", "b2"], a: ["x"] } });
    expect(roots).toBe("t1(a[x] b[b1 b2]) t2(d)");
    expect(model.unsorted).toEqual([]);
    expect(model.parentOf.get("b1")).toBe("b");
    // A child of a folded Concept hangs under its host.
    expect(tree({ fold: { t1: ["b"] } }).roots).toBe("t1[b](a b1 b2) t2(d)");
  });

  it("draws a part-of cycle once, under Unsorted", () => {
    const loop = { ...notes, relationships: [...notes.relationships, partOf("x", "y"), partOf("y", "x")], concepts: [...notes.concepts, c("y")] };
    const m = outlineTree(loop, base);
    expect(shape(m.unsorted)).toBe("x(y)");
  });

  it("counts lines inside each line, and what's still unread", () => {
    const { model } = tree({}, { covered: new Set(["b1", "a"]) });
    const t1 = model.roots[0]!;
    expect(t1).toMatchObject({ descendants: 4, unread: 2 });
    expect(t1.children[1]).toMatchObject({ descendants: 2, unread: 1 });
  });

  it("hideRead leaves covered Concepts out, passing unread children up, but never the one to keep", () => {
    const covered = new Set(["b", "b1", "d"]);
    expect(tree({}, { covered, hideRead: true }).roots).toBe("t1(a b2) t2");
    expect(tree({}, { covered, hideRead: true, keep: "b" }).roots).toBe("t1(a b(b2)) t2");
    expect(tree({}, { covered, hideRead: false }).roots).toBe("t1(a b(b1 b2)) t2(d)");
    expect(tree({ fold: { a: ["d"] } }, { covered, hideRead: true }).roots).toBe("t1(a b2) t2");
  });

  it("opens openDepth levels, and the path to a match", () => {
    const { model } = tree();
    expect([...defaultOpen(model)]).toEqual(["t1", "t2"]);
    expect([...defaultOpen(model, 2)]).toEqual(["t1", "a", "b", "t2", "d"]);
    expect([...defaultOpen(model, 0)]).toEqual([]);
    expect([...ancestorsOf(model, ["b2", "x"])].sort()).toEqual(["b", "t1", UNSORTED].sort());
  });
});

describe("the compute sample, live", () => {
  const f = openLiveFixture(computeFile);
  afterAll(() => f.dispose());
  const e = readExpedition(f.collections);
  const view = (fileId: string) => e.views.find((v) => v.id === f.view(fileId)) as View;
  const title = (id: string) => e.concepts.find((x) => x.id === id)!.title;

  it("Outline: nine topics in order, siblings in the View's order", () => {
    const m = outlineTree(e, view("outline").settings as OutlineViewSettings);
    expect(m.roots.map((r) => r.concept.id)).toEqual(
      ["t-econ", "t-cost", "t-inside", "t-moe", "t-models", "t-train", "t-data", "t-beyond", "t-sources"].map(f.concept),
    );
    const econ = m.roots[0]!;
    expect(econ.children.slice(0, 3).map((k) => k.concept.id)).toEqual(["fable-release", "fable-gating", "capacity"].map(f.concept));
    expect(title(econ.children[2]!.children[0]!.concept.id)).toBe(title(f.concept("gpu-supply")));
  });

  it("Quadrant: three values across and down, in the enum's order", () => {
    const m = quadrantGrid(e, view("quadrant").settings as QuadrantViewSettings);
    expect(m.x.values.map((v) => v.value)).toEqual(["efficiency", "both", "quality"]);
    expect(m.y.values.map((v) => v.value)).toEqual(["serving", "post-training", "architecture"]);
    expect(m.x.values.reduce((n, v) => n + v.count, 0)).toBe(m.placed);
    // Nothing applied at serving time buys quality.
    expect(m.cells[0]![2]).toEqual([]);
    expect(m.progression).toBe(false);
  });

  it("Quadrant as a ladder: adoption counts on each card, most used first", () => {
    const m = quadrantGrid(e, view("maturity").settings as QuadrantViewSettings);
    expect(m.progression).toBe(true);
    expect(m.x.values.map((v) => v.label)).toEqual(["Research", "Small-scale", "Shipped", "Standard"]);
    const card = (id: string) => m.cells.flat(2).find((k) => k.concept.id === f.concept(id))!;
    expect(card("moe").usedBy).toHaveLength(10);
    expect(card("mla").usedBy).toHaveLength(5);
    const attention = m.cells[m.y.values.findIndex((v) => v.value === "attention")]![2]!;
    expect(attention[0]!.concept.id).toBe(f.concept("mla"));
    // Hidden in this View: gone from the grid and the counts.
    const hidden = quadrantGrid(e, { ...(view("maturity").settings as QuadrantViewSettings), hide: [f.concept("mla")] });
    expect(hidden.placed).toBe(m.placed - 1);
  });

  it("Rates: estimates grouped by quantity, falls turned into multipliers below 1", () => {
    const m = ratesModel(e, view("rates").settings as RatesViewSettings);
    const price = m.groups.find((g) => g.quantity === "Inference price at fixed capability")!;
    expect(price.estimates).toHaveLength(5);
    const all = price.estimates[0]!;
    expect(all).toMatchObject({ direction: "fall", lo: 1 / 900, hi: 1 / 9, independence: "independent" });
    const demand = m.groups.find((g) => g.quantity === "Compute demand")!.estimates[0]!;
    expect(demand).toMatchObject({ lo: 1000, hi: 1000, independence: "interested" });
    expect(demand.source?.id).toBe(f.concept("nvidia"));
    expect(m.independence).toEqual(["independent", "academic", "analyst", "interested"]);
    expect(m.axis).toMatchObject({ min: 0.001, max: 10_000 });
  });
});

describe("logAxis", () => {
  it("spans whole decades past the extremes, always including 1×", () => {
    const a = logAxis([1 / 900, 1000]);
    expect(a).toMatchObject({ min: 0.001, max: 10_000 });
    expect(a.at(1)).toBeCloseTo(3 / 7);
    expect(a.at(0.001)).toBe(0);
    expect(a.at(10_000)).toBe(1);
    expect(a.at(1000)).toBeCloseTo(6 / 7);
    expect(a.ticks.map((t) => t.label)).toEqual(["÷1,000", "÷100", "÷10", "1×", "10×", "100×", "1,000×", "10,000×"]);
    expect(logAxis([2, 5])).toMatchObject({ min: 0.1, max: 10 });
    expect(logAxis([])).toMatchObject({ min: 0.1, max: 10 });
  });

  it("is logarithmic: equal ratios are equal distances, and falls mirror rises around 1×", () => {
    const a = logAxis([0.01, 100]);
    expect(a.at(10) - a.at(1)).toBeCloseTo(a.at(100) - a.at(10));
    expect(a.at(1) - a.at(0.1)).toBeCloseTo(a.at(10) - a.at(1));
  });

  it("clamps values outside the axis to its ends, and ignores ones it can't place", () => {
    const a = logAxis([0, -3, Number.NaN, 5]);
    expect(a).toMatchObject({ min: 0.1, max: 10 });
    expect(a.at(1e6)).toBe(1);
    expect(a.at(1e-6)).toBe(0);
  });

  it("adds ×3 and ÷3 ticks on a short axis", () => {
    expect(logAxis([5]).ticks.map((t) => t.label)).toEqual(["÷10", "÷3", "1×", "3×", "10×"]);
  });

  it("labels multipliers as a reader says them", () => {
    expect([1, 1.41, 3.4, 1000, 0.5, 1 / 900].map(rateLabel)).toEqual(["1×", "1.41×", "3.4×", "1,000×", "÷2", "÷900"]);
  });
});
