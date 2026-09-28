---
id: 01
title: Sample graph file format and static viewer
labels: [wayfinder:prototype]
status: closed
assignee: claude
blocked_by: []
---

## Question

What is the minimal baked-in **graph file format** (Concepts with Kind, Tags, markdown, optional date, pinned Weight; per-Graph Relationship Types; Relationships; View definitions) and the minimal **static React Flow viewer** (graph on one side, the selected Concept's markdown alongside) that feels right to explore?

Build a rough static site (no backend) in this repo that renders one hand-made graph, e.g. decompose `docs/research/knowledge-graph-learning-tools.md` by hand or with an agent. React to it together. The file format settled here is a candidate for the product's export format.

## Resolution

Built [`prototypes/sample-graphs/`](../../../../prototypes/sample-graphs/): a single-file static viewer (React Flow + Tailwind) with three graphs baked in, seeded from three Claude chats. Findings are in [prototypes/sample-graphs.md](../prototypes/sample-graphs.md).

- **File format** ([`types.ts`](../../../../prototypes/sample-graphs/src/lib/types.ts)) is the candidate export format:
  - A Graph carries its own Kinds, Relationship Types, Attribute definitions, Concepts, Relationships and Views.
  - A Concept has a Kind, Tags, a summary, a markdown body, a date and/or conversation `order`, an optional Weight pin, typed Attributes, and an optional geo location.
  - A Relationship has a type and an optional note.
- **Viewer:** View bar; canvas with the selected Concept's markdown, Attributes and Relationships alongside; free-text and #tag search that dims non-matches.
- **Decisions (user, 2026-09-24):**
  - **Concepts have Kinds.** A built-in default set of Kinds and Relationship Types ships with every Graph, and a Graph can add its own.
  - **Concepts carry typed Attributes** defined per Graph.
  - **Relationships carry notes.**
