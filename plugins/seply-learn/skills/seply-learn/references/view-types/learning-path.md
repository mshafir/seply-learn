---
id: learning-path
name: Learning path
status: experimental
answers: "What do I need to understand first?"
proven-in: [compute/learn]
---

# Learning path

Every route at once, then **one target Concept** on demand: its prerequisites, and theirs, in reading order from foundations to the target. The whole prerequisite DAG fell flat as a tangle (the [candidate](candidates/learning-path.md)); this one stays readable by drawing only the core topics until the reader picks one, and it shrinks as they mark what they already know.

## Instructions

1. **Find the targets:** Concepts specific enough (a filter) with a deep enough path behind them (a minimum number of prerequisites).
2. **Weigh the rest by sharing.** A prerequisite on many targets' paths (a third of them, by default) is a **core** foundation; the others are **auxiliary** steps.
3. **Draw the core only:** targets and foundations, with a dashed bridge across each chain of hidden steps so the map stays connected.
4. **On pick, focus the tree.** Walk prerequisites backward from the picked Concept, transitively; reveal the auxiliary steps on it and its direct neighbours, and fade everything else.
5. **Stop at what's known.** When the reader marks a Concept as known, its own prerequisites drop out of the path.
6. **Order for reading:** prerequisites before what depends on them; number the steps.
7. **Read it** one step at a time in the side panel. Opening a step of the focused tree keeps the focus; picking anything else refocuses.

## Draws on

- **Kinds:** any. Ideas mostly, but a prerequisite can be a thing or a measurement.
- **Relationship Types:** a prerequisite type ("is needed to understand"), A → B meaning A comes first.
- **Attributes:** none required.
- **Settings:** the prerequisite Relationship Types, a filter for which Concepts may be targets, a minimum path length, and (optionally) how many paths make a prerequisite core. The focus and the known set belong to the reader, not the View.
- **Weight:** a curator's `aux` pin keeps a Concept auxiliary; a `core` pin makes a prerequisite core even if few paths share it.

## Layout & interaction

One left-to-right layered layout of every prerequisite, computed once. Hiding and revealing never moves anything: auxiliary steps appear in the gaps they were laid out in.
- Unfocused: core topics only, each target badged with its path length ("11 steps").
- Focused: the tree lit with "step n" badges and a "goal" badge, everything else faded, and the view zoomed to the tree. The toolbar says "To understand X: N steps first", marks the selected step as known, offers "Focus on" a step's own path, and lists what the focus leads to.
- "Show all steps" reveals every auxiliary Concept; a search reveals its matches.
- The side panel is where the learning happens: each step's overview paragraph, and a full article on demand.

## Building it from a source

- The learner's own questions are the best signal. "What are the query heads you refer to?" means query heads are a prerequisite of GQA that the explanation skipped; "back up and explain post-training" means the reader lacked the frame.
- Record a prerequisite only when B can't be understood without A. "Related" isn't enough.
- Prefer small Concepts (Query, key, value) to big ones (Attention) as prerequisites: they make the path precise.

## In the sample graphs

- **AI compute & model internals → Learning path.** 54 Concepts on prerequisites; 16 technique targets and 5 shared foundations (tokenizer, embedding, attention, KV-cache, memory-bound) plus the pinned pre-/post-training are core, 30 steps are auxiliary. Focusing MLA reveals tokenizer → embedding → attention → Q/K/V → heads → multi-head attention, and attention → KV-cache → MQA → GQA → MLA.

## What worked / what didn't

- **Worked:**
  - A target plus its closure is short enough to read (11 steps to MLA) where the whole prerequisite DAG was a tangle.
  - Step numbers make it a reading order, not just a graph.
  - Selecting an off-path Concept offers "learn this instead", which turns the View into a way to navigate.
- **Didn't / not yet:**
  - First review (curator): "not quite there yet".
    - Clicking caused a flicker and lost the zoom. The canvas re-laid itself out on every click; fixed.
    - There wasn't enough content in the side panel to actually learn from, which led to overviews and articles on Concepts.
    - Generic or short paths weren't worth offering; targets are now techniques with at least 5 prerequisites (16 of them).
  - Second review: "show all the learning paths together". Now every path is drawn at once, auxiliary steps stay hidden until something connected is picked, and picking focuses the tree. Replaces the target dropdown and "learn this instead".
  - Prerequisites had to be curated by hand. The chat implies them, but nothing extracts them yet.
  - "Known" lives only in the View's local state.

## Open questions

- Hidden steps leave gaps in the fixed layout. Is a stable layout worth the gaps, or should the core be laid out on its own, with the steps placed after?

- Should "known" persist per reader (a learner profile), and become a Concept state other Views can use?
- Could the path be generated from the questions a learner asks, rather than curated?
