# Prototype: sample graphs from three Claude chats

Asset for [Sample graph file format and static viewer](../tickets/01-sample-graph-format-and-viewer.md), [Seeding workflow from chats and docs](../tickets/02-seeding-workflow.md) and [View prototypes on the sample graphs](../tickets/03-pivot-prototypes.md).

**Code:** [`prototypes/sample-graphs/`](../../../../prototypes/sample-graphs/)
- Build it with `mise exec -- pnpm build`, then open `dist/index.html`. The output is a single file that opens straight from disk.
- The file format is defined in [`src/lib/types.ts`](../../../../prototypes/sample-graphs/src/lib/types.ts).
- Graphs are hand-seeded by Python scripts in [`seeds/`](../../../../prototypes/sample-graphs/seeds/) that write `src/graphs/*.json`.

## The three chats

| Chat | Shape | Concepts | Relationships | Views |
|---|---|---|---|---|
| **Statins** (personal; kept local) | Learning + personal decision | 83 | 141 | 8 |
| **A 3D printer for the family** | Buying decision + risk mitigation + how-to | 101 | 145 | 9 |
| **Family trip** | Search → constraints → elimination → booking | 105 | 238 | 9 |

None of them is a pure "learning" chat. Only the statins chat decomposes naturally into prerequisites. The other two are **decisions**, and their structure is options × criteria plus eliminations and corrections over time.

## Relationship sets that made sense, per chat

**Statins**
- *Learning path*: `prerequisite`. It lays out a clean left-to-right DAG from cholesterol to lipoproteins to LDL to plaque to statins to residual risk. **Best result of the three.**
- *Mechanism*: `raises` / `lowers`. A causal chain with signed edges, e.g. statin ⊣ mevalonate → cholesterol; LDL receptors ⊣ LDL.
- *Evidence*: `supports` / `challenges`, from claims to sources. An argument map that includes the THINCS dissent and the Lp(a)HORIZON miss.
- *My situation*: `implies` / `next-step`, radial around the reader: their numbers, what they mean, then actions.
- *Timeline*: dated events, running from lovastatin (1987) to a planned follow-up.
- *Compare treatments*: **a table, not a graph**. Drugs × mechanism, LDL effect, cost, downsides and status.
- *Outline*: `part-of`, collapsible by topic.

**3D printer**
- *Which printer?*: a matrix of options × criteria (`meets` / `partly` / `fails`, each with a note). This beats any graph layout for this question.
- *Decision graph*: the same data radially, plus the claims that knocked options out (`blocks`, `corrects`).
- *Air quality*: `causes` → risk ← `mitigates`, drilling into the venting build (`part-of`, `prerequisite`, `option-for`). Reads very well.
- *Air: what to do first*: mitigations ranked by impact, as a sorted checklist table.
- *Learn to make*: `prerequisite` / `enables`: models → slicing → Claude-as-CAD → electronics → projects.
- *For the kids*: radial on a *goal* Concept.
- *Money*: savings and selling paths, with compliance risks that `block` some of them.
- *How the chat went*: by conversation turn.

**Vacation**
- *Compare options*: 22 options × 9 criteria with price, nights and drive time, sorted by price. **The single most useful view for this chat.**
- *Why options fell out*: a funnel, where criteria and findings `rules-out` options, which feed the decision.
- *Map*: geographic. Position *is* the location, so no edges are needed for it.
- *How the search evolved*: vertical, by conversation turn. Requirements appear, get refined, get dropped.
- *Why this resort*: `reason` / `trade-off` around the decision, plus `similar-to` near-alternatives. This is the "rationale" View.
- *What changed our minds*: `corrects` / `refines`. Six self-corrections in one chat (tax rate, pickleball advice, pool size, hot tub, Wi-Fi, …).
- *The trip*: radial on the chosen resort. People Concepts (each kid, the adults) `enjoy` activities, plus day trips and to-dos.
- *Calendar*: real dates, from the search to the January follow-up to the trip.

## Findings

1. **A View needs more than a set of Relationship Types.** Every useful View also needed:
   - a *presentation*: force, layered, radial, timeline, geo, matrix or outline
   - a *Kind/Tag filter*
   - sometimes a *center* (radial), a *time field* (real date vs conversation order), or a *matrix spec* (row kinds, columns, sort)

   The prototype's View shape is in `types.ts`.
