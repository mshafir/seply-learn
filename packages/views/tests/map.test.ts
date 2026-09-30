// The Map View as data: pins, labels and the basemap style, without WebGL.
import { afterEach, describe, expect, it } from "vitest";
import tripFile from "@seply/domain/fixtures/trip.json" with { type: "json" };
import { openLiveFixture, type LiveFixture } from "../fixtures/live.ts";
import { readExpedition } from "../src/live.ts";
import { mapModel, placeLabels, type Pin } from "../src/map/pins.ts";
import { fallbackStyleUrl, OPENFREEMAP_STYLES, protomapsStyle, withCoarseWorld, type CoarseWorld } from "../src/map/basemap.ts";
import type { Expedition } from "../src/model.ts";

let open: LiveFixture[] = [];
afterEach(() => {
  open.forEach((f) => f.dispose());
  open = [];
});
const live = (file: unknown) => {
  const f = openLiveFixture(file);
  open.push(f);
  return { f, e: readExpedition(f.collections) };
};
const mapOf = (e: Expedition) => e.views.find((v) => v.viewType === "map")!;

describe("Map pins", () => {
  it("pins the located places, with the home, and leaves other Kinds out", () => {
    const { f, e } = live(tripFile);
    const m = mapModel(e, mapOf(e));
    expect(m.pins).toHaveLength(12);
    expect(m.pins.every((p) => p.kind === "builtin:place")).toBe(true);
    const home = m.pins.filter((p) => p.home);
    expect(home.map((p) => p.conceptId)).toEqual([f.concept("zurich")]);
    expect(m.pins.find((p) => p.conceptId === f.concept("zermatt"))).toMatchObject({ lat: 46.021, lon: 7.749, color: "var(--kind-teal)" });
    // The stays are events with a place, but the View shows places only.
    expect(m.pins.some((p) => p.conceptId === f.concept("stay-lucerne"))).toBe(false);
    const [w, s, east, n] = m.bounds!;
    expect([w, s, east, n]).toEqual([6.911, 45.984, 8.54, 47.378]);
  });

  it("places a Concept with no coordinates where it is located-in", () => {
    const { e } = live(tripFile);
    const lucerne = e.concepts.find((c) => c.title === "Lucerne")!;
    const withKiosk: Expedition = {
      ...e,
      concepts: [...e.concepts, { id: "kiosk", title: "Lakeside kiosk", kind: "builtin:place" }],
      relationships: [...e.relationships, { from: "kiosk", to: lucerne.id, type: "builtin:located-in" }],
    };
    const pin = mapModel(withKiosk, mapOf(withKiosk)).pins.find((p) => p.conceptId === "kiosk");
    expect(pin).toMatchObject({ lat: lucerne.geo![0], lon: lucerne.geo![1], via: lucerne.id });
  });

  it("keeps a label only where it fits, right of the pin or else left", () => {
    const pin = (id: string, title = id): Pin => ({ conceptId: id, title, kind: "builtin:place", lat: 0, lon: 0, home: false });
    const labels = placeLabels(
      [
        { x: 100, y: 100, pin: pin("a", "Alpha") },
        { x: 100, y: 100, pin: pin("b", "Beta") }, // on a: one label each side
        { x: 100, y: 100, pin: pin("e", "Epsilon") }, // a third on the same spot: no room
        { x: 300, y: 100, pin: pin("c", "Gamma") },
        { x: 250, y: 100, pin: pin("d", "Delta") }, // its right side runs into c's pin
      ],
      "b",
    );
    // The selected pin is placed first, so it keeps the right side.
    expect(labels.get("b")).toBe("right");
    expect(labels.get("a")).toBe("left");
    expect(labels.has("e")).toBe(false);
    expect(labels.get("d")).toBe("left");
    expect(labels.get("c")).toBe("right");
  });
});

describe("Basemap", () => {
  const world: CoarseWorld = { land: { type: "FeatureCollection", features: [] }, borders: { type: "FeatureCollection", features: [] } };
  const colors = { water: "rgba(1, 2, 3, 1)", land: "rgba(4, 5, 6, 1)", border: "rgba(7, 8, 9, 1)" };

  it("uses our PMTiles with the Protomaps flavour for the theme", () => {
    const light = protomapsStyle({ tiles: "https://tiles.example.org/basemap.pmtiles" }, "light");
    const dark = protomapsStyle({ tiles: "https://tiles.example.org/basemap.pmtiles" }, "dark");
    expect(light.sources.protomaps).toMatchObject({ type: "vector", url: "pmtiles://https://tiles.example.org/basemap.pmtiles" });
    expect(light.sprite).toBe("https://protomaps.github.io/basemaps-assets/sprites/v4/light");
    expect(dark.sprite).toBe("https://protomaps.github.io/basemaps-assets/sprites/v4/dark");
    const earth = (s: typeof light) => (s.layers.find((l) => l.id === "earth") as { paint: Record<string, unknown> }).paint["fill-color"];
    expect(earth(light)).not.toEqual(earth(dark));
    expect(protomapsStyle({ tiles: "x.pmtiles", assets: "https://assets.example.org/" }, "light").glyphs).toBe(
      "https://assets.example.org/fonts/{fontstack}/{range}.pbf",
    );
  });

  it("falls back to OpenFreeMap only when no tiles are configured", () => {
    expect(fallbackStyleUrl({}, "light")).toBe(OPENFREEMAP_STYLES.light);
    expect(fallbackStyleUrl({}, "dark")).toBe(OPENFREEMAP_STYLES.dark);
    expect(fallbackStyleUrl({ fallbackStyle: { dark: "https://example.org/dark.json" } }, "dark")).toBe("https://example.org/dark.json");
    expect(fallbackStyleUrl({ tiles: "x.pmtiles" }, "light")).toBeUndefined();
  });

  it("always draws the coarse world first, and drops the basemap's background so it shows through", () => {
    const base = protomapsStyle({ tiles: "x.pmtiles" }, "light");
    const style = withCoarseWorld(base, world, colors);
    expect(style.layers.slice(0, 3).map((l) => l.id)).toEqual(["seply-coarse-water", "seply-coarse-land", "seply-coarse-borders"]);
    expect(style.layers.filter((l) => l.type === "background").map((l) => l.id)).toEqual(["seply-coarse-water"]);
    expect(style.layers.length).toBe(base.layers.length - 1 + 3);
    expect(style.glyphs).toBe(base.glyphs);
    // With no basemap (it couldn't load), the coarse world alone.
    const alone = withCoarseWorld(undefined, world, colors);
    expect(alone.layers.map((l) => l.id)).toEqual(["seply-coarse-water", "seply-coarse-land", "seply-coarse-borders"]);
    expect(Object.keys(alone.sources)).toEqual(["seply-coarse", "seply-coarse-borders"]);
  });
});
