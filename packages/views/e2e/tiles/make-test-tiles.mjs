// Rebuilds harness/public/tiles/alps-test.pmtiles: Natural Earth 1:50m land
// and borders (public domain) as vector tiles in the Protomaps schema
// (`earth` and `boundaries`), z0–6, cut to the Alps. Not a Protomaps build:
// just enough for the Map screenshots to run the real path (the pmtiles://
// protocol and the Protomaps light and dark flavours) with no network.
//
// Its dependencies aren't in the workspace: copy it into a scratch directory
// and run it there:
//   npm i geojson-vt@4 vt-pbf@3 topojson-client@3 world-atlas@2
//   node --experimental-sqlite make-test-tiles.mjs <repo>/packages/views/harness/public/tiles/alps-test.pmtiles
// Needs the pmtiles CLI (PMTILES_BIN, default `pmtiles`) and Node 22.5+.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";
import { merge, mesh } from "topojson-client";

const out = process.argv[2] ?? "alps-test.pmtiles";
const bin = process.env.PMTILES_BIN ?? "pmtiles";
const MAX = 6;
const BBOX = "5.0,45.0,11.5,48.5";

const topo = JSON.parse(readFileSync("node_modules/world-atlas/countries-50m.json", "utf8"));
const countries = topo.objects.countries;
const collection = (properties, geometry) => ({ type: "FeatureCollection", features: [{ type: "Feature", properties, geometry }] });
const opts = { maxZoom: MAX, indexMaxZoom: MAX, indexMaxPoints: 0, tolerance: 3, extent: 4096, buffer: 64 };
const earth = geojsonvt(collection({ kind: "earth" }, merge(topo, countries.geometries)), opts);
const boundaries = geojsonvt(collection({ kind: "country", kind_detail: 2 }, mesh(topo, countries, (a, b) => a !== b)), opts);

rmSync("world.mbtiles", { force: true });
const db = new DatabaseSync("world.mbtiles");
db.exec("create table metadata (name text, value text); create table tiles (zoom_level int, tile_column int, tile_row int, tile_data blob);");
const meta = {
  name: "seply-e2e-coarse",
  format: "pbf",
  minzoom: "0",
  maxzoom: String(MAX),
  bounds: "-180,-85,180,85",
  center: "0,0,0",
  attribution: "Natural Earth",
  json: JSON.stringify({ vector_layers: [{ id: "earth", fields: {} }, { id: "boundaries", fields: { kind: "String", kind_detail: "Number" } }] }),
};
const putMeta = db.prepare("insert into metadata values (?, ?)");
for (const [k, v] of Object.entries(meta)) putMeta.run(k, v);
const putTile = db.prepare("insert into tiles values (?, ?, ?, ?)");
for (let z = 0; z <= MAX; z++)
  for (let x = 0; x < 2 ** z; x++)
    for (let y = 0; y < 2 ** z; y++) {
      const layers = {};
      const e = earth.getTile(z, x, y);
      const b = boundaries.getTile(z, x, y);
      if (e?.features.length) layers.earth = e;
      if (b?.features.length) layers.boundaries = b;
      if (!Object.keys(layers).length) continue;
      // MBTiles rows count from the bottom (TMS).
      putTile.run(z, x, 2 ** z - 1 - y, gzipSync(vtpbf.fromGeojsonVt(layers, { version: 2 })));
    }
db.close();

const run = (args) => {
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
rmSync("world.pmtiles", { force: true });
run(["convert", "world.mbtiles", "world.pmtiles"]);
rmSync(out, { force: true });
run(["extract", "world.pmtiles", out, `--bbox=${BBOX}`, `--maxzoom=${MAX}`]);
