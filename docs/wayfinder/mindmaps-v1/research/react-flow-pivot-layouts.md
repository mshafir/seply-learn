# React Flow layouts for Views

Research for ticket [06](../tickets/06-react-flow-pivot-layouts.md). Checked 2026-09-24 (npm versions pulled from the registry that day).

## TL;DR

React Flow only renders. Every View is a pure function `(Concepts, Relationships of the View's types) -> {id: x,y}`. Run that function, then tween the node positions. Stack for the prototypes:
**@xyflow/react 12 + elkjs (layered DAG) + d3-force (weighted and people Views) + d3-scale (timeline x-axis) + d3-timer/d3-interpolate (View-switch tween) + react-markdown in a shadcn side panel.** Skip WebCola, d3-dag, and dagre unless ELK causes trouble.

## Per-View layout options

| View | Primary technique | Library | Alternatives | Notes |
|---|---|---|---|---|
| **Prerequisite (layered DAG)** | Sugiyama/layered, top-to-bottom, prerequisites above | `elkjs` `layered` algorithm | `@dagrejs/dagre` (simpler, faster); `d3-dag` sugiyama | ELK handles non-tree DAGs, ports and orthogonal edge routing, and fixed node sizes from `measured`. Cycles are tolerated because ELK breaks them. Run it in a Web Worker (`elk-worker`) for large graphs. |
| **Chronological** | Fixed x from a date scale, then solve y for lanes | `d3-scale` (`scaleTime`/`scaleLinear`), plus a greedy lane packer or `d3-force` with `forceX(strength≈1)` + `forceCollide` on y | ELK layered with `layerConstraint`/position hints (awkward) | Build it by hand: map the date to x, then assign lanes by Tag, Concept Kind, or greedy interval packing. Draw the axis as a custom background layer or with a `ViewportPortal`. Handle BCE and fuzzy dates in the scale domain (see "Concept dates" in the map). Concepts without dates go in a gutter. |
| **People-centric** | Radial (person in the center, ideas in rings by hop) or bipartite (people column vs ideas column) | Radial: `d3-hierarchy` `tree()` with polar coordinates, or `d3-force` + `forceRadial`. Bipartite: ELK layered with people pinned to layer 0 (`layerConstraint: FIRST`) | `graphology-layout-forceatlas2` for a people co-occurrence cloud | Radial works best for a focus view ("this person's ideas"). Bipartite works best as an overview. Both are cheap. |
| **Weighted core/auxiliary** | Force-directed, with node radius from Weight and core Concepts pulled to the center | `d3-force`: `forceManyBody`, `forceLink`, `forceCollide(r(weight))`, `forceRadial(r = f(1-weight))` | WebCola (constraints and groups); ForceAtlas2 via graphology | Node size = `scaleSqrt(weight)`. For clustering, group by Tag with `forceX/forceY` toward cluster centroids, or draw hulls. Run the simulation to convergence offline (`sim.tick(300)`) instead of animating live, so the result is deterministic and stable. |

## Libraries

| Lib | Version | License | Status | Link |
|---|---|---|---|---|
| @xyflow/react | 12.12.0 | MIT | very active (release 2026-09-24) | https://reactflow.dev |
| elkjs | 0.12.0 | EPL-2.0 OR GPL-3.0+ | active (2026-07). About 1.4 MB. EPL is weak copyleft and fine to bundle in an MIT app | https://github.com/kieler/elkjs |
| @dagrejs/dagre | 3.1.1 | MIT | revived, active (2026-08) | https://github.com/dagrejs/dagre |
| d3-dag | 1.2.2 | MIT | active again (2026-07). Its "fast" sugiyama is about 4x dagre, "medium" about 0.5x | https://github.com/erikbrinkman/d3-dag |
| d3-force | 3.0.0 | ISC | stable/done | https://d3js.org/d3-force |
| d3-hierarchy | 3.1.2 | ISC | stable/done. Trees only, single root | https://d3js.org/d3-hierarchy |
| d3-scale / d3-timer / d3-interpolate | 4.0.2 / 3.0.1 / 3.0.1 | ISC | stable | https://d3js.org |
| webcola | 3.4.0 | MIT | **unmaintained since 2019**, avoid | https://github.com/tgdwyer/WebCola |
| graphology (+ forceatlas2 0.10.1) | 0.26.0 | MIT | slow cadence | https://graphology.github.io |
| motion (Framer Motion) | 13.4.3 | MIT | active. Alternative tween engine | https://motion.dev |
| react-markdown (+ remark-gfm) | 10.1.0 (4.0.1) | MIT | active | https://github.com/remarkjs/react-markdown |
| react-resizable-panels (shadcn `Resizable`) | 4.13.3 | MIT | active | https://github.com/bvaughn/react-resizable-panels |

The React Flow docs compare dagre, d3-hierarchy, d3-force, and elkjs, and recommend dagre for trees and ELK for power and edge routing: https://reactflow.dev/learn/layouting/layouting

