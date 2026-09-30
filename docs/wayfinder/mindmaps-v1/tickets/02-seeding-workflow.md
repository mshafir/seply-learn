---
id: 02
title: Seeding workflow from chats and docs
labels: [wayfinder:prototype]
status: closed
assignee: claude
blocked_by: [01]
---

## Question

How should an agent decompose a pasted Claude chat or a research doc into a good graph: right-sized Concepts, correct prerequisite/example/part-of Relationships, person Concepts, dates, Tags? What does the human-review step look like before a sample is baked?

Build the workflow (a prompt/skill plus a script that emits the file format from "Sample graph file format and static viewer") and use it to produce **at least 3 sample graphs** from different kinds of sources (a technical research doc, a historical/chronological topic, a conceptual chat). This is the first real test of the domain model and a rehearsal for the in-app AI and MCP flows.

## Progress (2026-09-24)

Three sample graphs were hand-seeded from shared chats (statins, 3D printer, vacation). The seed scripts are in [`prototypes/sample-graphs/seeds/`](../../../../prototypes/sample-graphs/seeds/). The heuristics that worked are recorded in [prototypes/sample-graphs.md](../prototypes/sample-graphs.md), finding 9.

Share links can only be read by a signed-in browser, so text was pulled from the rendered page. **Still open:** turning those heuristics into an agent prompt/skill with a human-review step, and checking it against the hand-seeded graphs.

## Update (2026-09-25)

The app-flow design answered the human-review question: there is **no Concept review step**. The user only chooses which Views to start with, and Concepts are curated inside Views afterwards (see [App layout and page flow](12-app-layout-and-page-flow.md)). What's left here is the agent prompt/skill that decomposes Sources into Concepts, Relationships and Views. It feeds [Sources and the build pipeline](15-sources-and-build-pipeline.md), which decides where that prompt runs.

## Progress (2026-09-25, session 2)

Scope agreed with the user:
- **Runner:** stage prompts as markdown files, run by Claude subagents. There's no SDK code yet.
- **Test Sources:** the AI compute chat (an export the user provided), the 3D printer and vacation chats (to be re-pasted by the user), and the research doc. Statins stays out.
- **Done when:** core recall is at least 80% against the hand-seeded baselines, and the user has reviewed one generated Expedition in the viewer. At most two tuning passes.

The prototype lives in [`prototypes/seeding/`](../../../../prototypes/seeding/README.md): `segment.py`, `chunk.py`, the stage prompts (`prompts/`), `eval.py` and `assemble.py`. First runs have started on the compute chat (skim, extract and merge) and on the research doc (end to end).

## Results (2026-09-25): three passes (first run plus two tuning passes)

Core recall against the hand-seeded baselines. "Judged" also counts a missed Concept that is present in the run under a different title.

| Source | Pass 1 | Pass 2 | Pass 3 (automatic) | Pass 3 (judged) |
|---|---|---|---|---|
| Printer chat (full pipeline: Views, writing, assembly) | 75% | 72% | **82%** | 100% (2 loose) |
| AI compute chat | 58% | 64% | 76% | 96% (2 real gaps: Sources hub, decoding loop) |
| Statins chat (local only) | 62% | 72% | 72% | 100% |
| Research doc (no baseline) | 134 Concepts, 2.1 Relationships each, all 4 Views built | – | – | – |

- **What the tuning changed:**
  - 5–10 `topic` hubs in the reader's words, and exactly one `part-of` parent per Concept.
  - `question` and `goal` Kinds, with question-titled decisions.
  - Short takeaway titles, and quantities as Concepts.
  - A density target, with group Concepts for options the Sources treat together.
  - Minimum Relationships per Concept.
  - Skim reads the real View Type sections and gives each View an id.
  - Build-view clarifications (Quadrant axis order, Evidence failure, `priority`, re-parenting).
  - Softer article minimums.
- **The effect:** compute went from 422 to 209 Concepts; every run lands around 2.3–2.5 Relationships per Concept with no orphans.
- **Left for the build effort** (seen in pass 3 and not tuned further):
  1. Extraction still overshoots the density target, and merge's "thin" rule folds too little. Decide which stage owns granularity: group Concepts vs. a Comparison Table's need for one row per option.
  2. Views building in parallel need **add/remove Tag** operations, not a Tag-set replace. This matches the data model (Tags are add/remove ops).
  3. Cause & Effect `rankBy` supports one ranking; Sources can rank levers in two contexts.
  4. Articles need no word floor ("never pad" wins).
  5. Assumed-but-unstated prerequisites (e.g. the decoding loop) need an explicit extract rule; a "Sources" hub should be required, not optional.
  6. `eval.py` matches names only, so it understates recall when curators title things differently.
- **Awaiting the user's review** of `gen-printer-chat` in the prototype viewer before closing.

## Review and full runs (2026-09-25)

**User review of `gen-printer-chat`:**
- The Outlines read well, each from a different angle.
- Cause & Effect was worse than the baseline: crossing arrows, and "Your exposure" as the outcome instead of air quality.
- The air-fixes table was messy, with "chosen" asserted without a Source decision.
- Which printer? had "?" cells the baseline didn't.

`build-view.md` was fixed for all four points:
- The outcome is the reader's concern, in their words.
- The chain is layered, with no lever→lever links; build steps are folded.
- Columns must be ≥ ~70% filled, one rank column per table.
- `chosen` only from a cited reader decision.

The printer View stage was rerun on the same Concepts, and the new Views pass those checks.

**Full pipeline on the other chats:** statins (local only) gives 129 Concepts, 295 Relationships and 4 Views. Compute gives 222 Concepts, 561 Relationships and 6 Views (Learning path, Anatomy, Compute economics, Outline, Compare open models, Rates). Nothing failed.

