# @umbel/views

**Lane:** C: Views

## Contract

React Flow canvas, View renderers, pure layout functions (ELK etc.) and layout metrics. No data fetching: takes a scope and returns positions/renders. Spec: docs/spec/v1/04-views.md.

- **Scope** (`scopeFor(expedition, view)`): the part of an Expedition a canvas View shows, with weights. Also `learningMap`, `learningScope`, `leversOf`, `trace`, `topicRoots`, `readingOrder`.
- **Layouts** (`layout(scope, view, visible?) → { positions, extras: { bands, ticks } }`): pure, async (ELK), deterministic. Positions are node centres in canvas pixels and are never stored. Canvas View Types: Learning path (lays out only what is visible, topic blocks), Cause & Effect (mechanism band; risk mode's ranked lever column), Evidence, Lineage.
- **Layout metrics** (`layoutMetrics(expedition, view)`, `expeditionLayoutMetrics(expedition)`, `formatLayoutMetrics`): crossings, edges through other nodes, very long edges, cross-topic prerequisites, and a "reads well" / "cluttered" verdict (spec §4.4).
- **Overlays** (`learningPathOverlay`, `badgesFor`, `actsOn`): what a View layers over a layout (hidden, lit, badges, bridges), as pure functions.
- **Canvas** (React 19, `@xyflow/react` 12): `Canvas` (renders a scope + overlay, tweens positions by Concept id with d3-timer, then `fitView`), `LearningPathCanvas` (core/aux map with sticky focus tree), `ViewCanvas` (picks one for any canvas View).

### Styling

Import React Flow's CSS and ours: `@xyflow/react/dist/style.css`, then `@umbel/views/canvas.css`. Every colour is a `--umbel-*` CSS variable with a fallback matching the prototype's palette. **To do once `@umbel/ui` tokens land:** point the variables at the tokens and add the dark theme; swap the Learning path toolbar's plain buttons for shadcn components. Kind and Relationship Type colours are Expedition data and are used as given.

### Temporary types

`src/model.ts` holds the Expedition and View types, ported from the prototype. `TODO(M1)`: replace them with `@umbel/domain`'s.

## Development

- `pnpm --filter @umbel/views dev`: the harness (`harness/`, Vite on :5199) renders the compute sample's canvas Views from `fixtures/compute.json`, with their layout metrics. URL `#<viewId>/<conceptId>`; `?instant` skips the tween.
- `pnpm --filter @umbel/views test`: Vitest on the layouts, overlays and metrics.
- `pnpm --filter @umbel/views test:e2e`: Playwright screenshots of the harness (`e2e/__screenshots__`, Linux Chromium). Not in `pnpm check`; CI wiring is WP-0.2's.

Fixtures are the committed compute sample and synthetic data only.

## Allowed dependencies

@umbel/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
