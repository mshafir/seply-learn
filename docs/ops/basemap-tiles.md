# Map tiles: our PMTiles basemap

Spec: [02-architecture.md §2.7](../spec/v1/02-architecture.md) (map tiles) and [07-design-system.md §7.4](../spec/v1/07-design-system.md#74-dark-mode). Decision: [ticket 21](../wayfinder/mindmaps-v1/tickets/21-map-basemap-for-hosted-and-self-hosted.md). Work package: WP-2.3 (#16).

The Map View draws three layers, bottom to top:

1. **The coarse world** (always): Natural Earth 1:50m land and borders, bundled with the Map View's code (`world-atlas`, about 750 KB raw and 200 KB gzipped). Pins always have a frame, offline too.
2. **The detailed basemap:** our own copy of a Protomaps PMTiles build, styled with `@protomaps/basemaps`' **light** or **dark** flavour to follow the theme. With no tiles configured, the **OpenFreeMap** styles are the fallback (positron and dark).
3. **Pins:** HTML markers, one per located Concept.

If the detailed tiles (or the fallback style) can't load, the coarse world shows alone with a quiet "Detailed map unavailable" note.

## Configuration

The web build reads these (Vite env, so they're fixed at build time: `apps/web/src/lib/basemap.ts`):

| Variable | What | Unset |
|---|---|---|
| `VITE_MAP_TILES_URL` | The public URL of our `.pmtiles` archive (or a path on the app's origin). | OpenFreeMap's styles |
| `VITE_MAP_ASSETS_URL` | Base URL of a copy of Protomaps' fonts and sprites ([basemaps-assets](https://github.com/protomaps/basemaps-assets)). | `https://protomaps.github.io/basemaps-assets` |
| `VITE_MAP_FALLBACK_STYLE_LIGHT` / `_DARK` | Other fallback style URLs. | OpenFreeMap positron / dark |

The Deploy workflow passes the repo **variable** `MAP_TILES_URL` as `VITE_MAP_TILES_URL`.

## Making the extract

`scripts/basemap-tiles.mjs` extracts a region and zoom range from the newest public daily build (`https://build.protomaps.com/<YYYYMMDD>.pmtiles`) with the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles), measures the file, appends the size to the table below, and uploads it to R2.

```sh
# Install the CLI: a release binary from github.com/protomaps/go-pmtiles, or
go install github.com/protomaps/go-pmtiles@latest   # installs it as go-pmtiles

# See how big an extract would be without downloading it
node scripts/basemap-tiles.mjs extract --maxzoom=10 --dry-run

# Extract (the whole world to z10 by default), measure and record
node scripts/basemap-tiles.mjs extract --maxzoom=10
node scripts/basemap-tiles.mjs extract --maxzoom=14 --bbox=5.9,45.8,10.5,47.8   # a region

# Upload to R2 (bucket seply-tiles, key basemap.pmtiles by default)
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/basemap-tiles.mjs upload basemap-z10.pmtiles

# Or both
node scripts/basemap-tiles.mjs all --maxzoom=10
```

- **Zoom:** the planned default is the **whole world to z10** (regions, cities, main roads). Beyond its max zoom MapLibre overzooms the vector tiles, so they stay sharp but gain no detail. Go higher (z12–z14) only for a region, or once the size is measured and acceptable.
- **Upload** uses R2's S3 API with credentials derived from the API token (the token's id as the access key, the SHA-256 of the token as the secret), so the token needs **Workers R2 Storage: Edit** and no separate R2 key pair is needed. `pmtiles upload` does a multipart upload, so the size isn't limited by `wrangler r2 object put`'s 300 MiB.
- Extracts land in the repo root as `basemap-*.pmtiles`, which git ignores.

## Serving it (owner, once)

1. **Create the bucket:** `pnpm --filter @seply/worker exec wrangler r2 bucket create seply-tiles`.
2. **Make it public:** connect a custom domain (e.g. `tiles.<production domain>`) under _R2 → seply-tiles → Settings → Public access_. The `r2.dev` URL works for testing but is rate-limited.
3. **CORS**, so the app's origins can make range requests: allow `GET` and `HEAD` from the production and preview origins, allow the `Range` and `If-Match` request headers, and expose `ETag`, `Content-Length` and `Content-Range`.
4. **Set the repo variable** `MAP_TILES_URL` to the public URL of `basemap.pmtiles`, and redeploy.

Self-hosting (M6) serves the same file from the volume or S3, with the same variable.

## Measured extracts

Sizes of real extracts, appended by the script. The planning session's figures (about 1–2 GB to z12, about 120 GB for the full planet) were never verified.

| Date | Build | Area | Max zoom | Size |
|---|---|---|---|---|
<!-- measured extracts: the script appends rows above this line -->

**Not measured yet.** The WP-2.3 build session couldn't reach `build.protomaps.com` (its network policy blocks the host), so the first real extract, with `--dry-run` first, is the owner's to run. The session did check the pipeline end to end on a local archive: `pmtiles extract` of a Natural Earth test archive (world, z0–6, 947 KB) to the Alps (`--bbox=5.0,45.0,11.5,48.5`, 55 KB), and `pmtiles upload` to a file bucket.

## The harness's test extract

`packages/views/harness/public/tiles/alps-test.pmtiles` (55 KB) is **not a Protomaps build**: it's Natural Earth 1:50m land and borders written in the Protomaps schema (`earth` and `boundaries` layers, z0–6), cut to the Alps with `pmtiles extract`. The harness e2e serves it so the Map screenshots exercise the real path (the `pmtiles://` protocol, the Protomaps flavours, light and dark) without the network. `packages/views/e2e/tiles/make-test-tiles.mjs` rebuilds it.
