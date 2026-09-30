# Build one View

Runs once per chosen View, one after another, after the Concept set is committed. The View streams in as a live preview and is committed as its own Change when it passes its checks. The same stage serves "Suggest more Views" and "Ask for a specific View" later; then changes to *existing* Concepts come back as a Proposal instead of direct edits.

## Input

- The View: its id (already in the Views rail, queued), `viewType`, `question`, and why it was chosen.
- The **full View Type definition** (question, central Concepts, what it draws on, layout, how to read it). Its settings shape is the `view_build` tool's input for that View Type.
- The Concept set: `id, title, aliases, kind, tags, summary, date, attributes, weight` for every Concept, plus all Relationships.
- The Sources, and `source_read` for segments you need to check (dates for a Timeline, verdicts for a table).

## How to work

1. Read the View Type definition and decide what the View needs (Task below).
2. Add what's missing through the tools: Attributes and their values, Relationships, dates, the few Concepts the View can't do without.
3. `view_build` with the View's id, its View Type, label, question and settings.
4. `view_inspect`: it shows the View as a reader sees it, with its checks. Fix every problem, and the warnings that matter, then inspect again.
5. **Self-review:** read the inspection's reading against the View's question, as the reader would. Does it answer it? Is anything important missing, wrong, padded or unreadable? Fix what you find.
6. `view_commit` with your review in a sentence or two. It is refused while `view_inspect` finds problems; the reply lists them.
7. If the Sources can't support this View, call `view_fail` with a plain reason a reader will understand ("Only one estimate per trend, so there's nothing to compare."), rather than padding it with guesses.

## Task

1. **Choose the central Concepts** for this View's question (the rows of a table, the targets of a Learning path, the claims of Evidence, the parts of an Anatomy).
2. **Fill what the View needs.** Each View Type draws on specific things; make sure they exist:
   - Comparison Table: use `priority` (hard / nice / dropped) on criteria when the Source says which matter most. An Attribute (or a `meets`/`fails` Relationship to a criterion) for every row × column you show. Unknown cells stay unknown, never guessed.
     - **Fill before you filter.** For every criterion the Source weighs options against, first work out each row's verdict from the segments, including statements about a whole class ("enclosed printers can run ABS/ASA", "any printer with an AMS does multicolor") applied to every row in that class, with `prov` on the class statement. Only then judge coverage.
     - **Then drop sparse columns:** a column still under ~70% filled after that goes to the Concepts' summaries and the side panel. **Exception:** criteria the reader cares about (`priority` hard, or discussed in several turns) stay even with some "?" cells, because a missing answer on something that matters is itself useful.
     - **Every criterion column gets a `priority`** (hard / nice / dropped): must-haves are what the reader said they need or what rules options out; the rest are nice-to-haves. The table groups its columns under that band, so an unset priority shows as a generic "Criteria" group.
     - **One row per real choice.** Variants of the same option (new vs refurbished, a bundle) are one row unless the Source weighs them as separate choices; the difference goes in Attributes (e.g. price and refurb price).
     - **Rows are the live options** the question is about. Options the Source ruled out early may stay only if the table's purpose is to show why they fell out; otherwise leave them out.
     - **One rank column per table.** If the Source ranks the same rows in two contexts (in general, and for the office), pick the one that matches the View's question; the other context is a separate View or lives in the summaries.
     - **`standing` (chosen / in-play / ruled-out) records the reader's decisions, not the assistant's advice.** Set `chosen` only where a segment shows the reader deciding or acting ("we'll get the P1S", "I ordered…"), and cite it in `prov`. Recommendations get a rank or `priority`, never `chosen`. When nothing was decided, leave `standing` out.
   - Timeline / Lineage: dates on every placed Concept, lanes.
   - Learning path: `prerequisite` Relationships from each target back to what a newcomer needs first; add missing well-known prerequisites as background knowledge.
   - Evidence: `supports` / `challenges` from evidence to claims, with an evidence-type Attribute. Claims with no challenges are fine; fail only if no claim has any support.
   - Cause & Effect: `raises` / `lowers` / `causes` chains to the outcomes; which Concepts are levers.
     - **The outcome is what the reader cares about, named in their words** ("Air quality risk", "Heart attack risk"), not an intermediate or derived quantity ("Your exposure"). If extraction made only the intermediate, add the outcome and hang the intermediate under it.
     - **Keep it layered so arrows don't cross:** causes → (optional mechanisms) → outcome, and levers → the cause or outcome they act on. Use one positive and one negative type where possible. Levers never link to other levers.
     - **Fold build steps:** steps that make up a lever ("pull the stock filter", "inline fan, pulling not pushing") are `part-of` that lever and listed in `fold`, not separate levers.
   - Map: `geo` on every place.
   - Anatomy / Outline: `part-of` structure; Outline roots are the `topic` hubs (`rootTag: "topic"`).
   - Quadrant: the two enum Attributes on every placed Concept. Enum values are listed low → high; the y axis draws the first value at the bottom.
   - Rates: low/high/direction Attributes per estimate, grouped by quantity.
3. **Write the settings** exactly in the View Type's settings shape (`view_build`).
4. **Label it**: a short label for the Views rail and the question as proposed (you may sharpen it).

## Rules

- To move a Concept under a different parent, remove its old `part-of` (`relationship_remove`) and add the new one. To change it for this View only, use the `placement` override instead.
- Prefer existing Concepts; add a new one only when the View can't answer its question without it. New Concepts carry `prov` like any other.
- If the Sources can't support this View (a Rates view with one estimate per trend), **fail it** (`view_fail`) with a plain reason a reader will understand, rather than padding it with guesses.
- Layout problems (`view_inspect` says cluttered) are fixed by reshaping structure: fewer cross-topic prerequisites, one parent each, levers aimed at one stage, `placement`, `hide`, targets. Never positions.
