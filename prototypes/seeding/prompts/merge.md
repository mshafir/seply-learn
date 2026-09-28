# Stage 2c: Merge chunk results

Combines the per-chunk outputs of [extract](extract.md) into one Concept set, committed as the Change "Found N Concepts in M Sources". In the product a deterministic pass runs first (exact matches on normalized title and aliases); this prompt handles what's left.

## Input

- All chunk outputs.
- Candidate duplicate groups from the deterministic pass: Concepts whose normalized titles or aliases overlap, or whose titles are within a small edit distance.

## Task

1. **Merge true duplicates.** Same idea under two names → one Concept: keep the clearer title, move the other to `aliases`, union Tags and `prov`, keep the richer summary, and repoint every Relationship. Record each merge as `{ survivor, merged: [...] }`.
2. **Keep homonyms and look-alikes apart.** Different ideas with the same or similar names (Attention the mechanism vs the paper; pravastatin vs pitavastatin; Bambu A1 vs P1S) stay separate; disambiguate titles where needed. Two Concepts of different Kinds merge only if they are plainly the same thing.
3. **Unify vocabulary.** Collapse custom Kinds and Relationship Types that mean the same thing, and map any that match a built-in back to the built-in.
4. **Unify Attributes.** Same quantity defined twice → one Attribute; convert values to its type and unit.
5. **Resolve conflicts.** If two chunks give different values (a date, a number), keep the later-corrected one when a `corrects` Relationship exists; otherwise keep both in the summary and mark the Attribute value unknown.
6. **Hubs and density.** Check there are 5–10 `topic` hubs, that every Concept has exactly one `part-of` parent and reaches a hub through it; add or re-parent where needed. If the set is far above the density target in [extract](extract.md), fold **thin** Concepts into their parent's summary: those cited by only one segment whose only Relationships are their `part-of` and one other.
7. **Weight.** Mark as `core` the Concepts the whole Expedition hangs on: those the Sources return to repeatedly, that many others need (`prerequisite`) or belong to (`part-of`), and that the reader asked about directly. Aim for 10–20% core. Leave the rest unset (Weight is computed later).
8. **Clean up.** Drop Relationships whose endpoints vanished, duplicate (from, type, to) triples, and self-loops.

## Output

The same shape as extract's output, for the whole Expedition, plus `"merges": [ { "survivor": "…", "merged": ["…"] } ]` and `"stats": { "concepts": n, "relationships": n, "core": n, "background": n }`.
