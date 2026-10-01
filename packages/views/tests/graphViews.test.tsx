// @vitest-environment jsdom
//
// WP-2.1: Cause & Effect (both modes), Evidence, Lineage and Anatomy as live
// Views. Each compute-fixture View renders from live collections through
// ExpeditionView; clicking a risk-mode lever lights its real path; every View
// checks covered Concepts and dims what search didn't match.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import computeFile from "@seply/domain/fixtures/compute.json" with { type: "json" };
import { computeRiskView } from "../fixtures/index.ts";
import { computeRiskViewOp, openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { ExpeditionView, type ExpeditionViewProps } from "../src/ExpeditionView.tsx";
import { readExpedition } from "../src/live.ts";
import { scopeFor, trace } from "../src/scope.ts";
import { drawnRelationships } from "../src/drawn.ts";
import { actsOn } from "../src/overlay.ts";
import { anatomy, anatomyStats, litParts } from "../src/anatomy/anatomy.ts";
import type { AnatomySettings, CauseEffectSettings } from "../src/model.ts";

// jsdom has no layout engine: React Flow needs these to mount.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

let open: LiveFixture[] = [];
afterEach(() => {
  cleanup();
  open.forEach((f) => f.dispose());
  open = [];
});
/** The compute fixture, live, with its economics View in risk mode added (as the harness does). */
const live = () => {
  const f = openLiveFixture(computeFile);
  f.pull([computeRiskViewOp(f)]);
  open.push(f);
  return f;
};
const noop = () => {};
const nodes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".react-flow__node")];
const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`.seply-concept[data-concept="${id}"]`);
const lit = (root: HTMLElement) =>
  new Set(
    [...root.querySelectorAll<HTMLElement>(".seply-concept")].filter((n) => !n.classList.contains("seply-concept--dim")).map((n) => n.dataset.concept!),
  );

/** ExpeditionView with its selection held in state, as the app holds it. */
function Selecting(props: Omit<ExpeditionViewProps, "onSelect" | "selected">) {
  const [selected, setSelected] = useState<string>();
  return <ExpeditionView {...props} selected={selected} onSelect={setSelected} />;
}

describe("every compute-fixture View of these types, from live collections", () => {
  const canvasViews = [
    { file: "economics", type: "cause-and-effect" },
    { file: computeRiskView.id, type: "cause-and-effect" },
    { file: "evidence", type: "evidence" },
    { file: "lineage", type: "lineage" },
  ];
  for (const { file, type } of canvasViews)
    it(`draws ${file} (${type}) with every Concept in its scope`, async () => {
      const f = live();
      const id = file === computeRiskView.id ? file : f.view(file);
      const e = readExpedition(f.collections);
      const view = e.views.find((v) => v.id === id)!;
      const want = scopeFor(e, view).concepts.map((c) => c.id);
      const { container } = render(<ExpeditionView collections={f.collections} viewId={id} onSelect={noop} transitionMs={0} />);
      expect(container.querySelector(`.seply-view[data-view-type="${type}"]`)).not.toBeNull();
      await waitFor(() => expect(nodes(container)).toHaveLength(want.length), { timeout: 5000 });
      expect(new Set(nodes(container).map((n) => n.dataset.id))).toEqual(new Set(want));
    });

  it("draws the Anatomy as nested parts with pins", () => {
    const f = live();
    const { container } = render(<ExpeditionView collections={f.collections} viewId={f.view("anatomy")} onSelect={noop} />);
    const root = container.querySelector<HTMLElement>(".seply-anatomy .seply-part--root")!;
    expect(root.dataset.concept).toBe(f.concept("transformer"));
    // Containment is boxes inside boxes: the KV-cache sits inside Attention,
    // inside the layer stack, inside the transformer.
    const kv = container.querySelector<HTMLElement>(`.seply-part[data-concept="${f.concept("kv-cache")}"]`)!;
    const chain = [];
    for (let el = kv.parentElement?.closest<HTMLElement>(".seply-part"); el; el = el.parentElement?.closest<HTMLElement>(".seply-part"))
      chain.push(el.dataset.concept);
    expect(chain).toEqual([f.concept("attention"), f.concept("layer-stack"), f.concept("transformer")]);
    // The KV-cache collects the most pins (the doc's reading of this View).
    const pins = [...kv.querySelectorAll<HTMLElement>(":scope > .seply-part__pins > .seply-pin")].map((p) => p.textContent);
    expect(pins).toContain("Multi-head Latent Attention (MLA)");
    expect(pins).toHaveLength(5);
    // Pins are coloured by maturity, from the legend.
    expect(container.querySelector(".seply-anatomy__legend")?.textContent).toContain("maturity");
  });
});