2. **Two useful presentations aren't graphs:** the **matrix** (options × criteria) and the **outline** (a tree over `part-of`). Decision chats lean heavily on the matrix.
3. **Concepts need typed attributes** (price, nights, drive time, rank, status), not just markdown, so that matrices, sorting and geo work. **Relationships need notes**: the matrix cell text is the Relationship note ("fails · Sat–Sat").
4. **Kinds are doing real work.** 10–13 Kinds were used across the three graphs. They drive icons and colors, matrix rows ("rows = things"), and View filters ("the evidence View shows claims and sources"). Plain "Concept + Tags" couldn't express the matrix or the funnel.
5. **Chats contain corrections.** Claims get superseded mid-conversation. `corrects` is worth making a first-class Relationship Type, maybe with a "superseded" state on the corrected claim.
6. **Two kinds of time.** Real dates (history, bookings, the trip) and *conversation order* (when an idea entered). Both were useful.
   - Linear time scales fail when dates cluster: 1987 and a pile of 2026 events can't share one linear axis. **Compressed time** fixed it: one slot per distinct moment, with log-scaled gaps.
   - Conversation order reads best **vertically**, like the chat itself.
7. **The all-relationships default is a hairball** at 80–100 Concepts. The default View should be chosen per Graph (e.g. the Learning path), or it should exclude structural edges (topic `part-of`, matrix `meets`/`fails`).
8. **Geography needs a basemap.** Positions are right, but without coastlines the clusters float. It needs map tiles (or a static outline) plus zoom-to-cluster.
9. **Seeding by hand** took one full read of each chat (~50–110k characters). It produced ~100 Concepts and ~150–240 Relationships per chat. Heuristics that worked:
   - one Concept per distinct option / idea / finding / action
   - criteria extracted as their own Concepts with the turn they were introduced
   - every self-correction recorded as a `corrects` edge
   - people in the chat (kids, the user) as person Concepts

## Candidate: Packs bundle Kinds + Relationship Types + Views

> Superseded: "Packs" now means View Types, and this bundle idea is dropped (see the second pass below).

Each chat wanted a different vocabulary, but the vocabularies clustered:

| Pack | Kinds | Relationship Types | Views |
|---|---|---|---|
| **Learning** | idea, source, claim, person, event | prerequisite, part-of, example, supports/challenges, raises/lowers | learning path, mechanism, evidence, timeline, outline |
| **Decision** | decision, option (thing), criterion, claim, action | option-for, meets/partly/fails, rules-out, chosen, reason/trade-off, corrects | compare (matrix), funnel, rationale, story, corrections |
| **Plan / trip** | place, person, thing, action, event | part-of, enjoys, next-step, located-in | map, calendar, radial plan |

A Graph mixes Packs: the statins chat is Learning plus a small Decision, the printer is Decision plus Learning.

## Second pass: View Types

After the View Types were documented in [`docs/view-types/`](../../../view-types/README.md), the prototype was rebuilt to render exactly those six, and nothing else.

| Graph | Views (View Type) | Opens on |
|---|---|---|
| Statins | Outline (Outline), Compare treatments (Comparison Table), Evidence (Evidence), Mechanism (Cause & Effect, mechanism mode), Timeline (Timeline) | Outline |
| 3D printer | Which printer? (Comparison Table), Air quality (Cause & Effect, risk mode), Air: what to do first (Comparison Table) | Which printer? |
| Family trip | Compare options (Comparison Table), Map (Map), Calendar (Timeline) | Compare options |

**Changes:**
- **Format:**
  - `pivots` became `views`. Each View is `{ viewType, settings }`, with settings typed per View Type.
  - Concepts gained `dateEnd` (a date or `"ongoing"`), `dateApprox`, `lane` and `seq` (sibling order).
  - Attributes gained an `enum` type.
- **Seeds:** each script now ends with a *Curation* block for what the View Types need:
  - criteria `priority` (hard / nice / dropped)
  - options `standing` (chosen / in-play / ruled-out), derived from `chosen` and `rules-out` Relationships plus overrides
  - evidence type on sources, consensus on claims
  - timeline lanes and spans (the trip is one week-long bar; an ongoing treatment is an open-ended span)
  - the outline's sibling order, with each Concept given one primary parent
