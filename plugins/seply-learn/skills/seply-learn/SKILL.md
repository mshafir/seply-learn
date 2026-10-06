---
name: seply-learn
description: Read, create and curate Seply Learn Expeditions through the seply-learn MCP server. Use when the user wants to turn a chat, document or research into an Expedition, look something up in their Expeditions, or suggest Concepts, Relationships and Views to one (e.g. "save what we learned to Seply", "add this to my Expedition on transformers").
---

# Seply Learn

Seply Learn holds **Expeditions**: bodies of knowledge on one subject, built from **Sources**, split into **Concepts** joined by **Relationships**, and read through **Views**. You work on them through the `seply-learn` MCP tools, as the user, with their role. Use the product's words with the user: Expedition, Source, Concept, Concept Kind, Attribute, Relationship, Relationship Type, View, View Type, Tag. Never say graph, node or edge. The user sees your Proposals as **suggestions**.

## What you can do

- **Read:** `list_expeditions`, `search`, `get_expedition`, `get_view`, `get_concept`, `list_sources`, `get_source_segments`. Answers are compact markdown with ids.
- **Create:** `create_expedition` makes a new private Expedition from Sources and what you extracted from them with your own model. It is written directly, as the Expedition's first build.
- **Suggest:** `propose_changes` makes **one Proposal** on an existing Expedition. It waits in the user's Suggestions until they accept or dismiss it, item by item. You never change an existing Expedition directly.
- **Follow up:** `list_my_proposals` and `withdraw_proposal`.

Every write is validated by the same code as the in-app curator's tools. A refusal says exactly what is wrong: read it, fix it, and call again.

## Ids

- Concepts, Views, Sources and Expeditions have ids the server mints (`01K…`). Copy them exactly; never invent one.
- In `create_expedition` and `propose_changes`, name what you create with a **temp id** (`"new:mla"`) and use it wherever an id is needed later in the same call: in Relationships, View settings, `prov` (Sources) and overview links (`[MLA](#c/new:mla)`). The reply maps each temp id to its real id.
- Built-in Kinds and Relationship Types have fixed ids: `builtin:idea`, `builtin:part-of`, … (see `references/playbook/_contract.md`).

## Creating an Expedition from a chat or document

1. **The Sources.** Give each Source as segments with ids: a chat as turns `t1`, `t2`, … (with `speaker`: `"user"` is the reader), a document as sections `s1`, `s2`, …. Keep the text faithful; trim pleasantries and tool noise.
2. **The Concepts** (`references/playbook/extract.md`):
   - one well-defined chunk of knowledge each, about one per 400–800 characters of substance;
   - short titles a reader would search for, with other names in `aliases`;
   - 5–10 `builtin:topic` hubs in the reader's plain words, and exactly one `builtin:part-of` parent for every Concept;
   - questions the reader is deciding as `builtin:question`, conclusions as short `builtin:claim` takeaways;
   - a one-line `summary` on every Concept, and an `overview` paragraph where you can;
   - `prov` citing the segments each came from (`{source: "new:chat", segment: "t4"}`); `prov: []` marks background knowledge.
3. **The Relationships:** at least two per Concept, built-in types, the most specific one that is true. `prerequisite` runs from what you need first to what needs it.
4. **The Views** (`references/playbook/build-view.md` and `references/view-types/`): pick the 1–4 View Types that answer the questions this subject raises. An **Outline** (topic hubs → parts) always works; add a Learning path, Comparison table, Timeline, Evidence, Cause and effect or Map when the Sources call for it. Settings follow each View Type's shape. Layouts are computed: shape a View with settings and real Relationships, never positions.
5. Call `create_expedition`. If it is refused, fix every listed problem and call again. Then give the user the link from the reply.

## Suggesting changes to an Expedition

1. **Read first:** `get_expedition`, then `get_view` or `get_concept` around what you want to add. `search` before you create a Concept: if it exists under another name, link it (or add an alias) instead.
2. **Propose well** (`references/playbook/grow.md`):
   - one small, coherent batch per call (usually 2–12 items), with a `rationale` the user reads: what you learned and why it belongs here;
   - every new Concept complete in its `concept_create` item (title, kind, summary, overview, tags like its neighbours', prov) and linked in: its one `part-of` parent, and the Relationship that makes it worth adding;
   - edits to existing Concepts are rare; never rewrite an overview a person wrote, never pin Weight;
   - every item must be worth accepting on its own.
3. Never assume a Proposal was accepted. `list_my_proposals` shows what happened; withdraw one you no longer stand behind.

## View Types

| id | Answers |
|---|---|
| `outline` | What's in here, organised so I can read it top to bottom? |
| `learning-path` | What do I need to understand first? |
| `comparison-table` | How do the options stack up against what matters? |
| `evidence` | What do we believe, how strongly, and what is it based on? |
| `cause-and-effect` | What drives what, and what can I pull on to change the outcome? |
| `timeline` | When did (or will) things happen, and what overlaps? |
| `map` | Where is everything, and what's near what? |
| `anatomy` | What is this made of, and where does each idea plug in? |
| `lineage` | Where did this idea come from, and what did it lead to? |
| `quadrant` | Where does each idea sit on the two dimensions that matter here? |
| `rates` | How fast is everything changing, and how sure are we? |

Each View Type's definition (what it draws on, its settings, how to build it from a Source) is in `references/view-types/<id>.md`.
