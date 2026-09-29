// Where the Map View's tiles come from (docs/ops/basemap-tiles.md), read from
// the build's env. Unset: @umbel/views falls back to OpenFreeMap's styles.
// - VITE_MAP_TILES_URL: our PMTiles archive (the R2 public URL when hosted,
//   the volume or S3 when self-hosted).
// - VITE_MAP_ASSETS_URL: Protomaps' fonts and sprites, if we host a copy.
// - VITE_MAP_FALLBACK_STYLE_LIGHT / _DARK: other fallback style URLs.
import type { BasemapConfig } from "@umbel/views"

const env = (name: string): string | undefined =>
  (import.meta.env[name] as string | undefined)?.trim() || undefined

const light = env("VITE_MAP_FALLBACK_STYLE_LIGHT")
const dark = env("VITE_MAP_FALLBACK_STYLE_DARK")

export const basemap: BasemapConfig = {
  tiles: env("VITE_MAP_TILES_URL"),
  assets: env("VITE_MAP_ASSETS_URL"),
  ...(light || dark
    ? {
        fallbackStyle: {
          ...(light ? { light } : {}),
          ...(dark ? { dark } : {}),
        },
      }
    : {}),
}