- **Renderers:**
  - vis-timeline for Timeline.
  - MapLibre + OpenFreeMap for Map.
  - Custom layouts for Evidence (claims centre, supports left, challenges right) and Cause & Effect (a levers band, with trace mode).
  - Comparison Table and Outline were polished per their docs.
- **UI:** every View names its View Type and the question it answers. An ⓘ drawer shows the View Type's markdown, bundled at build time.

**Findings:**
1. **Evidence as hubs works.** With claims in the centre column, Mendelian randomization visibly backs three claims, and THINCS and Lp(a)HORIZON sit alone on the challenge side. The evidence-type and consensus badges make "an RCT vs a dissent group" visible at a glance.
2. **Trace mode exposes the limits of sign alone.** Tracing from statins shows "mixed, via 2 paths" for atherosclerotic plaque: statins lower LDL (−25–55%) but raise Lp(a) "slightly, if anything". The signs are right, but without magnitudes the net reads as a toss-up. Cause & Effect needs magnitudes as data, not only in notes, before net effects are shown.
3. **Risk mode's levers band doubles as the checklist.** Mitigations stacked by rank beside the risk read as "what to do first". The separate ranked table is now nearly redundant, which suggests the two are one View with two renderings.
4. **Grouping criteria by priority reveals data gaps.** Tinting a `fails` on a must-have shows that one rental fails "heated pool" but was never marked ruled out. Standing may be better *derived* (fails a hard criterion → ruled out) than curated.
5. **The Outline's Unsorted group is large:** 36 of the 83 statins Concepts have no topic. It's honest, and it makes a curator's to-do list, but it shows that seeding should give every Concept a home.
6. **Timeline:**
   - Spans and period bars (a year-only date is a bar covering the year) read correctly.
   - The "now" line splits past from planned.
   - Opening on the focus window left "Drug history" looking empty. Lane counts fix the confusion; zoom-out and "Fit everything" reach the history.
7. **The basemap is what makes Map work.** Coastlines, clusters and the chosen resort drawn unclustered turn floating dots into geography.
   - Technical note: MapLibre's worker can't load from a single file on `file://`. The prototype inlines it as a classic worker, via a blob URL and a `#.cjs` hint.
   - The Electron app will need an equivalent solution, plus offline tiles.

## Third pass: a learning chat and seven new View Types

A fourth graph, **AI compute & model internals** (201 Concepts, 425 Relationships, 13 Views), was hand-seeded from a 30-question chat. It runs from "how do I track Claude Code token cost?" to compute economics, inference-cost trends, transformer internals, MoE, open-model specs, post-training, data and post-transformer architectures. It's the first sample that's a true *learning* chat.

**Proven View Types reused:**
- Outline (nine topics)
- Comparison Table (open models; techniques)
- Evidence (12 contested claims, with a new source-independence badge)
- Cause & Effect (compute economics)
- Timeline (ideas / models / market lanes, 1991 → 2035)