**New design finding for the spec:** Views that each want their own hierarchy (Anatomy vs Outline) compete for the same `part-of` Relationships, so one View re-parenting a Concept changes the other. View-specific structure (a Concept's parent in *this* View, fold rules, orderings) probably belongs in the View's settings, not in shared Relationships. Related: `fold` by Relationship Type folds unrelated children too, and parallel View builds can't share a Concept that one of them adds.

**Follow-up review (2026-09-28):** Which printer? had dropped Multicolor and ABS/ASA.
- **Cause:** extraction recorded verdicts only where a segment named a specific printer (2/11 each). The build stage then used the ≥70% column filter instead of filling the gaps. Separate new/refurb rows diluted every column.
- **Fixes in `build-view.md`:**
  - "Fill before you filter": class-level statements are applied to every row in their class, with provenance.
  - Important criteria are kept even with "?" cells.
  - One row per real choice.
- **Rebuilt table:** 8 rows. Multicolor and ABS/ASA are 8/8 filled, and every column is ≥ 6/8.
- **For the spec:** extraction should also record class-level verdicts, so that every View gets them, not only the one that goes looking.

## Curator agent vs pipeline, and layouts (2026-09-28)

- **The user's question:** the pipeline's output felt materially worse in judgement than the hand-made graphs. Why use a pipeline at all instead of letting the LLM use judgement?
- **Experiment:** a **curator agent** per chat, blind to the baselines and pipeline outputs. It reads the whole Source, writes down what the reader wanted and decided, builds Concepts and Views with the prompts as a playbook, self-reviews up to 3 rounds against `validate.py`, and logs each round. Outputs are `gen-agent-printer-chat` and `gen-agent-compute-chat`, with `runs/*/agent/understanding.md` and `review-log.md`.
- **User review:**
  - Content from the agent is good; the Learning path is great after a layout round.
  - Graph layouts were a mess at first. Causes and fixes are recorded below.
- **Layout findings and prototype fixes:**
  1. **Learning path:** the layout was computed over the full scope, then most of it was hidden. It now lays out only visible Concepts plus bridges, re-runs when visibility changes, and groups Concepts into topic blocks (part-of roots). Each block gets its own ELK layout, and the blocks are shelf-packed with foundational topics first.
  2. **Cause & Effect, risk mode:** tried placing levers next to what they act on. That was accurate and had no crossings, but the user found it didn't read as a priority list. **Settled:**
     - A large, centred outcome, with one ranked "What to do · by impact" column.
     - Each lever is drawn to the outcome, with an "acts on …" chip.
     - The real path lights on click, and the data keeps the accurate links.
  3. **`scripts/layout-metrics.ts`** runs the viewer's own layouts and reports crossings, edges drawn through other nodes, very long edges and cross-topic prerequisites. It is calibrated so the hand-made Views read well, and wired into `validate.py`.
  4. **An agent layout round** on the compute Learning path, changing structure only (targets, core pins, primary parents, real links), took it from 21 crossings to 1. The rest is the renderer's block packing. Still to do: place a topic block next to the topics it depends on, or route cross-topic lines around blocks.
- **Playbook rule added:** Weight describes the subject for every reader. "This reader already knows it" is Reading status, not an `aux` pin. The agent had pinned the tokenizer `aux` for that reason.
- **Direction for [Sources and the build pipeline](15-sources-and-build-pipeline.md):** replace the stage chain with a **curator agent working through validated tools**. Keep:
  - the fast skim (for Choose Views);
  - per-View commits and retries;
  - chunking only for Sources that don't fit in context;
  - `validate.py` and the layout metrics, as tool-side guardrails.

  The prompts become the agent's playbook.

## Resolution (2026-09-28)

Closed with the user's review.

- **What seeding needs:** judgement, not a chain of blind stages. Across four Sources and three tuning passes, the staged pipeline found the right Concepts: recall against the hand-made baselines was 96–100% once differently titled matches were counted. Its Views, though, were judged materially worse than the hand-made ones. Every judgement failure came from a stage missing context:
  - an outcome picked as an intermediate quantity;
  - "chosen" asserted without a decision;
  - sparse columns.
- **A curator agent** (the whole Source in context, the prompts as a playbook, validated tools, self-review) produced content the user rated good. After one layout round, its Learning path was rated great.
- **Deliverables, which feed `packages/ai` and the MCP skill:**
  - [`prototypes/seeding/prompts/`](../../../../packages/ai/playbook/) (now `packages/ai/playbook/`): the playbook (`_contract.md`, skim, extract, merge, build-view, write), with every rule learned in review.
  - `validate.py` (structural guardrails) plus `sample-graphs/scripts/layout-metrics.ts` (layout quality using the viewer's own layouts): the checks the agent's tools enforce.
  - `segment.py` / `chunk.py`: Source segmentation for provenance, and chunking for Sources larger than the context.
  - Generated Expeditions for printer, compute, statins (local only) and the research doc: pipeline versions (`gen-*`) and agent versions (`gen-agent-*`).
- **Decisions and findings handed on:**
  - The build design becomes a curator agent. This was recorded in [Sources and the build pipeline](15-sources-and-build-pipeline.md).
  - Views that each want their own hierarchy compete for shared `part-of` Relationships. View-specific structure may belong in View settings; this is for [Assemble the v1 spec](18-assemble-v1-spec.md).
  - Class-level verdicts ("enclosed printers run ABS") must be applied to every member.
  - Risk-mode Cause & Effect is a ranked priority list around a central outcome.
  - Learning paths are laid out on the visible subgraph, grouped by topic.
  - Remaining renderer polish: dependency-aware placement of topic blocks.
