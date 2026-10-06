---
id: anatomy
name: Anatomy
status: experimental
answers: "What is this made of, and where does each idea plug in?"
proven-in: [compute/anatomy]
---

# Anatomy

The subject itself drawn as **nested parts** (a system inside a system inside a system), with the ideas that change each part **pinned onto it**. It turns "a list of techniques" into "a map of the machine they modify". Reach for it when a source explains how something is built and then piles modifications, variants or problems onto specific parts of it: a model architecture, an engine, a body system, a codebase, the printer's venting build.

## Instructions

1. **Put the whole at the top:** one root Concept for the thing (a decoder-only transformer).
2. **Nest the parts by containment**, as deep as the source goes: layer stack ⊃ attention ⊃ heads, KV-cache, positional encoding, kernel. Draw containment as boxes inside boxes, never as edges.
3. **Pin every modification onto the part it changes:** GQA and MLA on the heads and KV-cache, FlashAttention on the kernel, RoPE/YaRN/NoPE on position, MoE on the FFN. A pin is a chip inside the box, not a separate node.
4. **Colour the pins by one Attribute** that matters for the reading (maturity here, so you can see which parts are settled and which are in flux).
5. **Leave out** everything that isn't a part or a modification of one: history, evidence, economics.
6. **Read it** box by box: which parts attract the most pins is where the field's effort goes (the KV-cache here).

## Draws on

- **Kinds:** parts are usually *idea* or *thing* tagged as components. Pins are *idea* (techniques), *risk* (failure points) or *action* (fixes).
- **Relationship Types:** `part-of` for nesting; a "changes"/`modifies` type from pin to part.
- **Attributes:** one enum for the pin colour (maturity, effect, status).
- **Settings:** the root(s), the containment and pin Relationship Types, the colour Attribute.

## Layout & interaction

Nested HTML boxes (not a graph canvas). Top-level parts stack vertically; deeper parts wrap side by side. Clicking a box or a pin opens the Concept alongside. Search dims boxes and pins that don't match, but keeps a box visible while any of its pins match.

## Building it from a source

- Extract every *part* the source names, even in passing ("the router is a single linear layer"), and give it exactly one parent.
- Put the source's concrete numbers in the part's summary (61 layers, 128 heads, 256 experts), since that's what makes the anatomy concrete.
- For each technique, ask "which part does this change?" and record it. A technique with no part is a sign of a missing part.

## In the sample graphs

- **AI compute & model internals → Anatomy.** The transformer in DeepSeek-V3's shape: tokenizer, embedding, the 61-layer stack (attention with heads, KV-cache, position and kernel; the FFN with router, 256 routed experts and a shared expert; the residual stream), the output head, and a serving system (batching, precision, decoding). Around 40 techniques are pinned on, coloured by maturity.

## What worked / what didn't

- **Worked:**
  - The KV-cache box collects the most pins (MLA, PagedAttention, KV quantization, prefix caching, KV sharing), which makes the chat's "nearly every inference optimization is a fight over the KV-cache" visible.
  - Maturity colours show settled parts (kernel, serving) against parts still in flux (layer stack, attention).
  - Concrete numbers in summaries ("× 61", "× 256", "7168 → 2048 → 7168") ground the abstractions.
- **Didn't / not yet:**
  - Techniques that change the whole stack (hybrids, pruning) pile onto the layer-stack box and read as a list.
  - A single-parent pin can't express MLA touching both the heads and the KV-cache.

## Open questions

- Should parts carry their own numbers as Attributes (layers: 61) so one Anatomy can compare two models' shapes?
- Where does a pin go when a technique changes two parts (MLA touches both heads and the KV-cache)?
