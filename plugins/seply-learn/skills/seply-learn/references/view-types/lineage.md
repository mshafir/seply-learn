---
id: lineage
name: Lineage
status: experimental
answers: "Where did this idea come from, and what did it lead to?"
proven-in: [compute/lineage]
---

# Lineage

A **family tree of ideas over time**: each idea placed at when it appeared, linked to what it built on and what it led to, grouped into families. It shows whether progress came in breakthroughs or in long tails of refinement, and how ideas cross between families.

## Instructions

1. **Place each dated idea on a time axis.** Use one column per distinct year rather than a linear scale, so a 1991 origin and a crowded 2025 share a readable axis.
2. **Link older to newer** with "led to", each link's note saying *what changed* ("one shared K/V head", "a frequency-aware squeeze").
3. **Group into families** (connected ideas). Each family gets a band, labelled by its origin.
4. **Leave out** undated ideas and anything with no ancestor or descendant.
5. **Read it** along a band: a long chain of small steps is incremental progress; a band that starts late and runs fast is a new paradigm.

## Draws on

- **Kinds:** mostly *idea*; *thing* for products or models that embody a step.
- **Relationship Types:** a "led to" / "builds on" type, older → newer.
- **Attributes:** the Concept date (year precision is enough).
- **Settings:** the lineage Relationship Types and optional Tags to include.

## Layout & interaction

Bands stacked by the family's earliest year, columns by year with year labels on top, a year badge on every node. Selecting a node lights up its direct ancestors and descendants and shows each link's note.

## Building it from a source

- Whenever the source says "X improved on Y", "X is a variant of Y", "X borrowed Y", record a led-to link with what changed.
- Date ideas by first publication or release, at the precision known.
- Cross-family links matter (a technique adopted by a different family), so keep them.

## In the sample graphs

- **AI compute & model internals → Lineage.** Families: attention (Transformer → MHA → MQA → GQA; MHA → MLA → DSA), position (RoPE → PI → YaRN; RoPE → NoPE), MoE (1991 → sparse gating 2017 → GShard → Switch → fine-grained + shared → dropping the shared expert; load-balancing loss → aux-loss-free), RL (RLHF → DPO, RLVR; GRPO → variants), fine-tuning (LoRA → QLoRA), and alternatives (SSMs → Mamba → hybrids).

## What worked / what didn't

- **Worked:**
  - Year columns kept 1991 and 2025 on one readable axis.
  - Banding by *area* read far better than banding by connected family: cross-links (transformer → hybrids, MLA → DSA feeding a new attention family) merged families into one tangle.
  - The MoE band shows the chat's thesis directly: one idea (1991/2017), then a decade of small steps.
- **Didn't / not yet:**
  - Undated ideas drop out silently, so several needed dates added.
  - Long links across many empty years are hard to follow.

## Open questions

- Should models (the things that shipped an idea) sit on the lineage, or stay in the Timeline?
- Is "led to" one Relationship Type, or several (refines, replaces, combines)?