**New, experimental View Types** ([definitions](../../../view-types/README.md#experimental-third-prototype-pass)):
- **Anatomy:** nested parts with techniques pinned on.
- **Learning path:** one target plus its prerequisites; a retry of the candidate.
- **Lineage:** ideas over time, banded by area.
- **Maturity ladder:** research → standard, by area.
- **Quadrant:** two enum axes.
- **Misconceptions:** myth → correction, grouped by who held it; reworks the Corrections candidate.
- **Rates & estimates:** per-year rates on a log scale, coloured by source independence.

Maturity ladder and Quadrant share one grid renderer.

**Findings:**
1. **A learning chat supports many more View Types than a decision chat.** All 13 Views had something to show, compared with 3–5 per decision graph. Decision chats want tables; learning chats want structure (anatomy), history (lineage), sequence (path) and calibration (misconceptions, rates, evidence).
2. **The learner's questions are the richest seeding signal.** "What are the query heads you refer to?" is a missing prerequisite; "I'd assume X" is a misconception; "is that number constant?" is a rates question. A seeding agent should mine the *questions*, not just the answers.
3. **Scoping to one target fixed the Learning path.** 11 steps to MLA reads well; the whole-graph DAG didn't. "Known" needs to become reader state that persists.
4. **Group by an Attribute rather than by graph connectivity.** Lineage banded by connected family merged everything into one tangle; banded by area it reads cleanly. Same lesson as Maturity (rows by area).
5. **Tracing found a real insight:** MoE *lowers* serving cost but has a *mixed* net effect on frontier price, because cheaper tokens feed usage growth (Jevons). The graph encodes a feedback loop the chat only described in prose.
6. **Source independence matters as much as consensus.** Most contested claims in this chat pit a vendor's self-reported numbers against an academic or independent check. The Evidence and Rates Views both needed an independence Attribute on sources.
7. **Every Concept got an Outline home this time** (a curation step checks it), so there's no Unsorted group.
8. **Enum Attributes carry this graph:** stage, area, effect, applied, independence, consensus, held by. Four View Types are driven entirely by Attributes, not Relationships. The core data model should treat typed Attributes as first-class, not as a side table.

## Fourth pass: depth in the side panel

Curator review of the third pass:
- **Maturity ladder is just a Quadrant.** It's folded in, with `progression` (draw x as stages with arrows) and `evidence` (an adoption count on each card).
- **Misconceptions is set aside** as a [candidate](../../../view-types/candidates/misconceptions.md). Its Concepts stay in the graph.
- **The Learning path wasn't there yet.**
  - Clicking made the canvas flicker and lost the zoom: an unstable View object re-ran the layout on every click. Fixed.
  - Targets are now techniques with at least 5 prerequisites (16 paths), which drops the generic and the short ones.
- **Every View needs more to learn from in the side panel.**

What changed:
- **Concepts carry three depths of content** (now in CONTEXT.md): a one-line summary; an **overview**, one deep paragraph (90–160 words) that teaches the Concept even if it repeats its neighbours; and an optional **article**, a wiki-style write-up (450–900 words) ending in a "From the chat" section.
- **The side panel became a reader.**
  - Overview first, then "Read the full article" inside the panel.
  - Links in the text (`[text](#c/<id>)`) and related Concepts open in the panel.
  - A back stack spans all of it, and canvas selections stay in sync.
- **Content for the compute graph:** all 201 Concepts have overviews and 68 have articles, about 70k words.
  - Written by five parallel agents, one per topic, working from the chat plus well-established background knowledge, into `seeds/content/compute/*.json`.
  - Validated: every Concept covered, every link resolves, and every article ends with what the chat said.
  - The agents flagged the thin spots: Concepts where the chat said a sentence or two, filled from general knowledge (e.g. QLoRA, DPO, SmolLM3, GLM-4.5/5.1, block diffusion).

Findings:
1. **The panel, not the canvas, is where learning happens.** The View is the map; the overview and article are the territory. Every View Type benefits the same way, which argues for treating panel content as part of the Concept model rather than any View Type.
2. **In-text links make the graph navigable from the prose.** Reading the GQA article and clicking "KV-cache" moves the selection, and the Learning path highlight follows. Prose becomes a second way to walk the graph.
3. **The content tripled the file** (~1.5 MB gzipped for the single-file build). A real product loads articles on demand.
4. **Agent-written content needs provenance.** "From the chat" separates source from background, but the product will want this per claim, or per section, so a curator can see what the source said and what an agent added.

## Fifth pass: every learning path at once

Curator review: "show all the learning paths together, but clicking on a topic fades everything except the prereq tree", and "make the core topics there and the auxiliary ones appear only when you click on something connected to them".
- The Learning path now draws every prerequisite in one fixed layout. Targets and the foundations a third of the paths share are **core**; the other steps are **auxiliary**, hidden behind dashed bridges until something connected is picked.
- Picking a topic focuses its tree: steps numbered, the rest faded, the view zoomed to fit. Reading a step in the panel keeps the focus; "Focus on" switches to that step's own path.
- The Canvas gained an overlay (hidden, lit, badges, bridges, fit) that changes without re-running the layout, so revealing steps never moves the rest.

Findings:
1. **Weight can come from the View, not just the Graph.** "Shared by many paths" is a better core signal here than overall degree; the curator's core/aux pin still overrides.
2. **Stable positions beat a tidy layout on reveal.** Steps appear in the gaps reserved for them, at the cost of whitespace while hidden.
3. **Reading needs a sticky focus.** If opening a step refocused the view, reading along a path would keep collapsing it.