## Animated transitions between Views

The same Concept ids appear in every View, so a switch is a position tween keyed by id:
1. Compute the target layout (async for ELK).
2. Tween every node from its current `position` to its target over about 400–600 ms with `d3-timer` + `d3-interpolate` (or motion's `animate()`), calling `setNodes` each frame. This is the approach of React Flow's **Node Position Animation** example (Pro-only, uses d3-timer): https://reactflow.dev/examples/nodes/node-position-animation. It is easy to reimplement without Pro.
3. Concepts not in the new View (for example, undated Concepts in the timeline) fade out with opacity, or are set `hidden` after the tween. Swap edges (different Relationship Types per View) with a crossfade.
4. Call `fitView({duration})` after the tween, which animates the viewport.

The cheap alternative is CSS `.react-flow__node { transition: transform .5s }`. It needs zero code, but it fights with drag and it tweens on every update. That makes it fine for a static prototype and wrong for the product.

For stability across switches, seed d3-force with the previous positions, and keep ELK deterministic (`elk.randomSeed`). Cache each View's layout per Graph.

## Performance limits

- DOM rendering: every node is a React component. With `React.memo` custom nodes, narrow store selectors, and no heavy CSS, **hundreds of nodes are comfortable. Around 1–2k nodes still works but panning degrades**. At several thousand, and especially when zoomed out so that everything is visible, it struggles. `onlyRenderVisibleElements` culls off-screen nodes but doesn't help when zoomed out. There are no official numbers. See https://reactflow.dev/learn/advanced-use/performance and the stress test at https://reactflow.dev/examples/nodes/stress.
- Per-frame tweening through `setNodes` is fine up to a few hundred nodes. Beyond that, animate only nodes that are in the viewport, or snap.
- Layout cost: dagre and d3-dag "fast" take a few milliseconds for about 200 nodes. ELK layered takes tens to hundreds of milliseconds for 1k nodes, so use a worker. d3-force takes about 300 ticks, O(n log n) per tick. Precompute it.
- Escape hatches for 5k+ nodes (not needed for sample graphs): simplify at low zoom (dots, no labels), collapse by cluster, or switch to a WebGL renderer for overview mode: sigma.js (MIT, 12k★, active) or reagraph (Apache-2.0).
- Sample graphs will be tens to low hundreds of Concepts, well inside the comfortable range.

## Markdown side panel

Clicking a Concept sets the selected id. Show a shadcn `Sheet` (overlay) or a `ResizablePanelGroup` (docked) next to `<ReactFlow>`, and render `react-markdown` + `remark-gfm` for the Concept content. Keep the selection in separate state instead of reading it from `nodes`, which avoids re-rendering the whole graph (a React Flow perf guideline). Concepts that the content links to can call `fitView({nodes:[id]})` to pan the graph to them.

## OSS to borrow from

- **React Flow free examples**: dagre (https://reactflow.dev/examples/layout/dagre), elkjs (https://reactflow.dev/examples/layout/elkjs), elkjs-multiple-handles, node-collisions. The Pro-only ones are auto-layout, force-layout, dynamic-layouting, expand-collapse, and node-position-animation. We need none of them.
- **idootop/reactflow-auto-layout** (MIT, about 160★): switches between dagre, ELK, and d3-hierarchy behind a `useAutoLayout` hook. It is the closest model for the "View = layout function" seam. https://github.com/idootop/reactflow-auto-layout
- **liam-hq/liam** (Apache-2.0, 5k★, active): a production React Flow 12 + elkjs app, with an ER-diagram layout, a detail side panel, and highlighting of related nodes. https://github.com/liam-hq/liam
- **sigma.js / graphology** examples show how to handle large-graph overviews if we ever need one.

## Recommended stack for the sample-graph prototypes

- **Renderer:** `@xyflow/react` 12 with custom memoized Concept nodes (size from Weight, a badge for Concept Kind). The side panel uses shadcn + `react-markdown`.
- **Seam:** `type PivotLayout = (graph, pivot) => Promise<Map<id,{x,y}>>`. There is one module per View. Layouts are precomputed and cached per View.
- **Prerequisite:** `elkjs` layered, in a worker if needed. Fall back to `@dagrejs/dagre` if ELK's config or bundle size gets in the way.
- **Chronological:** `d3-scale` time/linear x, plus a hand-written lane packer and a custom axis layer.
- **People:** `d3-hierarchy` radial for the focus view, ELK layered with people in the first layer for the bipartite overview.
- **Weighted:** `d3-force` (charge, link, collide by radius, radial pull by Weight, Tag clustering), run to convergence offline and seeded with the previous positions.
- **Transitions:** a small hand-written `useAnimatedNodes` hook (d3-timer + d3-interpolate) plus `fitView({duration})`. Nodes missing from the new View fade out.
- **Not used:** WebCola (dead), d3-dag (fine but redundant with ELK and dagre), and WebGL renderers (not needed at sample scale).