describe("Cause & Effect risk mode: clicking a lever", () => {
  it("lights its real path, and draws its real edges instead of the line to the outcome", async () => {
    const f = live();
    const [distillation, costPerToken, usage, demand, price] = ["distillation", "cost-per-token", "usage-growth", "compute-demand", "frontier-price"].map(f.concept);
    const { container } = render(<Selecting collections={f.collections} viewId={computeRiskView.id} transitionMs={0} />);
    await waitFor(() => expect(node(container, distillation)).not.toBeNull(), { timeout: 5000 });
    // By default nothing is dimmed, and the lever says what it really acts on.
    expect(lit(container).size).toBe(nodes(container).length);
    expect(node(container, distillation)!.textContent).toContain("acts on Serving cost per token");

    fireEvent.click(node(container, distillation)!);
    await waitFor(() => expect(node(container, distillation)!.classList).toContain("seply-concept--selected"));
    // Distillation lowers serving cost per token, which raises the price
    // directly and, by lowering it, raises usage growth → compute demand →
    // price. Exactly that path is lit; every other lever and cause dims.
    expect(lit(container)).toEqual(new Set([distillation, costPerToken, usage, demand, price]));
    expect(node(container, costPerToken)!.textContent).toContain("▼ lowered");
    expect(node(container, price)!.textContent).toContain("mixed");

    // What the canvas draws for it: the real edge, not the synthetic one.
    const e = readExpedition(f.collections);
    const s = e.views.find((v) => v.id === computeRiskView.id)!.settings as CauseEffectSettings;
    const scope = scopeFor(e, e.views.find((v) => v.id === computeRiskView.id)!);
    const tr = trace(s, scope.relationships, distillation);
    const drawn = drawnRelationships(scope, s, { shown: () => true, tr, selected: distillation });
    const fromLever = drawn.filter((r) => r.from === distillation);
    expect(fromLever.map((r) => [r.to, !!r.synthetic])).toEqual([[costPerToken, false]]);
    const before = drawnRelationships(scope, s, { shown: () => true }).filter((r) => r.from === distillation);
    expect(before.map((r) => [r.to, !!r.synthetic])).toEqual([[price, true]]);

    // Clicking the canvas background clears it.
    fireEvent.click(container.querySelector(".react-flow__pane")!);
    await waitFor(() => expect(lit(container).size).toBe(nodes(container).length));
  });

  it("gives every lever that doesn't act on the outcome directly an 'acts on' chip", () => {
    const f = live();
    const e = readExpedition(f.collections);
    const view = e.views.find((v) => v.id === computeRiskView.id)!;
    const s = view.settings as CauseEffectSettings;
    const scope = scopeFor(e, view);
    const chips = ["capex", "distillation", "reasoning-load"].map((id) => actsOn(s, scope, f.concept(id)));
    expect(chips).toEqual([
      "acts on Accelerator supply (GPUs/TPUs), Power & grid",
      "acts on Serving cost per token",
      "acts on Compute demand, Serving cost per token",
    ]);
  });
});

