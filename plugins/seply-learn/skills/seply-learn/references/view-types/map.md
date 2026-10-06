---
id: map
name: Map
status: proven (idea); rendering needs a real basemap
answers: "Where is everything, and what's near what?"
proven-in: [vacation/map]
---

# Map

Located Concepts **on a real, zoomable map** (Leaflet or Mapbox/MapLibre-style tiles), coloured by Kind and status, with clusters that break apart as you zoom. For anything with geography (trips, sites, events, history) the location *is* the structure. The map shows it directly, with no edges needed.

## Instructions

1. **Place every Concept that has a location** at its coordinates.
   - Places are regions or points (Region D, a state beach).
   - Things carry the location of where they are (the chosen resort).
2. **Colour by what matters for the reading.** Kind (option vs place vs day trip), or status: chosen, still in play, ruled out.
3. **Anchor on home or origin** where the source has one ("within 2–3 hours of home"). Show it, and optionally a travel-time ring.
4. **Cluster** dense areas at low zoom and expand them as the reader zooms in.
5. **Don't draw containment.** Being inside a region is shown by position, so `located-in` edges are redundant. Draw only relationships that mean something spatially ("day trip from").
6. **Read it** at two scales: the overview (which regions were considered, how far each is) and a zoomed cluster (what's around the chosen place).

## Draws on

- **Kinds:** *place* (regions, points of interest) and any *thing* with a location. *event* could join when events have places.
- **Relationship Types:** `located-in` sets position for Concepts without their own coordinates (they sit on or near their region). `similar-to` / "day trip from" draws spatial links. Verdict Relationships (`fails`, `chosen`) can drive marker status.
- **Attributes:** location (lat/lon, optionally a boundary for regions), drive time, price. These feed popups and marker size.
- **Settings:** which Kinds to show, what colours the markers (Kind or status), the home/origin Concept, and the initial viewport (fit all, or focus on the chosen Concept).

## Layout & interaction

- Tile basemap with markers styled per Kind. Clusters show counts. Clicking a marker opens a popup with title, summary and key Attributes, and a link that opens the Concept alongside.
- Syncs with the rest of the app: selecting a Concept elsewhere pans to it, and search dims markers.
- Optional overlays: a drive-time isochrone from home, region outlines, lines for spatial relationships.
- **Rendering options** (to decide; see the map-basemap fog on the planning map):
  - **Leaflet** is simple and raster-tile friendly.
  - **MapLibre GL** is open source and vector-tile based, with smooth zoom.
  - **Mapbox GL JS** is polished, but needs an access token and a proprietary license, which is awkward for self-hosting.
  - Tiles must work for self-hosters without API keys and offline in the desktop app. A self-hosted vector tile file (e.g. a PMTiles extract) is one route. OSM's public tile servers have usage limits and aren't a production default.

## Building it from a source

- Geocode every named place and venue as it's mentioned: towns, resorts, parks, museums.
- Give options their own coordinates. Don't leave them only `located-in` a region.
- Capture the origin ("from home"), stated drive times, and "near X" / "day trip from X" relationships.
- Regions (Region B, Region C) are worth Concepts even when nothing is decided about them. They are the map's labels.

## In the sample graphs

- **Family trip → Map.** The 22 options, 6 regions (home, Region B, Region C, Region D, Region E, Region F) and 7 day trips near the chosen resort (beaches, a fort, museums, gardens, an aquarium, a state park).
  - Positions came from real lat/lon, projected flat, with a small collision nudge. Only "day trip from" links were drawn; `located-in` edges were dropped because position already shows them.
  - It showed the geography of the search: Region B, the RI coast, the Region D coast and Region E outliers.
  - But **without a basemap the clusters floated** in blank space, and at fit-to-screen the labels were unreadable. Hence the call for a Leaflet/Mapbox-style rendering: real coastlines, clustering and zoom are what make this view work.

## What worked / what didn't

- **Worked:**
  - Coordinates on Concepts.
  - Dropping containment edges.
  - Day trips clustered around the chosen resort.
- **Didn't:**
  - No basemap, no clustering, unreadable labels at overview zoom.
  - No colour for ruled-out vs chosen.

## Open questions

- Tile source and library for v1, given self-hosting and the offline desktop app.
- Do regions get polygons, or only centroids?
- Should the map support routes (the drive from home, a multi-stop itinerary) as a Relationship-derived overlay?
