---
id: rates
name: Rates & estimates
status: experimental
answers: "How fast is everything changing, and how sure are we?"
proven-in: [compute/rates]
---

# Rates & estimates

Every **quantitative rate** in a source on **one log scale**, grouped by the quantity it measures, with each estimate coloured by how independent its source is. Several estimates of the same quantity side by side show how much the answer depends on the method.

## Instructions

1. **Make each estimate its own Concept:** the number(s), the method, and a link to its source.
2. **Normalize to one unit** (a multiplier per year here), converting "doubling every 7 months" to ~3.4×/yr, and record direction (rise or fall).
3. **Group by quantity** ("Inference price at fixed capability" has five estimates from 1.7× to 900×).
4. **Show ranges as bars, points as dots**, coloured by the source's independence (independent, academic, analyst, interested, self-reported).
5. **Include a reference** for scale (Moore's law, no-change).
6. **Read it** across rows (what's changing fastest) and within a row (how much the method matters).

## Draws on

- **Kinds:** *measurement* for estimates; *person*/*source* for who reported them.
- **Relationship Types:** "reported by" from estimate to source.
- **Attributes:** quantity (group), low, high, direction, method on estimates; independence on sources.
- **Settings:** those Attribute names and the source Relationship Type.

## Layout & interaction

A table: quantity names on the left, an SVG log axis on the right (falls to the left of 1×, rises to the right). Hover for method and source; click to open the estimate.

## Building it from a source

- Extract every number with a time base. Record the *method* ("all models at current list prices" vs "controlling for frozen prices") because that's what explains the spread.
- Tag the source's interest: a chip vendor's demand forecast is not an independent measurement.

## In the sample graphs

- **AI compute & model internals → Rates & estimates.** Chip compute stock (3.4×), training compute (5×), Nvidia's demand framing (~1000×/yr), capex, data-center power, memory's share of spend, five estimates of inference price decline (1.7× to 900×), pre-training efficiency (3×), and parameter count's rise and one-step fall after GPT-4.

## What worked / what didn't

- **Worked:**
  - Five estimates of the same inference-price decline, from 1.7× to 900×, side by side with their methods and sources, show the chat's main point: the number depends on how you measure.
  - The source colours flag Nvidia's ~1000×/yr demand framing as interested at a glance.
  - Moore's law gives a sense of scale.
- **Didn't / not yet:**
  - One-off steps (models shrinking ~10× after GPT-4) had to be squeezed into a per-year unit.
  - Long labels run past the plot on the right.

## Open questions

- Rates that are one-off steps (the ~10× shrink after GPT-4) don't have a per-year unit. Should they be a different mark?
- Should the time window of each estimate show (2022–2026 vs one year)?
