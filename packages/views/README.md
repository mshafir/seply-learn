# @umbel/views

**Lane:** C: Views

## Contract

React Flow canvas, View renderers, pure layout functions (ELK etc.) and layout metrics. Reads an Expedition's live `@umbel/sync` collections; fetches nothing itself. Spec: docs/spec/v1/04-views.md.

### What the app mounts

```tsx
import { ExpeditionView } from "@umbel/views";

<ExpeditionView
  collections={collections} // createEngineCollections(engine) from @umbel/sync (or any object with its tables)
  viewId={viewId} // the selected View; unknown or deleted → the best View, then the first
  selected={conceptId} // the selected Concept (the side panel's)
  onSelect={(id) => …} // a Concept (or a criterion header) was clicked; undefined = cleared
  matches={searchMatches} // optional: everything else is dimmed
  transitionMs={650} // optional: canvas tween length (0 jumps)
  onSettled={() => …} // optional: the View is drawn (canvas: layout settled and fitted)
  personal={values} // optional: the reader's personal settings (View Type defaults filled in)
  onPersonalChange={(key, value) => …} // optional: a View's own control changed one (e.g. "Show all steps")
  onStatus={(status) => …} // optional: { text, clear } for the floating status chip, or null
/>
```

- **Live:** every change to the collections (a local edit, or someone else's arriving by pull) re-derives the View. Canvas Views re-run their pure layout and tween each Concept to its new place: nothing is removed and redrawn, and the view isn't refitted for data alone. A change that moves nothing (a title) just redraws.
- **Switching Views** (change `viewId`): the incoming View fades in (`.umbel-view`, off under `prefers-reduced-motion`), and a canvas View tweens each Concept from where the previous canvas View drew it, by Concept id, then fits. Positions live only in memory for that tween; they are never stored.
- **Personal settings and status:** with `onPersonalChange`, a View's own controls (Learning path's "Show all steps") read and write the app's personal settings instead of local state. `onStatus` reports View-specific status for the app's floating chip: Learning path sends "Path to X · k of n read" while a tree is focused, and `clear()` unfocuses it.
- **Drawn:** Learning path and Comparison Table (the first two Views on data), plus the other canvas View Types (Cause & Effect, Evidence, Lineage). Other View Types show a placeholder.
- `useLiveExpedition(collections)` gives the same live Expedition (e.g. for the Views rail: `expedition.views` in rail order, and `bestViewId`). `ViewRenderer({ expedition, view, … })` draws one View of an Expedition you already have. `pickView(expedition, viewId)` is ExpeditionView's choice of View.

### Pieces

