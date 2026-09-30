// @vitest-environment jsdom
//
// Outline, Quadrant and Rates as live Views through ExpeditionView: the read
// check on covered Concepts (and the Outline's "Hide what I've read"),
// search dimming, selection, and a pull re-deriving the View.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import computeFile from "@seply/domain/fixtures/compute.json" with { type: "json" };
import { builtinId, relKey } from "@seply/domain";
import { openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { ExpeditionView } from "../src/ExpeditionView.tsx";

let open: LiveFixture[] = [];
afterEach(() => {
  cleanup();
  open.forEach((f) => f.dispose());
  open = [];
});
const live = () => {
  const f = openLiveFixture(computeFile);
  open.push(f);
  return f;
};
const noop = () => {};
const line = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-concept="${id}"]`);

describe("Outline", () => {
  it("draws the topics, open one level, with summaries", () => {
    const f = live();
    const { container, getByText } = render(<ExpeditionView collections={f.collections} viewId={f.view("outline")} onSelect={noop} />);
    expect(container.querySelector('.seply-view[data-view-type="outline"]')).not.toBeNull();
    expect(getByText("Compute economics")).toBeTruthy();
    // Topics are open: their Concepts show; deeper ones don't.
    expect(line(container, f.concept("capacity"))).not.toBeNull();
    expect(line(container, f.concept("gpu-supply"))).toBeNull();
    expect(getByText("Why capacity is scarce, how fast demand grows, and when it might ease")).toBeTruthy();
  });

  it("the chevron opens a line without selecting it; clicking a line selects it", () => {
    const f = live();
    const onSelect = vi.fn();
    const { container, getByRole } = render(<ExpeditionView collections={f.collections} viewId={f.view("outline")} onSelect={onSelect} />);
    fireEvent.click(getByRole("button", { name: "Open Capacity constraint" }));
    expect(line(container, f.concept("gpu-supply"))).not.toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(line(container, f.concept("gpu-supply"))!);
    expect(onSelect).toHaveBeenCalledWith(f.concept("gpu-supply"));
  });

  it("reveals a Concept selected elsewhere: the path to it opens", () => {
    const f = live();
    const props = { collections: f.collections, viewId: f.view("outline"), onSelect: noop };
    const { container, rerender } = render(<ExpeditionView {...props} />);
    const gpu = f.concept("gpu-supply");
    expect(line(container, gpu)).toBeNull();
    rerender(<ExpeditionView {...props} selected={gpu} />);
    expect(line(container, gpu)!.className).toContain("--selected");
  });

  it("checks covered Concepts, and hides them with hideRead (never the selection)", () => {
    const f = live();
    const [capacity, gpu] = [f.concept("capacity"), f.concept("gpu-supply")];
    const covered = new Set([capacity]);
    const props = { collections: f.collections, viewId: f.view("outline"), onSelect: noop, covered };
    const { container, rerender } = render(<ExpeditionView {...props} personal={{ hideRead: false }} />);
    const el = line(container, capacity)!;
    expect(el.dataset.covered).toBe("true");
    expect(el.querySelector('[data-testid="read-check"]')).not.toBeNull();

    rerender(<ExpeditionView {...props} personal={{ hideRead: true }} />);
    expect(line(container, capacity)).toBeNull();
    // Its unread parts move up to the topic.
    expect(line(container, gpu)).not.toBeNull();

    rerender(<ExpeditionView {...props} personal={{ hideRead: true }} selected={capacity} />);
    expect(line(container, capacity)).not.toBeNull();
  });

  it("search dims other lines and opens the path to each match", () => {
    const f = live();
    const gpu = f.concept("gpu-supply");
    const { container } = render(<ExpeditionView collections={f.collections} viewId={f.view("outline")} onSelect={noop} matches={new Set([gpu])} />);
    expect(line(container, gpu)!.className).not.toContain("--dim");
    expect(line(container, f.concept("capacity"))!.className).toContain("--dim");
  });

  it("follows an edit pulled from another tab", () => {
    const f = live();
    const { container } = render(<ExpeditionView collections={f.collections} viewId={f.view("outline")} onSelect={noop} />);
    act(() =>
      f.pull([
        { kind: "concept.create", target: "new-one", value: { title: "A new idea", kind: builtinId("idea"), summary: "Arrived from another tab" } },
        { kind: "relationship.add", target: relKey("new-one", builtinId("part-of"), f.concept("t-econ")), value: {} },
      ]),
    );
    expect(line(container, "new-one")?.textContent).toContain("Arrived from another tab");
  });
});

describe("Quadrant", () => {
  it("draws the grid with the axis names, checks covered cards and dims non-matches", () => {
    const f = live();
    const mla = f.concept("mla");
    const { container, getByText } = render(
      <ExpeditionView
        collections={f.collections}
        viewId={f.view("maturity")}
        onSelect={noop}
        covered={new Set([mla])}
        matches={new Set([mla])}
        selected={mla}
      />,
    );
    expect(container.querySelector(".seply-quadrant--ladder")).not.toBeNull();
    expect(getByText("Area ↓ · Maturity →")).toBeTruthy();
    const card = line(container, mla)!;
    expect(card.dataset.covered).toBe("true");
    expect(card.className).toContain("--selected");
    expect(card.querySelector(".seply-quadrant__uses")?.textContent).toBe("5");
    expect(card.title).toMatch(/^.*\nUsed by /s);
    expect(line(container, f.concept("moe"))!.className).toContain("--dim");
  });

  it("without progression it's a plain grid", () => {
    const f = live();
    const { container } = render(<ExpeditionView collections={f.collections} viewId={f.view("quadrant")} onSelect={noop} />);
    expect(container.querySelector(".seply-quadrant")).not.toBeNull();
    expect(container.querySelector(".seply-quadrant--ladder")).toBeNull();
    expect(container.querySelectorAll(".seply-quadrant__cell")).toHaveLength(9);
  });
});

describe("Rates", () => {
  it("draws every estimate on the axis, checks covered ones and dims non-matches", () => {
    const f = live();
    const onSelect = vi.fn();
    const demand = f.concept("e-demand");
    const { container, getByText } = render(
      <ExpeditionView collections={f.collections} viewId={f.view("rates")} onSelect={onSelect} covered={new Set([demand])} matches={new Set([demand])} />,
    );
    expect(container.querySelectorAll(".seply-rates__estimate")).toHaveLength(17);
    expect(getByText("Inference price at fixed capability")).toBeTruthy();
    const row = line(container, demand)!;
    expect(row.dataset.covered).toBe("true");
    expect(row.title).toContain("Source: Nvidia");
    expect(row.querySelector(".seply-rates__point")).not.toBeNull();
    expect(line(container, f.concept("e-price-all"))!.querySelector(".seply-rates__range")).not.toBeNull();
    expect(line(container, f.concept("e-price-all"))!.className).toContain("--dim");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(demand);
  });
});
