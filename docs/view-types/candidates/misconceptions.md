---
id: misconceptions
name: Misconceptions
status: candidate — tried once, set aside for now
answers: "What did I (or we) get wrong, and what's actually true?"
tried-in: [compute/myths]
---

# Misconceptions

Cards pairing a **belief that turned out wrong** with **what's actually true**, grouped by who held it: the learner, the source itself, or a popular framing. It reworked the [Corrections](corrections.md) candidate around the learner.

## What was tried

- **AI compute & model internals → Misconceptions.** Ten myth Concepts (tag `myth`, a `held-by` Attribute), each linked by `corrects` from the Concept that sets it straight, with the note saying why.
  - Yours: layers each predicting a token; "Sonnet gets 100× cheaper"; "harder capability bars take longer to catch"; "claude-carbon's token cost is lossy".
  - Popular framings: "capacity is all GPUs", "models keep getting bigger", "experts are topic specialists", "MoE is new", "price tracks cost".
  - Claude's own retracted claim about distillation.
- Rendered as a card grid: the myth struck through, an arrow, then the correction and its note.

## Why it's set aside

Dropped from the prototype for now by the curator after the first pass. It read well, but it wasn't a priority next to making each Concept's own content deep enough to learn from. The myth and correction Concepts stay in the graph (under their topics in the Outline), so the View can come back without re-seeding.

## Ideas for the next pass

- Make "superseded" a Concept *state* rather than a separate View, so every View can strike through or hide a corrected belief.
- Let a seeding agent extract myths from the chat's markers ("that's backwards", "the key correction", "here I overreached").
- Fold into a learner's review: the misconceptions they held, beside the Learning path they took.
