// The Map View's basemap (ticket 21, spec 2.7 and 7.4), as pure style
// building. No MapLibre instance here, so it is testable without WebGL.
//
// - Our own Protomaps PMTiles (R2 when hosted, the volume or S3 when
//   self-hosted), styled with @protomaps/basemaps' light or dark flavour to
//   follow the theme.
// - Unset tiles: a fallback style URL (OpenFreeMap by default).
// - Always, underneath: the bundled coarse world (Natural Earth), so pins
//   have a frame when detailed tiles can't load. The basemap's own
//   background is dropped so the coarse layer shows through wherever the
//   detailed tiles haven't drawn.
import type { FeatureCollection } from "geojson";
import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";

export type MapTheme = "light" | "dark";

/** Where the Map View's tiles come from. The app fills it from its config (env). */
export type BasemapConfig = {
  /**
   * Our PMTiles archive: an https URL to the .pmtiles file (e.g. an R2 public
   * bucket), or a path on the app's origin. Unset: `fallbackStyle`.
   */
  tiles?: string;
  /** Base URL of Protomaps' fonts and sprites (basemaps-assets); defaults to its public copy. */
  assets?: string;
  /** Style URLs used when `tiles` is unset. Defaults to OpenFreeMap. */
  fallbackStyle?: Partial<Record<MapTheme, string>>;
};

export const PROTOMAPS_ASSETS = "https://protomaps.github.io/basemaps-assets";
export const OPENFREEMAP_STYLES: Record<MapTheme, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export const TILES_SOURCE = "protomaps";
export const COARSE_SOURCE = "umbel-coarse";
export const COARSE_BORDERS_SOURCE = "umbel-coarse-borders";

const OSM = '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>';
const PROTOMAPS = '<a href="https://protomaps.com">Protomaps</a>';
const NATURAL_EARTH = '<a href="https://www.naturalearthdata.com">Natural Earth</a>';

/** The coarse layer's colours, resolved from tokens by the renderer (MapLibre can't read CSS variables). */
export type CoarseColors = { water: string; land: string; border: string };

export type CoarseWorld = { land: FeatureCollection; borders: FeatureCollection };

/** The style URL to fetch when there are no tiles of our own, or undefined when there are. */
export function fallbackStyleUrl(config: BasemapConfig, theme: MapTheme): string | undefined {
  if (config.tiles) return undefined;
  return config.fallbackStyle?.[theme] ?? OPENFREEMAP_STYLES[theme];
}

/** Our PMTiles with the Protomaps flavour for the theme. */
export function protomapsStyle(config: BasemapConfig & { tiles: string }, theme: MapTheme): StyleSpecification {
  const assets = (config.assets ?? PROTOMAPS_ASSETS).replace(/\/$/, "");
  const url = config.tiles.startsWith("pmtiles://") ? config.tiles : `pmtiles://${config.tiles}`;
  return {
    version: 8,
    glyphs: `${assets}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${assets}/sprites/v4/${theme}`,
    sources: { [TILES_SOURCE]: { type: "vector", url, attribution: `${OSM}, ${PROTOMAPS}` } },
    layers: protomapsLayers(TILES_SOURCE, namedFlavor(theme), { lang: "en" }),
  };
}

/**
 * The style the map draws: the coarse world first (sea, land, borders), then
 * the basemap's layers without its background. With no basemap (its style
 * couldn't load), the coarse world alone.
 */
export function withCoarseWorld(base: StyleSpecification | undefined, world: CoarseWorld, colors: CoarseColors): StyleSpecification {
  const coarse: Record<string, SourceSpecification> = {
    [COARSE_SOURCE]: { type: "geojson", data: world.land, attribution: NATURAL_EARTH },
    [COARSE_BORDERS_SOURCE]: { type: "geojson", data: world.borders },
  };
  const coarseLayers: LayerSpecification[] = [
    { id: "umbel-coarse-water", type: "background", paint: { "background-color": colors.water } },
    { id: "umbel-coarse-land", type: "fill", source: COARSE_SOURCE, paint: { "fill-color": colors.land } },
    {
      id: "umbel-coarse-borders",
      type: "line",
      source: COARSE_BORDERS_SOURCE,
      paint: { "line-color": colors.border, "line-width": 0.6 },
    },
  ];
  return {
    version: 8,
    ...(base?.glyphs ? { glyphs: base.glyphs } : {}),
    ...(base?.sprite ? { sprite: base.sprite } : {}),
    sources: { ...coarse, ...(base?.sources ?? {}) },
    layers: [...coarseLayers, ...(base?.layers ?? []).filter((l) => l.type !== "background")],
  };
}

/** Sources that belong to the detailed basemap (not the bundled coarse world). */
export const isDetailSource = (id: string | undefined) => !!id && id !== COARSE_SOURCE && id !== COARSE_BORDERS_SOURCE;
