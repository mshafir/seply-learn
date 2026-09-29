// The bundled coarse world layer: Natural Earth 1:50m countries (public
// domain, via world-atlas), as land and borders. It ships with the app (in
// the Map View's lazy chunk), so pins always have a frame, offline or when
// detailed tiles can't load.
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries from "world-atlas/countries-50m.json";
import type { CoarseWorld } from "./basemap.ts";

let world: CoarseWorld | undefined;

export function coarseWorld(): CoarseWorld {
  if (world) return world;
  const topo = countries as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
  world = {
    land: feature(topo, topo.objects.land) as CoarseWorld["land"],
    borders: {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: mesh(topo, topo.objects.countries, (a, b) => a !== b) }],
    },
  };
  return world as CoarseWorld;
}
