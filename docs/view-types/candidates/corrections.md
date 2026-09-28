---
id: corrections
name: Corrections
status: candidate — tried, fell flat
answers: "What did the source get wrong and then fix?"
tried-in: [vacation/corrections]
---

# Corrections

Every place the source corrected or sharpened itself: an earlier claim, the later claim that replaced it, and how.

## What was tried

- **Family trip → What changed our minds.** Layered over `corrects` / `refines`. Eight `corrects` edges:
  - tax + fees 14–17% → really ~22% ("measured on real invoices")
  - "skip the on-site pickleball premium" → "on Shabbat, only walkable things count" ("wrong advice once Shabbat was known")
  - the chosen resort's pool "smaller than it used to be" → "Region D's largest outdoor saltwater pool"
  - "no hot tub" → "whirlpools are in-room" (the user spotted it in a photo)
  - "Wi-Fi is spotty" → "free fiber Wi-Fi throughout"
  - "heated pool" → "'lightly heated' (~70°F)" ("'heated' by Gulf of Region D standards only")
  - two findings about Cape changeover conventions
  
  Plus `refines` edges on requirements.

## Why it fell flat

- Each correction is a pair, so the graph was mostly disconnected two-node fragments. A graph layout adds nothing to pairs.
- The superseded claim wasn't visibly superseded (no strike-through, no state), so it read as two competing claims.

## Ideas for the next pass

- A two-column list: *was* → *now*, with the note on why it changed.
- Decide the model first: is a correction a `corrects` Relationship, a "superseded" state on the old claim, or Evidence challenging a claim? (See the corrections fog on the planning map and the Evidence View Type's open questions.)
- Once superseded is a state, every other View Type can hide or strike through superseded claims. That may matter more than a dedicated View.
