# View Types

A **View Type** is a named, documented way of looking at knowledge. A **View** is a View Type applied to one Graph, with its settings. Both terms are defined in [CONTEXT.md](../../CONTEXT.md).

A View Type isn't a strict query ("these Relationship Types, this filter"). It's a set of **instructions for looking at the knowledge**:
- the question it answers
- which Concepts are central
- what it draws on
- how it is laid out
- how to read it

The instructions should be concrete enough for a curator to set it up by hand and for an agent to build it from a source (a chat, a doc) or on request through MCP.

## Catalog

| View Type | Answers | Central Concepts | Proven in |
|---|---|---|---|
| [Comparison Table](comparison-table.md) | "How do the options stack up?" | Options (rows) against criteria and Attributes (columns) | all three sample graphs |
| [Outline](outline.md) | "What's in here, organised?" | Topics, nested by part-of | Statins |
| [Evidence](evidence.md) | "What do we believe, and why?" | Claims, each with its supporting and challenging evidence fanned out | Statins |
| [Cause & Effect](cause-and-effect.md) | "What drives what, and what can I pull on?" | Outcomes and the causes/blockers upstream of them | Statins (mechanism), 3D printer (air quality) |
| [Map](map.md) | "Where is everything?" | Located Concepts on a real basemap | Family trip |
| [Timeline](timeline.md) | "When did/will things happen?" | Dated Concepts, as points and spans | Statins, Family trip |

Status: every entry above has been **proven** once in the static prototype ([findings](../wayfinder/mindmaps-v1/prototypes/sample-graphs.md)). Map and Timeline were proven as *ideas*; the prototype renderings fell short, and each definition says what a purpose-built rendering needs.

The prototype ([`prototypes/sample-graphs/`](../../prototypes/sample-graphs/)) now renders exactly these six View Types. Each View there names its View Type, shows the question it answers, and opens this definition in an ⓘ drawer. The "In the sample graphs" and "What worked / what didn't" sections describe the **first** pass; the second pass's changes are in the findings doc.

## Experimental (third prototype pass)

First tried on the *AI compute & model internals* graph: a true learning chat that runs from token cost to transformer internals to post-transformer architectures. Each has a full definition, but has only been used once. Maturity ladder was folded into Quadrant, and Misconceptions was set aside as a [candidate](candidates/misconceptions.md).

| View Type | Answers | Central Concepts |
|---|---|---|
| [Anatomy](anatomy.md) | "What is this made of, and where does each idea plug in?" | Parts nested by containment, with techniques pinned onto them |
| [Learning path](learning-path.md) | "What do I need to understand first?" | One target and its prerequisites, in reading order |
| [Lineage](lineage.md) | "Where did this idea come from?" | Dated ideas linked by "led to", banded by area |
| [Quadrant](quadrant.md) | "Where does each idea sit on two dimensions?" | Concepts placed by two enum Attributes; with a progression axis it's a maturity ladder |
| [Rates & estimates](rates.md) | "How fast is it changing, and how sure are we?" | Per-year rates on a log scale, grouped by quantity |

The same graph also uses the proven types: Outline, two Comparison Tables (open models, techniques), Evidence (with a source-independence badge), Cause & Effect (compute economics) and Timeline (ideas, models, market).

## Candidates needing more passes

These were tried in the first prototype pass and fell flat. They are out of the prototype for now, and each has a short write-up in [`candidates/`](candidates/): what was tried, why it fell flat, and ideas for the next pass.

| Candidate | Tried as |
|---|---|
| [Learning path](candidates/learning-path.md) | Statins → Learning path; 3D printer → Learn to make. *Retried as the experimental [Learning path](learning-path.md), scoped to one target.* |
| [Funnel](candidates/funnel.md) | Family trip → Why options fell out; 3D printer → Decision graph, Money |
| [Rationale](candidates/rationale.md) | Family trip → Why this resort |
| [Hub](candidates/hub.md) | Statins → My situation; Family trip → The trip; 3D printer → For the kids |
| [Conversation story](candidates/conversation-story.md) | 3D printer → How the chat went; Family trip → How the search evolved |
| [Corrections](candidates/corrections.md) | Family trip → What changed our minds. *Reworked for learning as [Misconceptions](candidates/misconceptions.md), itself set aside for now.* |
| [Misconceptions](candidates/misconceptions.md) | AI compute → Misconceptions |
| [Weighted core](candidates/weighted-core.md) | Core concepts, in all three graphs |

## Content in the side panel

Every View Type opens Concepts in the same side panel, and the panel is where a reader actually learns. So Concepts carry content at three depths:
- a one-line **summary**
- an **overview**: one deep paragraph that teaches the Concept on its own, even if it repeats its neighbours
- an optional **article**: a full wiki-style write-up, opened inside the panel

Links in the text (`[text](#c/<id>)`) and related Concepts open in the panel too, with a back stack. A View Type's instructions shape what's on the canvas; the panel is shared.

## Definition format

Every View Type file follows [`_template.md`](_template.md):
1. **Frontmatter:** id, name, status, the question it answers, and where it was proven.
2. **Instructions:** how to look at the knowledge. This is the heart of the definition.
3. **Draws on:** the Kinds, Relationship Types and Attributes it expects, as *typical inputs* rather than hard requirements.
4. **Layout & interaction:** how it renders and what the reader does with it.
5. **Building it from a source:** what an agent or curator extracts to populate it.
6. **In the sample graphs:** how it shaped the actual prototype visuals, with specific Concepts.
7. **What worked / what didn't / open questions.**
