---
id: 06
title: React Flow layouts for Views
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

Which layout techniques and libraries work with React Flow (xyflow) for each View?
- layered DAG for prerequisites (ELK, dagre, d3-dag)
- chronological timeline with a date axis
- people-centric (bipartite or radial)
- weighted core/auxiliary: node size by Weight, clustering or force layouts (d3-force, WebCola)

Also cover: animated transitions when switching Views on the same Concepts, performance limits (hundreds to thousands of nodes), a markdown side panel, and existing open-source examples to borrow from. Recommend a layout stack for the sample-graph prototypes.

## Resolution

Findings: [react-flow-pivot-layouts](../research/react-flow-pivot-layouts.md).
- Each View is a pure layout function `(graph, pivot) -> positions`. React Flow (`@xyflow/react` 12, MIT) only renders.
- Prerequisite: `elkjs` layered, with `@dagrejs/dagre` as fallback. Chronological: `d3-scale` date axis on x plus a hand-written lane packer. People: `d3-hierarchy` radial, or ELK bipartite. Weighted: `d3-force` with collide radius and radial pull set by Weight.
- View switches tween node positions by Concept id (d3-timer + d3-interpolate, or a `useAnimatedNodes` hook) and then call `fitView({duration})`. Nodes absent from the new View fade out. No React Flow Pro needed.
- Performance: hundreds of nodes are comfortable, about 1–2k works but degrades. Beyond that, simplify at low zoom or switch to a WebGL overview (sigma.js). Sample graphs are far below these limits.
- Side panel: shadcn Sheet/Resizable + react-markdown. Avoid WebCola (unmaintained since 2019).
