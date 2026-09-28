---
id: 03
title: View prototypes on the sample graphs
labels: [wayfinder:prototype]
status: closed
assignee: claude
blocked_by: [02, 06]
---

## Question

Is "a View = a set of Relationship Types, plus optional Concept dates" a sufficient, flexible primitive? Implement four Views in the static viewer on the sample graphs:
- default: weighted core/auxiliary
- chronological: timeline
- people: who did what, via person Concepts
- rationale

For each, what does a View need to declare (Relationship Types to follow, layout, ordering axis, what to show or hide, how Weight is computed)? Which Views feel useful? Record the resulting View definition shape.

## Resolution

Worked ahead of the seeding workflow: the user asked for sample graphs directly from three chats, so they were hand-seeded. Twenty-six Views across three graphs; see [prototypes/sample-graphs.md](../prototypes/sample-graphs.md).

- **"Relationship Types + dates" is not enough.** A View = Relationship Types + a Kind/Tag filter + a **Presentation**, plus small options: a center for radial, a time field (date or conversation order), and a matrix spec (row Kinds, columns, sort).
- **Presentations in v1 (user decision):** weighted graph, layered graph, radial, **comparison matrix**, **timeline** (compressed real time, and vertical conversation order), **outline**, **map** (needs a real basemap).
- **Packs deferred (user decision):** Packs that bundle Kinds + Relationship Types + Views (Learning, Decision, Plan) come later. v1 ships one built-in default set.
- **The Views:**
  - *People*: person Concepts plus an `enjoys`/`contributed` type. Worked, with no new entity.
  - *Rationale*: `reason` / `trade-off` around a decision Concept. Worked.
  - *Chronological*: needs compressed time.
  - *Weighted default over all Relationships*: a hairball at ~100 Concepts. See the Weight fog.

### Follow-up (user, 2026-09-24)

This supersedes the "View = Relationship Types + filter + Presentation" framing and the Packs bullet above.
- "Pivot" is renamed **View**.
- A **View Type** is a set of instructions for a way of looking at knowledge, influenced by Kinds and Relationship Types but not a strict filter.
- Proven View Types are documented in [`docs/view-types/`](../../../view-types/README.md): Comparison Table, Outline, Evidence, Cause & Effect, Map, Timeline.
- The other prototype views fell flat and need more passes.


### Second prototype pass (2026-09-24)

The prototype was rebuilt to reflect the View Type docs (decided in a grilling session):
- It renders only the six proven View Types. The Views that fell flat are out of the prototype and written up in [`docs/view-types/candidates/`](../../../view-types/candidates/).
- Each View names its View Type, shows the question it answers, and opens the View Type's markdown in an ⓘ drawer.
- **Timeline** uses vis-timeline (lanes, spans, fuzzy dates as period bars, a "now" line, focus window). **Map** uses MapLibre with OpenFreeMap tiles (clusters, status colours, home anchor).
- The "Pivot" code and JSON field are renamed to View (`viewType` plus per-type `settings`).
- Details and findings: [the prototype's findings doc](../prototypes/sample-graphs.md#second-pass-view-types).

### Third prototype pass (2026-09-24)

A learning chat about AI compute and model internals became a fourth graph, with 13 Views. Seven new View Types were added as **experimental**: Anatomy, Learning path, Lineage, Maturity ladder, Quadrant, Misconceptions, and Rates & estimates. Definitions are in [`docs/view-types/`](../../../view-types/README.md#experimental-third-prototype-pass); findings are in [the prototype's findings doc](../prototypes/sample-graphs.md#third-pass-a-learning-chat-and-seven-new-view-types).
