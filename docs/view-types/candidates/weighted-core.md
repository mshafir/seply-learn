---
id: weighted-core
name: Weighted core
status: candidate — tried, fell flat
answers: "What's central here, and what's detail?"
tried-in: [statins/core, printer/core, vacation/core]
---

# Weighted core

The force-directed "everything" view: every Concept and Relationship, with core Concepts large and near the middle and auxiliary ones small at the edge. It was the brief's proposed default View.

## What was tried

- **All three graphs → Core concepts.** Force layout over all Relationships. Weight came from degree within the View (incoming edges ×1.5, square-rooted), overridable by curator pins (`core` / `aux`). Core Concepts were pulled toward the center by a radial force.

## Why it fell flat

- At 80–100 Concepts and 140–240 Relationships it was a hairball. Structural edges (topic `part-of`, the table's `meets` / `fails`) dominated.
- Degree isn't importance: criteria and findings with many verdict edges looked "core"; the decision itself didn't always.
- It answered no particular question, which is exactly what the proven View Types do. It was removed as the default: each Graph now opens on its most useful proven View.

## Ideas for the next pass

- Exclude structural Relationship Types by default and show only the "meaning" ones.
- Collapse to the core only (top ~15 by weight) with auxiliary Concepts expandable on demand.
- Weight from curation and from how many *Views* feature a Concept, not raw degree.
- Maybe the default isn't a graph at all: a Graph's landing page could be its Outline.
