# 4. Views and View Types

Decided in:
- [View prototypes on the sample graphs](../../wayfinder/mindmaps-v1/tickets/03-pivot-prototypes.md)
- [React Flow layouts for Views](../../wayfinder/mindmaps-v1/tickets/06-react-flow-pivot-layouts.md)
- [View-specific structure](../../wayfinder/mindmaps-v1/tickets/24-view-specific-structure.md)
- the layout findings recorded in [Seeding workflow from chats and docs](../../wayfinder/mindmaps-v1/tickets/02-seeding-workflow.md)

The View Type definitions live in [`docs/view-types/`](../../view-types/README.md), one file each, following `_template.md`. They are written as instructions that both curators and the curator agent follow. **These files are part of the spec:** the build ships them, and the agent's playbook reads them.

## 4.1 View Types in v1

| View Type | Answers | Status | Renderer |
|---|---|---|---|
| [Comparison Table](../../view-types/comparison-table.md) | How do the options stack up? | proven | Table (shadcn) with criterion bands |
| [Outline](../../view-types/outline.md) | What's in here, organised? | proven | Collapsible tree |
| [Evidence](../../view-types/evidence.md) | What do we believe, and why? | proven | Canvas: claims centre, support left, challenges right |
| [Cause & Effect](../../view-types/cause-and-effect.md) | What drives what, and what can I pull on? | proven | Canvas: ELK layered (mechanism mode; risk mode) |
| [Map](../../view-types/map.md) | Where is everything? | proven | MapLibre + our PMTiles |
| [Timeline](../../view-types/timeline.md) | When did or will things happen? | proven | vis-timeline with lanes, spans, fuzzy dates |
| [Anatomy](../../view-types/anatomy.md) | What is this made of, and where does each idea plug in? | experimental | Nested parts with pins |
| [Learning path](../../view-types/learning-path.md) | What do I need to understand first? | experimental | Canvas: core/aux map, focus tree |
| [Lineage](../../view-types/lineage.md) | Where did this idea come from? | experimental | Year columns × area bands |
| [Quadrant](../../view-types/quadrant.md) | Where does each idea sit on two dimensions? | experimental | 2-D grid; progression ladder variant |
| [Rates & estimates](../../view-types/rates.md) | How fast is it changing, and how sure are we? | experimental | Log-scale ranges grouped by quantity |

- **Proven and experimental** View Types are offered to the skim and to readers. The candidates in `docs/view-types/candidates/` are not.
- **An experimental type** counts as proven once it has worked on a second Expedition; this is tracked in its doc.
- **More View Types**, and user-authored ones, are phase 2.

## 4.2 A View's parts

- **Shared settings:** per View Type, a **versioned Zod schema** in `packages/domain`. The prototype's `src/lib/types.ts` holds the starting shapes (`ComparisonTableSettings`, `LearningPathSettings`, …). One schema:
  - validates ops;
  - generates the View panel's settings form;
  - is the agent's structured output when it builds the View.
- **Per-View structure overrides** in shared settings: `placement`, `order`, `hide`, and explicit `fold`, which replaces the prototype's fold-by-Relationship-Type (see [Domain model §1.6](01-domain-model.md#16-views-shared-settings-personal-settings-per-view-structure)).
- **Personal settings:** a second Zod schema per View Type (e.g. `showAllSteps`, `hideRead`), with defaults from the schema only.
- **Reading status** in every View: a check on read or known Concepts. **Learning path and Outline** also act on it: step counts exclude covered Concepts, and "Hide what I've read" (off by default) removes them. "Read" and "known" count the same for skipping.
- **Best View:** one per Expedition, chosen by a curator. Its View Type's illustration is the Library thumbnail.

## 4.3 Layout rules (canvas Views)

- **Each View is a pure layout function** `(scope, view, visible?) → positions (+ bands, ticks)`. React Flow 12 only renders. There are **no stored positions**.
- **Layouts don't depend on input order.** Before laying out, the scope is sorted by what a reader sees: Concepts by title, then id; Relationships by their ends in that order. The same Expedition lays out the same from a file or from live collections (which list rows by key and hold minted ids). ([#60](https://github.com/mshafir/seply-learn/issues/60))
- **Cards are sized for their titles:** a title that wraps to more lines gets a taller card, and the layout leaves room for it, so cards never run into each other.
- **View switches** tween node positions by Concept id (d3-timer), then call `fitView`.
- **Performance:** hundreds of nodes are comfortable. About 1–2k works but degrades; beyond that, simplify at low zoom.
- **ELK layered** is the workhorse for directed graphs:
  - `BRANDES_KOEPF` placement with `BALANCED` alignment
  - dagre as the fallback
  - d3-scale for time axes
- **Learning path:**
  - **Lay out only what is visible** (hidden steps are replaced by dashed bridges), and re-run when visibility changes.
  - **Group by topic**, meaning the part-of root, or the View's `placement` override. Each topic gets its own ELK layout, and the topic blocks are packed into rows with foundational topics first.
  - The focus tree lights up a target's prerequisites, and focus is sticky while the selection stays inside the tree.
- **Cause & Effect, risk mode:**
  - The **outcome is large and centred**, with causes flowing in from the left.
  - **Levers form one ranked column** ("What to do · by impact"). Each lever is drawn pointing at the outcome, with an **"acts on …" chip** when its real target is upstream. **Clicking a lever lights its real path** and traces the effects in the side panel.
  - The data keeps the accurate links.
- **Cause & Effect, mechanism mode:** levers sit in a band across the top, and the flow runs downward.
- **Evidence:** claims down the middle. Supporting evidence fans left and challenges fan right. Evidence shared by several claims is drawn once, level with their middle.
- **Comparison Table:**
  - **Rows** are the live options, one row per real choice.
  - **Criterion columns** are banded **Must-haves / Nice-to-haves** by `priority`, with a Facts band for Attributes. A fail on a must-have tints the row.
  - Unknown cells show "?". Dropped criteria are listed under the table.
- **Remaining polish** (the build can pick it up):
  - place each topic block next to the topics it depends on;
  - route cross-topic lines around blocks rather than through them.

## 4.4 Layout quality as a check

`packages/views` exports the **layout metrics**, prototyped as `prototypes/sample-graphs/scripts/layout-metrics.ts`. They run the real layout functions and report:
- crossings
- edges drawn through other nodes
- very long edges
- overlapping Concepts (cards drawn over each other)
- cross-topic prerequisites

A View "reads well" when crossings are ≤ 20% of edges, edges through nodes are ≤ 10%, and no Concepts overlap. The crossing and edge thresholds are calibrated on the hand-made samples. The curator agent's `view.inspect` tool returns these metrics (see [AI §5.3](05-ai.md#53-tools-and-checks)). **A View with problems can't be committed.** The agent fixes them by reshaping structure: targets, pins, placement, real links. It never sets positions.
