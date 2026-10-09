// Where the Map View's tiles come from (docs/ops/basemap-tiles.md): the
// server's runtime config (`GET /api/map-config`: MAP_TILES_URL and
// MAP_ASSETS_URL, so a prebuilt self-host image can point at its own
// extract), over the build's env. Unset: @seply/views falls back to
// OpenFreeMap's styles.
// - VITE_MAP_TILES_URL: our PMTiles archive (the R2 public URL when hosted,
//   the volume or S3 when self-hosted).
// - VITE_MAP_ASSETS_URL: Protomaps' fonts and sprites, if we host a copy.
// - VITE_MAP_FALLBACK_STYLE_LIGHT / _DARK: other fallback style URLs.
import { useEffect, useState } from "react"
import type { BasemapConfig } from "@seply/views"
import { getMapConfig } from "@/lib/api"

const env = (name: string): string | undefined =>
  (import.meta.env[name] as string | undefined)?.trim() || undefined

const light = env("VITE_MAP_FALLBACK_STYLE_LIGHT")
const dark = env("VITE_MAP_FALLBACK_STYLE_DARK")

const built: BasemapConfig = {
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

let loaded: BasemapConfig | undefined
// Asked once, when this module loads, so it has usually answered before a
// Map View opens.
const runtime: Promise<BasemapConfig> = getMapConfig().then(
  ({ tiles, assets }) =>
    (loaded = {
      ...built,
      ...(tiles ? { tiles } : {}),
      ...(assets ? { assets } : {}),
    })
)

/** The basemap: the build's until the server's runtime config has answered. */
export function useBasemap(): BasemapConfig {
  const [config, setConfig] = useState(() => loaded ?? built)
  useEffect(() => {
    let live = true
    runtime.then((c) => live && setConfig(c))
    return () => {
      live = false
    }
  }, [])
  return config
}
