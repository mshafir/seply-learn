// Comparison Table as data, from the synthetic options fixture (imported and
// read live) and the compute sample's reference tables.
import { afterEach, describe, expect, it } from "vitest";
import computeFile from "@umbel/domain/fixtures/compute.json" with { type: "json" };
import { builtinId, relKey } from "@umbel/domain";
import optionsFile from "../fixtures/options.json" with { type: "json" };
import { openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { readExpedition } from "../src/live.ts";
import { comparisonTable, formatValue } from "../src/table.ts";
import type { ComparisonTableSettings, Expedition } from "../src/model.ts";

let open: LiveFixture[] = [];
afterEach(() => {
  open.forEach((f) => f.dispose());
  open = [];
});
const live = (file: unknown) => {
  const f = openLiveFixture(file);
  open.push(f);
  return f;
};
const tableOf = (e: Expedition, label?: string) => {
  const v = e.views.find((x) => x.viewType === "comparison-table" && (!label || x.label === label))!;
  return comparisonTable(e, v.settings as ComparisonTableSettings);
};

describe("Comparison Table", () => {
  it("rows are the options, sorted by price", () => {
    const t = tableOf(readExpedition(live(optionsFile).collections));
    expect(t.rows.map((r) => r.concept.title)).toEqual([
      "Kettleworks Duo",
      "Crema Compact",
      "Stillroom batch brewer",
      "Brewline 40",
      "Pourmaster Pro",
    ]);
  });

  it("bands criteria by priority, facts first, and lists dropped criteria under the table", () => {
    const t = tableOf(readExpedition(live(optionsFile).collections));
    expect(t.columns.map((c) => `${c.band}: ${c.label}`)).toEqual([
      "Facts: Price",
      "Facts: Cups a day",
      "Facts: Type",
      "Must-haves: 40 cups a day",
      "Must-haves: Under $1,500 all-in",
      "Nice-to-haves: Plumbed-in water",
      "Nice-to-haves: Frothed milk",
    ]);
    expect(t.bands).toEqual([
      { band: "Facts", span: 3 },
      { band: "Must-haves", span: 2 },
      { band: "Nice-to-haves", span: 2 },
    ]);
    expect(t.dropped.map((c) => c.title)).toEqual(["Quiet on the open-plan floor"]);
  });

  it('shows "?" where no verdict was given, and tints a row that fails a must-have', () => {
    const t = tableOf(readExpedition(live(optionsFile).collections));
    const row = (title: string) => t.rows.find((r) => r.concept.title === title)!;
    const crema = row("Crema Compact");
    expect(crema.cells.map((c) => c.kind)).toEqual(["fact", "no-fact", "fact", "unknown", "verdict", "unknown", "verdict"]);
    expect(crema.failsMustHave).toBe(false);
    expect(row("Kettleworks Duo").failsMustHave).toBe(true); // 30 cups
    expect(row("Pourmaster Pro").failsMustHave).toBe(true); // over budget
    // Failing a nice-to-have doesn't knock an option out.
    expect(row("Stillroom batch brewer").failsMustHave).toBe(false);
    expect(row("Brewline 40").standing).toBe("chosen");
    const partly = row("Brewline 40").cells[6];
    expect(partly.kind === "verdict" && partly.tone).toBe("partly");
  });

  it("follows edits: another tab's verdict fills a gap", () => {
    const f = live(optionsFile);
    f.pull([
      {
        kind: "relationship.add",
        target: relKey(f.concept("crema-compact"), builtinId("fails"), f.concept("forty-cups")),
        value: { note: "a 1.8 L tank" },
      },
    ]);
    const crema = tableOf(readExpedition(f.collections)).rows.find((r) => r.concept.title === "Crema Compact")!;
    expect(crema.cells[3]).toMatchObject({ kind: "verdict", tone: "fails" });
    expect(crema.failsMustHave).toBe(true);
  });

  it("draws the compute sample's reference tables: facts only, no bands", () => {
    const e = readExpedition(live(computeFile).collections);
    for (const label of ["Open models", "Techniques"]) {
      const t = tableOf(e, label);
      expect(t.rows.length).toBeGreaterThan(3);
      expect(t.bands).toBeUndefined();
      expect(t.columns.every((c) => c.band === "Facts")).toBe(true);
    }
  });

  it("formats values by Attribute type", () => {
    expect(formatValue(1350, { id: "p", label: "Price", type: "money" })).toBe("$1,350");
    expect(formatValue(671, { id: "t", label: "Total", type: "number", unit: "B" })).toBe("671 B");
    expect(formatValue(true)).toBe("yes");
  });
});
