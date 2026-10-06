---
id: quadrant
name: Quadrant
status: experimental
answers: "Where does each idea sit on the two dimensions that matter here?"
proven-in: [compute/quadrant, compute/maturity]
---

# Quadrant

Concepts placed in a grid by **two Attributes at once**, one per axis, so clusters and empty corners stand out. The classic 2×2 (effort vs impact, risk vs reward), generalized to any two ordered enums.

When one axis is a **progression** (research → small-scale → shipped → standard), the same grid reads as a *maturity ladder*, a tech radar for one subject. That was first prototyped as its own View Type and folded in here: it was a Quadrant with stages on x, areas on y, and an adoption count on each card.

## Instructions

1. **Pick the two dimensions** the source keeps using to classify things. Here: what a technique *buys* (efficiency ↔ quality) and *when* it's applied (at serving time on frozen weights ↔ in post-training ↔ baked into the architecture).
2. **Give each Concept a value on both**; leave out those that don't have both.
3. **Order each axis** meaningfully (the enum's value order).
4. **Read it** for clusters (most architecture work is efficiency) and empty or sparse cells (few serving-time tricks improve quality).

## Draws on

- **Kinds:** any.
- **Attributes:** two enum Attributes (numeric ones could be binned later).
- **Relationship Types:** optional adoption Relationships (model `uses` technique), counted on each card as evidence.
- **Settings:** the x and y Attributes, Tags to include, `progression` (x is an ordered sequence of stages: draw it as a ladder with arrows), and `evidence` (Relationship Types to count on each card).

## Layout & interaction

A grid of dashed cells with cards, with the axis names in the corner. With `progression`, the x headers are tinted stages with arrows between them. Hovering a card lists what uses it; clicking opens it in the side panel.

## Building it from a source

- Look for recurring either/or framings: "pure serving trick vs baked in at training", "efficiency play vs quality play".
- Record both values as Attributes on every Concept the framing applies to.

## In the sample graphs

- **AI compute & model internals → Maturity** (progression). Around 50 techniques by stage across and area down. Standard: GQA, FlashAttention, PagedAttention, RoPE, MoE, RLVR, LoRA. Shipped: MLA, DSA, YaRN, NoPE, hybrids, diffusion LMs. Small-scale: Mamba, BLT, GShard/Switch. Research: KV-sharing, layer pruning, concept models, latent reasoning. Adoption counts (MoE used by 10 models, MLA by 5) back the stage judgments.

- **AI compute & model internals → Efficiency vs quality.** The chat's own two classifications: serving tricks that work on frozen weights (FlashAttention, PagedAttention, quantization, prefix caching) versus architecture choices (GQA, MLA, DSA, MoE), crossed with efficiency vs quality. It makes the chat's conclusion visible: architecture work has been mostly efficiency; quality came from post-training.

## What worked / what didn't

- **Worked:**
  - The chat's conclusion is visible at a glance: every serving-time technique is pure efficiency, and quality sits in post-training.
  - Empty cells mean something (nothing applied at serving time buys quality).
  - As a ladder, rows by area make the frontier legible: serving is all "standard", while position, MoE and attention have live "shipped" work.
- **Didn't / not yet:**
  - A stage is a curator's judgment with no date, even though the chat itself says the frontier moves monthly.
  - Three values per axis make a 3×3 rather than a true 2×2, and the busiest cell (architecture × efficiency) becomes a long list.

## Open questions

- Numeric axes (a real scatter) when the Attributes are numbers?
- Should an Attribute value carry "as of", so a progression axis can animate over time?
