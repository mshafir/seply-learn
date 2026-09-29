// @vitest-environment jsdom
//
// Reading status in the Views (spec §4.2): every View checks the Concepts the
// reader has covered (read or known); the Learning path also skips them in
// its step counts and hides them with "Hide what I've read".
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import computeFile from "@umbel/domain/fixtures/compute.json" with { type: "json" };
import optionsFile from "../fixtures/options.json" with { type: "json" };
import { compute, viewOf } from "../fixtures/index.ts";
import { openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { ExpeditionView } from "../src/ExpeditionView.tsx";
import { focusTree, learningPathOverlay } from "../src/overlay.ts";
import { learningMap } from "../src/scope.ts";
import type { LearningPathSettings } from "../src/model.ts";

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
const live = (file: unknown) => {
  const f = openLiveFixture(file);
  open.push(f);
  return f;
};
const noop = () => {};
const drawnIds = (root: HTMLElement) => new Set([...root.querySelectorAll<HTMLElement>(".react-flow__node")].map((n) => n.dataset.id!));

describe("the read check", () => {
  it("marks covered rows of a Comparison Table", () => {
    const f = live(optionsFile);
    const crema = f.concept("crema-compact");
    const { container } = render(<ExpeditionView collections={f.collections} onSelect={noop} covered={new Set([crema])} />);
    const covered = [...container.querySelectorAll<HTMLElement>("tr[data-covered]")];
    expect(covered.map((r) => r.dataset.concept)).toEqual([crema]);
    expect(covered[0]!.querySelector('[data-testid="read-check"]')).not.toBeNull();
  });

  it("marks covered Concepts on the Learning path canvas, and hides them with hideRead", async () => {
    const f = live(computeFile);
    const attention = f.concept("attention");
    const props = { collections: f.collections, viewId: f.view("learn"), onSelect: noop, transitionMs: 0 };
    const { container, rerender } = render(<ExpeditionView {...props} covered={new Set([attention])} personal={{ hideRead: false }} />);
    await waitFor(() => expect(drawnIds(container).has(attention)).toBe(true), { timeout: 5000 });
    const node = container.querySelector<HTMLElement>(`[data-concept="${attention}"]`)!;
    expect(node.dataset.covered).toBe("true");
    expect(node.querySelector('[data-testid="read-check"]')).not.toBeNull();
    // No "known" badge: the check says it.
    expect(node.textContent).not.toContain("known");

    rerender(<ExpeditionView {...props} covered={new Set([attention])} personal={{ hideRead: true }} />);
    await waitFor(() => expect(drawnIds(container).has(attention)).toBe(false), { timeout: 5000 });
  });
});

describe("Learning path skipping", () => {
  const view = viewOf(compute, "learn", "learning-path");
  const s = view.settings as LearningPathSettings;
  const map = learningMap(compute, s);
  const [target] = [...map.targets.keys()];

  it("step counts exclude what the reader has covered", () => {
    const full = focusTree(compute, s, target, new Set())!;
    const prereq = full.concepts.find((c) => c.id !== target)!.id;
    const known = new Set([prereq]);
    const tree = focusTree(compute, s, target, known);
    const ov = learningPathOverlay(map, tree, { focus: target, known, showAll: false, readingStatus: true });
    const steps = [...ov.badges.values()].flat().filter((b) => b.text.startsWith("step "));
    const before = learningPathOverlay(map, full, { focus: target, known: new Set(), showAll: false });
    const stepsBefore = [...before.badges.values()].flat().filter((b) => b.text.startsWith("step "));
    expect(steps.length).toBeLessThan(stepsBefore.length);
  });

  it("hideKnown hides covered Concepts, but never the selection", () => {
    const core = [...map.core].filter((id) => id !== target);
    const known = new Set(core.slice(0, 2));
    const shown = learningPathOverlay(map, undefined, { known, showAll: false, readingStatus: true });
    for (const id of known) expect(shown.hidden.has(id)).toBe(false);
    const hidden = learningPathOverlay(map, undefined, { known, showAll: false, readingStatus: true, hideKnown: true, selected: core[0] });
    expect(hidden.hidden.has(core[0]!)).toBe(false);
    expect(hidden.hidden.has(core[1]!)).toBe(true);
  });
});
