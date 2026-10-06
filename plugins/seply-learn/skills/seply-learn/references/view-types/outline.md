---
id: outline
name: Outline
status: proven
answers: "What's in here, organised so I can read it top to bottom?"
proven-in: [statins/outline]
---

# Outline

A collapsible tree of **topics, and the Concepts that belong to each, with one-line summaries**. It turns a graph back into something that reads like good notes: the whole subject at a glance, expandable where you want depth. The statins outline was singled out as "fantastic". It's the best View Type for taking in a graph as a *document*.

## Instructions

1. **Find or create the topics.** These are the handful of headings the knowledge naturally falls into ("How cholesterol works", "Treatments", "Downsides & side effects", "Diet levers", "How we know", "My situation"). Topics are Concepts too, usually kind *idea*, tagged `topic`, pinned auxiliary. Aim for 4–8.
2. **Hang each Concept under the one topic it most belongs to**, using `part-of`. Nest further where a Concept is itself a whole: Lipoproteins ⊃ VLDL→LDL, LDL, HDL, Lp(a), triglycerides.
3. **Order siblings** so reading down tells a story: foundations before consequences, general before specific.
4. **Every line shows the title plus its one-line summary.** The summaries are what make it readable without opening anything.
5. **Read it** top to bottom, expanding where curious. Click a line to open the full markdown alongside.

## Draws on

- **Kinds:** any. Kind icons help scanning (a measurement vs an action under "My situation").
- **Relationship Types:** `part-of`, read child → parent. Other hierarchies can drive an outline too (e.g. `example` under a general idea).
- **Attributes:** none required. Sibling order may become one.
- **Settings:** the root (one topic, or all top-level topics), which hierarchy Relationship Types to follow, and how many levels to open by default.

## Layout & interaction

- An indented list with disclosure chevrons, a Kind icon, the title and, beneath it, the summary in muted text.
- Clicking selects the Concept and opens its content alongside. The chevron expands without selecting.
- Search dims non-matching lines. It should also expand the path to any match.

## Building it from a source

- Name the topics *after* reading the whole source. They should reflect how the knowledge groups, not the order of the chat. (The statins chat wandered: diet, then a personal story, then Lp(a) research, then grapefruit. The outline regroups all of that.)
- Write a **real one-line summary** for every Concept. The Outline fails without it.
- Give every Concept exactly one primary parent. A second home should be a different Relationship, not a second `part-of`.

## In the sample graphs

- **Statins → Outline.** Six topic Concepts at the root.
  - *How cholesterol works* opens to Cholesterol, Lipoproteins (itself opening to VLDL→LDL, HDL, Lp(a), triglycerides), ApoB, LDL receptors and Atherosclerotic plaque (opening to Vulnerable plaque & rupture and Plaque stabilization).
  - *Treatments* lists statins (with the mevalonate pathway and the logarithmic dose response nested under them), ezetimibe, PCSK9 inhibitors, bempedoic acid and the Lp(a) drugs.
  - *Diet levers* opens Portfolio diet into its three actions.
  - *My situation* opens the reader's own Concept into their measurements (kept private; not reproduced here).
  - With summaries under each line, the whole three-week chat reads as one page of notes.

## What worked / what didn't

- **Worked:**
  - Topic Concepts gave the chat a structure it never had in conversation.
  - Nesting kept it short.
  - Summaries made it skimmable.
- **Didn't:**
  - There's no sibling order yet (children appear in data order).
  - The "is part of" label repeated on every line is noise.
  - A Concept only appears if some `part-of` reaches it, so un-homed Concepts silently vanish.

## Open questions

- Sibling order: an explicit order Attribute, or derived from prerequisites (the Learning path's order) where they exist?
- Should Concepts with no parent collect under an "Unsorted" group, so curators see what's un-homed?
- Should the Outline double as the editing surface for structure (drag to re-parent, indent/outdent)?
- Export: the Outline is the obvious path to a Markdown document of the Graph.