describe("reading status and search in these Views", () => {
  it("checks covered Concepts and dims the unmatched on the canvas Views", async () => {
    const f = live();
    const [capex, price] = [f.concept("capex"), f.concept("frontier-price")];
    for (const viewId of [f.view("economics"), computeRiskView.id]) {
      const { container, unmount } = render(
        <ExpeditionView
          collections={f.collections}
          viewId={viewId}
          onSelect={noop}
          transitionMs={0}
          covered={new Set([capex])}
          matches={new Set([capex, price])}
        />,
      );
      await waitFor(() => expect(node(container, capex)).not.toBeNull(), { timeout: 5000 });
      expect(node(container, capex)!.querySelector('[data-testid="read-check"]')).not.toBeNull();
      expect(node(container, price)!.dataset.covered).toBeUndefined();
      expect(lit(container)).toEqual(new Set([capex, price]));
      unmount();
    }
  });

  it("draws suggested Concepts and Relationships dashed (WP-4.3)", async () => {
    const f = live();
    const [capex, price] = [f.concept("capex"), f.concept("frontier-price")];
    const { container } = render(
      <ExpeditionView
        collections={f.collections}
        viewId={f.view("economics")}
        onSelect={noop}
        transitionMs={0}
        suggested={{ concepts: new Set([capex]), relationships: new Set() }}
      />,
    );
    await waitFor(() => expect(node(container, capex)).not.toBeNull(), { timeout: 5000 });
    expect(node(container, capex)!.dataset.suggested).toBe("true");
    expect(node(container, capex)!.className).toContain("seply-concept--suggested");
    expect(node(container, price)!.dataset.suggested).toBeUndefined();
  });

  it("checks covered parts and pins in the Anatomy, and keeps a box lit while a pin inside it matches", () => {
    const f = live();
    const [mla, kv, attention, embedding] = ["mla", "kv-cache", "attention", "embedding"].map(f.concept);
    const { container } = render(
      <ExpeditionView
        collections={f.collections}
        viewId={f.view("anatomy")}
        onSelect={noop}
        covered={new Set([mla, embedding])}
        matches={new Set([mla])}
      />,
    );
    const pin = container.querySelector<HTMLElement>(`.seply-part[data-concept="${kv}"] .seply-pin[data-concept="${mla}"]`)!;
    expect(pin.querySelector('[data-testid="read-check"]')).not.toBeNull();
    expect(pin.classList).not.toContain("seply-pin--dim");
    const part = (id: string) => container.querySelector<HTMLElement>(`.seply-part[data-concept="${id}"]`)!;
    expect(part(embedding).dataset.covered).toBe("true");
    expect(part(kv).classList).not.toContain("seply-part--dim");
    expect(part(attention).classList).not.toContain("seply-part--dim");
    expect(part(embedding).classList).toContain("seply-part--dim");
    expect(container.querySelectorAll(".seply-pin:not(.seply-pin--dim)")).toHaveLength(1);
  });

  it("selects a part or a pin on click, and clears on the background", () => {
    const f = live();
    const selected: (string | undefined)[] = [];
    const { container } = render(
      <ExpeditionView collections={f.collections} viewId={f.view("anatomy")} onSelect={(id) => selected.push(id)} />,
    );
    fireEvent.click(container.querySelector(`.seply-pin[data-concept="${f.concept("flash-attn")}"]`)!);
    fireEvent.click(container.querySelector(`.seply-part[data-concept="${f.concept("ffn")}"] .seply-part__title`)!);
    fireEvent.click(container.querySelector(".seply-anatomy")!);
    expect(selected).toEqual([f.concept("flash-attn"), f.concept("ffn"), undefined]);
  });
});

describe("the Anatomy model", () => {
  const f0 = () => {
    const f = live();
    const e = readExpedition(f.collections);
    const view = e.views.find((v) => v.viewType === "anatomy")!;
    return { f, e, s: view.settings as AnatomySettings };
  };

  it("holds every part and pin of the compute sample, none unplaced", () => {
    const { e, s } = f0();
    const stats = anatomyStats(anatomy(e, s));
    expect(stats).toMatchObject({ parts: 20, pins: 37, depth: 5, unplaced: 0, busiest: { title: "KV-cache", pins: 5 } });
  });

  it("follows the View's placement, order and hide overrides", () => {
    const { f, e, s } = f0();
    const [transformer, tokenizer, serving, embedding, residual, layers] = [
      "transformer",
      "tokenizer",
      "serving",
      "embedding",
      "residual",
      "layer-stack",
    ].map(f.concept);
    const model = anatomy(e, {
      ...s,
      order: { [transformer]: [serving, tokenizer] },
      placement: { [residual]: transformer },
      hide: [embedding],
    } as AnatomySettings);
    const top = model.roots[0]!.parts.map((p) => p.concept.id);
    expect(top.slice(0, 2)).toEqual([serving, tokenizer]);
    expect(top).toContain(residual);
    expect(top).not.toContain(embedding);
    expect(model.roots[0]!.parts.find((p) => p.concept.id === layers)!.parts.map((p) => p.concept.id)).not.toContain(residual);
  });

  it("litParts keeps the ancestors of a match lit", () => {
    const { f, e, s } = f0();
    const model = anatomy(e, s);
    const litIds = litParts(model.roots, new Set([f.concept("flash-attn")]));
    expect(litIds).toEqual(new Set(["attn-kernel", "attention", "layer-stack", "transformer"].map(f.concept)));
  });
});

describe("Concepts show without waiting on React Flow's measuring (#76)", () => {
  // The ResizeObserver above never calls back, as when a measurement is lost
  // between two renders: every Concept must still be visible, with its size.
  it("keeps every Concept visible and sized, before and after a re-render", async () => {
    const f = live();
    const { container } = render(<Selecting collections={f.collections} viewId={f.view("learn")} transitionMs={0} />);
    await waitFor(() => expect(nodes(container).length).toBeGreaterThan(0), { timeout: 5000 });
    const hidden = () => nodes(container).filter((n) => n.style.visibility === "hidden");
    expect(hidden()).toEqual([]);
    fireEvent.click(nodes(container)[0]!);
    await waitFor(() => expect(container.querySelector(".seply-concept--dim")).not.toBeNull());
    expect(hidden()).toEqual([]);
  });
});
