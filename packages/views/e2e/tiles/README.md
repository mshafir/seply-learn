# Test tiles

`harness/public/tiles/alps-test.pmtiles` (55 KB) is what the harness e2e serves as "our PMTiles" (`?tiles=/tiles/alps-test.pmtiles`), so the Map screenshots run the real path, the `pmtiles://` protocol and the Protomaps light and dark flavours, without the network.

It is **not a Protomaps build**: it is Natural Earth 1:50m land and borders (public domain, from `world-atlas`) written as vector tiles in the Protomaps schema (`earth` and `boundaries` layers), z0–6, then cut to the Alps with `pmtiles extract`. `make-test-tiles.mjs` rebuilds it; its header says how. The real basemap and its script are in [docs/ops/basemap-tiles.md](../../../../docs/ops/basemap-tiles.md).
