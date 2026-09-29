// @vitest-environment jsdom
//
// ExpeditionView on live collections: both Views render from the imported
// fixtures, another tab's edit (a pull) reflows them in place, and switching
// Views swaps renderers.
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import computeFile from "@umbel/domain/fixtures/compute.json" with { type: "json" };
import { builtinId, relKey } from "@umbel/domain";
import optionsFile from "../fixtures/options.json" with { type: "json" };
import { openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { ExpeditionView } from "../src/ExpeditionView.tsx";

// jsdom has no layout engine: React Flow needs these to mount.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([^)]+)\)/)?.[1];
      this.m22 = scale ? Number(scale) : 1;
    }
  } as unknown as typeof DOMMatrixReadOnly;
});

let open: LiveFixture[] = [];
afterEach(() => {
  cleanup();
  open.forEach((f) => f.dispose());
  open = [];
});
const live = (file: unknown) => {
  const f = openLiveFixture(file);
  open.push(f);
  return f;
};
const noop = () => {};

/** Every Concept drawn on the canvas, by id, with its node's transform. */
const drawn = (root: HTMLElement) =>
  new Map(
    [...root.querySelectorAll<HTMLElement>(".react-flow__node")].map((n) => [n.dataset.id!, n.style.transform]),
  );

describe("Learning path on live collections", () => {
  it("draws the compute fixture's core, and reflows in place when another tab's edit arrives", async () => {
    const f = live(computeFile);
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ExpeditionView collections={f.collections} viewId={f.view("learn")} onSelect={noop} transitionMs={0} />
      </div>,
    );
    await waitFor(() => expect(drawn(container).size).toBe(24), { timeout: 5000 });
    const before = drawn(container);

    // Watch for any drawn Concept being taken off the canvas: that's a flicker.
    const removed: string[] = [];
    const watch = new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.removedNodes)
          if (n instanceof HTMLElement && n.classList.contains("react-flow__node")) removed.push(n.dataset.id!);
    });
    watch.observe(container, { childList: true, subtree: true });

    // Another tab adds a technique that needs MLA: a new target, drawn as core.
    const mla = f.concept("mla");
    act(() =>
      f.pull([
        { kind: "concept.create", target: "c-new", value: { title: "Newer attention", kind: builtinId("idea"), tags: ["technique"] } },
        { kind: "relationship.add", target: relKey(mla, builtinId("prerequisite"), "c-new"), value: {} },
      ]),
    );
    await waitFor(() => expect(drawn(container).has("c-new")).toBe(true), { timeout: 5000 });
    watch.disconnect();

    const after = drawn(container);
    expect(removed).toEqual([]);
    for (const id of before.keys()) expect(after.has(id)).toBe(true);
    // It reflowed: the layout re-ran with the new Concept, moving others.
    expect([...before].filter(([id, t]) => after.get(id) !== t).length).toBeGreaterThan(0);
    expect(container.querySelector('[data-concept="c-new"]')?.textContent).toContain("Newer attention");
  });

  it("shows a title edit from another tab without re-laying out", async () => {
    const f = live(computeFile);
    const { container } = render(<ExpeditionView collections={f.collections} viewId={f.view("learn")} onSelect={noop} transitionMs={0} />);
    await waitFor(() => expect(drawn(container).size).toBe(24), { timeout: 5000 });
    const before = drawn(container);
    const attention = f.concept("attention");
    act(() => f.pull([{ kind: "concept.set", target: attention, path: "title", value: "Attention (renamed)" }]));
    await waitFor(() => expect(container.querySelector(`[data-concept="${attention}"]`)?.textContent).toContain("Attention (renamed)"));
    expect(drawn(container)).toEqual(before);
  });
});

describe("Comparison Table on live collections", () => {
  it('draws bands, "?" cells and the must-have fail tint, and follows a pull', async () => {
    const f = live(optionsFile);
    const { container, getByText } = render(<ExpeditionView collections={f.collections} onSelect={noop} />);
    const bands = [...container.querySelectorAll(".umbel-band-head")].map((b) => b.textContent);
    expect(bands).toEqual(["Facts", "Must-haves", "Nice-to-haves"]);
    const rowOf = (title: string) => getByText(title).closest("tr")!;
    expect(rowOf("Kettleworks Duo").className).toContain("umbel-table__row--fails");
    expect(rowOf("Brewline 40").className).toContain("umbel-table__row--chosen");
    expect(rowOf("Crema Compact").className).not.toContain("umbel-table__row--fails");
    expect(rowOf("Crema Compact").querySelectorAll(".umbel-table__unknown")).toHaveLength(2);
    expect(container.querySelector(".umbel-table__dropped")?.textContent).toContain("Quiet on the open-plan floor");

    act(() =>
      f.pull([
        {
          kind: "relationship.add",
          target: relKey(f.concept("crema-compact"), builtinId("fails"), f.concept("forty-cups")),
          value: { note: "a 1.8 L tank" },
        },
      ]),
    );
    await waitFor(() => expect(rowOf("Crema Compact").className).toContain("umbel-table__row--fails"));
    expect(rowOf("Crema Compact").querySelectorAll(".umbel-table__unknown")).toHaveLength(1);
    expect(rowOf("Crema Compact").textContent).toContain("a 1.8 L tank");
  });
});

describe("View switching", () => {
  it("swaps renderers by View, and falls back to the best View when the selected one is gone", async () => {
    const f = live(computeFile);
    const props = { collections: f.collections, onSelect: noop, transitionMs: 0 };
    const { container, rerender } = render(<ExpeditionView {...props} viewId={f.view("learn")} />);
    await waitFor(() => expect(drawn(container).size).toBe(24), { timeout: 5000 });

    rerender(<ExpeditionView {...props} viewId={f.view("models")} />);
    const shown = () => container.querySelector<HTMLElement>(".umbel-view");
    expect(shown()?.dataset.viewType).toBe("comparison-table");
    expect(container.querySelector(".react-flow")).toBeNull();

    rerender(<ExpeditionView {...props} viewId={f.view("learn")} />);
    expect(shown()?.dataset.viewType).toBe("learning-path");
    await waitFor(() => expect(drawn(container).size).toBe(24), { timeout: 5000 });

    // The selected View deleted in another tab: the best View (the outline,
    // not drawn yet) takes its place.
    act(() => f.pull([{ kind: "view.delete", target: f.view("learn") }]));
    await waitFor(() => expect(shown()?.dataset.view).toBe(f.view("outline")));
  });
});
