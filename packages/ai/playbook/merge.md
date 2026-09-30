# Merge and tidy the Concept set (chunk mode)

When the Sources are too long to read at once, the Concept set is built one chunk at a time ([extract](extract.md)), and this pass runs after the last chunk, before the set is committed as one Change ("Found N Concepts in M Sources"). A deterministic pass has already merged Concepts whose normalized titles or aliases match exactly; this pass handles what's left.

## Input

- The whole Concept set so far, with its Relationships.
- **Candidate duplicate groups:** Concepts whose normalized titles or aliases overlap, or whose titles are within a small edit distance.

## Task

1. **Merge true duplicates** with `concept_merge` (survivor, merged): same idea under two names → one Concept. The survivor keeps its title and gains the other's title as an alias, its Tags and `prov`, and every Relationship is repointed. Keep the clearer title as the survivor; if the other has the richer summary, move it over with `concept_update` first.
2. **Keep homonyms and look-alikes apart.** Different ideas with the same or similar names (Attention the mechanism vs the paper; pravastatin vs pitavastatin; Bambu A1 vs P1S) stay separate; disambiguate titles where needed (`concept_update`). Two Concepts of different Kinds merge only if they are plainly the same thing.
3. **Unify Attributes.** The same quantity defined twice → use one Attribute and move the values to it (`concept_update` with `attributes`, `null` to clear the other).
4. **Resolve conflicts.** If two chunks give different values (a date, a number), keep the later-corrected one when a `corrects` Relationship exists; otherwise keep both in the summary and leave the Attribute value unknown.
5. **Hubs and density.** Check there are 5–10 `topic` hubs, that every Concept has exactly one `part-of` parent and reaches a hub through it; add or re-parent where needed (`relationship_remove` the old `part-of`, `relationship_add` the new one). If the set is far above the density target in [extract](extract.md), fold **thin** Concepts into their parent: merge them into it, with what they said moved into its summary.
6. **Weight.** Pin `core` on the Concepts the whole Expedition hangs on: those the Sources return to repeatedly, that many others need (`prerequisite`) or belong to (`part-of`), and that the reader asked about directly. Aim for 10–20% core. Leave the rest unset (Weight is computed later).
7. **Clean up.** Remove duplicate or self-referencing Relationships.

When the set is tidy, reply with a one-line summary and **no tool calls**.