- **Live data** (`useLiveExpedition`, `readExpedition(collections)`, `expeditionFromRows(rows)`): the collections' rows (`@umbel/domain` state types) as the Expedition the layouts read. Built-in Kinds and Relationship Types are merged with the Expedition's own; ids pass through (`builtin:*` included), so View settings match. Concepts and Relationships keep the collections' order (by key; ULIDs sort by creation), so the same rows always lay out the same way. It subscribes with `includeInitialState`, so deletes arrive too (TanStack DB drops deletes of rows a subscription never saw).
- **Comparison Table** (`comparisonTable(expedition, settings)` → columns, bands, rows, cells, dropped; `ComparisonTable`): rows are the options (the `rows` filter), sorted by `sortBy` (unknowns last). Criterion columns are banded **Must-haves / Nice-to-haves** by the `priority` Attribute (`hard` / `nice`; `dropped` criteria are listed under the table), after a **Facts** band of Attribute columns; bands show only when must-haves or nice-to-haves exist. A criterion cell is the option's verdict (`meets` / `partly-meets` / `fails`, built-in or plain ids) with its note; **no verdict is "?"**, a missing Attribute is "—". A `fails` on a must-have **tints the row** (and the cell). `standing` (`chosen` / `in-play` / `ruled-out`) marks the chosen row and strikes ruled-out ones.
- **Scope** (`scopeFor(expedition, view)`): the part of an Expedition a canvas View shows, with weights. Also `learningMap`, `learningScope`, `leversOf`, `trace`, `topicRoots` (part-of is `builtin:part-of`, or `part-of` in older fixtures), `readingOrder`.
- **Layouts** (`layout(scope, view, visible?) → { positions, extras: { bands, ticks } }`): pure, async (ELK), deterministic. Positions are node centres in canvas pixels and are never stored. Canvas View Types: Learning path (lays out only what is visible, topic blocks), Cause & Effect (mechanism band; risk mode's ranked lever column), Evidence, Lineage.
- **Drawn edges** (`drawnRelationships(scope, settings, { shown, tr?, selected? })`): the lines a canvas View draws. In Cause & Effect risk mode each lever points straight at the outcome (`synthetic`), and its real edges are drawn only while it is traced. The renderer and the layout metrics both use this one list.
- **Layout metrics** (`layoutMetrics(expedition, view)`, `expeditionLayoutMetrics(expedition)`, `formatLayoutMetrics`): crossings, edges through other nodes, very long edges, cross-topic prerequisites, and a "reads well" / "cluttered" verdict (spec §4.4). They measure the View as a reader first sees it: nothing selected, only the drawn edges (so risk mode counts lever→outcome lines, not the levers' hidden real edges).
- **Overlays** (`learningPathOverlay`, `badgesFor`, `actsOn`): what a View layers over a layout (hidden, lit, badges, bridges), as pure functions.
- **Canvas** (React 19, `@xyflow/react` 12): `Canvas` (renders a scope + overlay, tweens positions by Concept id with d3-timer, fits on a new View or visible set; `memory` carries positions across remounts), `LearningPathCanvas` (core/aux map with sticky focus tree; "I know this" is local state until Reading status reaches the client), `ViewCanvas` (picks one for any canvas View).

**Known gap:** ELK's result depends on the order of its edges, and the collections list Relationships by key, not in the order a file wrote them. The compute Learning path lays out alike either way (only the very-long-edge count differs, 1 vs 0), but mechanism-mode Cause & Effect goes from 0 crossings to 2. Making the layouts order-independent is follow-up work.

### Styling

Import `@umbel/ui/globals.css` (the app does this once), then React Flow's CSS and ours: `@xyflow/react/dist/style.css`, then `@umbel/views/canvas.css` (the canvas, the Comparison Table and the View switch). Every colour is a `--umbel-*` CSS variable that points at an `@umbel/ui` token (`--background`, `--card`, `--success`, `--kind-red` …), so the Views follow light and dark, including `.light` / `.dark` islands. This package may not depend on `@umbel/ui` (dependency rule), so it reads the tokens as CSS variables the app provides; there are no literal colours, and without the tokens the Views are unstyled. Kind and Relationship Type colours are Expedition data: a palette name is drawn as `var(--kind-<name>)` (`paletteColor`). **To do:** swap the Learning path toolbar's plain buttons, and the Comparison Table's plain `<table>`, for shadcn components (packages/ui/DIVERGENCES.md #2).

### Temporary types

`src/model.ts` holds the Expedition and View shapes the layouts read, ported from the prototype. Live data reaches them through `expeditionFromRows`, the one bridge from `@umbel/domain`'s types. `TODO`: have the layouts read the domain types directly and drop model.ts.

## Development

- `pnpm --filter @umbel/views dev`: the harness (`harness/`, Vite on :5199) stands in for the app. It imports an Expedition file the way a first build does (`@umbel/domain` `importExpeditionJson`), loads it into an `@umbel/sync` op engine, and mounts `<ExpeditionView>` on the collections, with each View's layout metrics. Default: the compute sample (`@umbel/domain/fixtures/compute.json`); `?expedition=options` is the synthetic options table (`fixtures/options.json`). URL `#<viewId>/<conceptId>` with the ids the file writes; `?instant` skips the tween; `?theme=dark` (or the bar's button) switches to the dark theme; "Another tab's edit" pulls an edit as if another tab had pushed it. The harness loads `@umbel/ui/globals.css` through Tailwind, which is why `@umbel/ui`, `tailwindcss` and `@tailwindcss/vite` are **dev**Dependencies here (the package itself never imports them).
- `pnpm --filter @umbel/views test`: Vitest on the layouts, overlays, metrics, the live adapter and the Comparison Table, plus jsdom component tests (`tests/*.test.tsx`: both Views on live collections, a pull reflowing them without removing any drawn Concept, View switching).
- `pnpm --filter @umbel/views test:e2e`: Playwright on the harness (`e2e/__screenshots__`, Linux Chromium), light and dark, including a pull reflowing the Learning path and filling a "?". Not in `pnpm check` or CI yet.

Fixtures (`fixtures/`): `live.ts` opens any Expedition file as live collections (`openLiveFixture(file)` → `{ collections, engine, ids, concept(id), view(id), pull(bodies), dispose }`); `options.json` is synthetic; `compute.json` is the prototype-format copy of the compute sample that the static layout tests still use. Public data only.

## Allowed dependencies

@umbel/domain, @umbel/sync. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
