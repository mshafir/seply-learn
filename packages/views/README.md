# @umbel/views

**Lane:** C: Views

## Contract

React Flow canvas, View renderers, pure layout functions (ELK etc.) and layout metrics. No data fetching: takes a scope and returns positions/renders. Spec: docs/spec/v1/04-views.md.

- **Scope** (`scopeFor(expedition, view)`): the part of an Expedition a canvas View shows, with weights. Also `learningMap`, `learningScope`, `leversOf`, `trace`, `topicRoots`, `readingOrder`.
- **Layouts** (`layout(scope, view, visible?) → { positions, extras: { bands, ticks } }`): pure, async (ELK), deterministic. Positions are node centres in canvas pixels and are never stored. Canvas View Types: Learning path (lays out only what is visible, topic blocks), Cause & Effect (mechanism band; risk mode's ranked lever column), Evidence, Lineage.
- **Drawn edges** (`drawnRelationships(scope, settings, { shown, tr?, selected? })`): the lines a canvas View draws. In Cause & Effect risk mode each lever points straight at the outcome (`synthetic`), and its real edges are drawn only while it is traced. The renderer and the layout metrics both use this one list.
- **Layout metrics** (`layoutMetrics(expedition, view)`, `expeditionLayoutMetrics(expedition)`, `formatLayoutMetrics`): crossings, edges through other nodes, very long edges, cross-topic prerequisites, and a "reads well" / "cluttered" verdict (spec §4.4). They measure the View as a reader first sees it: nothing selected, only the drawn edges (so risk mode counts lever→outcome lines, not the levers' hidden real edges).
- **Overlays** (`learningPathOverlay`, `badgesFor`, `actsOn`): what a View layers over a layout (hidden, lit, badges, bridges), as pure functions.
- **Canvas** (React 19, `@xyflow/react` 12): `Canvas` (renders a scope + overlay, tweens positions by Concept id with d3-timer, then `fitView`), `LearningPathCanvas` (core/aux map with sticky focus tree), `ViewCanvas` (picks one for any canvas View).

### Styling

Import `@umbel/ui/globals.css` (the app does this once), then React Flow's CSS and ours: `@xyflow/react/dist/style.css`, then `@umbel/views/canvas.css`. Every colour is a `--umbel-*` CSS variable that points at an `@umbel/ui` token (`--background`, `--card`, `--kind-red` …), so the canvas follows light and dark, including `.light` / `.dark` islands. This package may not depend on `@umbel/ui` (dependency rule), so it reads the tokens as CSS variables the app provides; there are no literal colours, and without the tokens the canvas is unstyled. Kind and Relationship Type colours are Expedition data: a palette name is drawn as `var(--kind-<name>)` (`paletteColor`); anything else is passed through until the domain types land. **To do:** swap the Learning path toolbar's plain buttons for shadcn components.

### Temporary types

`src/model.ts` holds the Expedition and View types, ported from the prototype. `TODO(M1)`: replace them with `@umbel/domain`'s.

## Development

- `pnpm --filter @umbel/views dev`: the harness (`harness/`, Vite on :5199) renders the compute sample's canvas Views from `fixtures/compute.json`, with their layout metrics. URL `#<viewId>/<conceptId>`; `?instant` skips the tween; `?theme=dark` (or the bar's button) switches to the dark theme. The harness stands in for the app: it loads `@umbel/ui/globals.css` through Tailwind, which is why `@umbel/ui`, `tailwindcss` and `@tailwindcss/vite` are **dev**Dependencies here (the package itself never imports them).
- `pnpm --filter @umbel/views test`: Vitest on the layouts, overlays and metrics.
- `pnpm --filter @umbel/views test:e2e`: Playwright screenshots of the harness (`e2e/__screenshots__`, Linux Chromium), light and dark. Not in `pnpm check`; CI wiring is WP-0.2's.

Fixtures are the committed compute sample and synthetic data only.

## Allowed dependencies

@umbel/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
