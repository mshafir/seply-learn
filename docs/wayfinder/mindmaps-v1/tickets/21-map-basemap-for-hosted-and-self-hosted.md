---
id: 21
title: Map basemap for hosted and self-hosted
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: []
---

## Question

Which basemap does the Map View use?
- On the hosted Cloudflare instance: OpenFreeMap public tiles, or a PMTiles extract on R2 (Protomaps).
- For self-hosting without API keys, and for the offline read cache.

Cover light and dark styles (the design system picked positron ↔ dark), attribution, how big a world extract is versus a regional one, and the fallback when tiles can't load.

## Resolution (2026-09-28)

Grilled with the user.

- **Basemap:** our own copy of a **Protomaps PMTiles** build.
  - On the hosted instance it is served from **R2**; when self-hosted, from the volume or S3.
  - Styled with `@protomaps/basemaps` flavours **light ↔ dark**, following the theme. This replaces OpenFreeMap positron ↔ dark from the design-system decision.
  - No third-party tile service, no API keys, and the same setup hosted and self-hosted.
  - **OpenFreeMap** remains a configurable fallback style URL.
- **Extract size:** the build effort picks a max zoom with `pmtiles extract --maxzoom` and records the size. The size figures quoted in the session (~1–2 GB up to about z12, ~120 GB for the full planet) were rough and **not verified**. Attribution (© OpenStreetMap, Protomaps) is shown on the map.
- **Offline / failure:**
  - A **bundled coarse world layer** (low zoom, a few hundred KB) ships with the app, so pins always have a frame.
  - The service worker also keeps tiles already viewed, for the read-only offline cache.
  - If detailed tiles fail to load, the coarse layer shows with a quiet "detailed map unavailable" note.
