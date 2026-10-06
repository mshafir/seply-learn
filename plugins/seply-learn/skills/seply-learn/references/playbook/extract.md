# Build the Concept set

The curator's first build stage, after the understanding note. You read the **whole Source set** (or, when it doesn't fit, one **chunk** of consecutive segments at a time, with the Concepts earlier chunks made already in the Expedition) and create the Concept set through the tools. It is committed as one Change ("Found 84 Concepts in 3 Sources"); the Views are built from it afterwards. Follow [`_contract.md`](_contract.md) for every shape.

## Input

- The Sources: segments with their ids (and speaker, for chats).
- Your understanding note: what the reader wanted, what they decided, what's still open.
- In chunk mode: the Concepts found so far. **Search before you create** (`search_existing`, by title and by alias) and reuse what's there: add a new alias, Tag, Attribute value or `prov` with `concept_update` instead of making a near-duplicate.

## How to work

1. Define the Attributes you'll need first (`attribute_define`).
2. Create the topic hubs, then the Concepts under them (`concept_create`). Many calls in one turn is fine and faster.
3. Then add the Relationships (`relationship_add`), using the ids the creates returned: every Concept's one `part-of` first, then the rest.
4. Pin `weightPin: "core"` on the 10–20% of Concepts the whole Expedition hangs on (see [`_contract.md`](_contract.md)); leave the rest unset.
5. Check with `search_existing` for duplicates you made under two names; fix them with `concept_update` (aliases) and by not linking the extra one. Don't write overviews or articles: writers do that later.
6. When the set is complete, reply with a one-line summary and **no tool calls**. That ends the stage.

## Shape and size

- **Density:** aim for roughly **one Concept per 400–800 characters** of substantive content, and rarely more than ~200 Concepts per Expedition. **Everything counts toward this**, questions, criteria and takeaways included. Repetitive or chatty Sources get fewer. Options the Source treats together ("simvastatin, lovastatin and atorvastatin", "the older statins") can be **one group Concept**, with members as separate Concepts only where the Source says something distinct about each. Prefer a coarser Concept with a rich summary over several thin ones: organisations, benchmarks, products and papers mentioned once or twice belong in a summary or an Attribute, not their own Concept.
- **Topic hubs:** create **5–10 `topic` Concepts** (also tagged `topic`) that together cover the Expedition, **named in the reader's plain words** ("How cholesterol works", "Downsides & side effects", "How we know", "Compute economics", "Training"). Hubs may also group by kind: a "Sources" hub for cited papers and datasets, a "Measured rates" hub for numeric estimates.
- **One parent each:** every Concept has **exactly one `part-of`** (its primary parent: a hub or a sub-part of one). Other structural ties use other types (`example`, `uses`, `prerequisite`). These hubs are what an Outline and a Learning path hang on; in the first chunk, name the ones you can already see and add more later.
- **Questions and goals:** each thing the reader is trying to decide or find out becomes a `question` Concept, **titled as the question** ("Which printer should we buy?", "Can it make money?"), with the answer so far in its summary. Things they want to achieve are `goal` Concepts.
- **The reader's own situation:** when a chat is about the reader (their health, family, budget, trip), create a `person` Concept for them ("Me", or their name if given) and make their key facts and findings Concepts linked to it, not just Attribute values.
- **Takeaways:** a conclusion the Source reaches is its own `claim` Concept, titled as a **short, memorable statement** (≤ 6 words: "Stick to PLA and PETG", "Inference is memory-bound", "Lifelong statins look safe", "Plaque stabilization"). The full conclusion goes in the summary; other phrasings in `aliases`. A takeaway that only answers a `question` can live in that question's summary instead.
- **Quantities:** when the Sources discuss what drives a cost, price, supply or demand, that **quantity** is its own `measurement` or `idea` Concept ("Serving cost per token", "Available AI compute", "Compute demand"), separate from claims about it.
- **Titles in general:** the short name a reader would search for ("Router", "Heads (Q · K · V)", "A1", "Duct exhaust outside"); longer or formal names go in `aliases`. For the reader's own measurements, put the value in the summary, not in parentheses in the title.

## What makes a good Concept

- **One well-defined chunk of knowledge** that could get its own one-paragraph overview. If you'd need two paragraphs on unrelated things, split it; if it can't stand alone, fold it into its parent.
- One Concept per distinct **option, idea, finding, claim, action, criterion, person, place, source or event** the Sources treat as a thing.
- **Criteria** a reader uses to decide are their own Concepts (kind `criterion`), titled as a short noun phrase ("Price / value", "Can print ABS/ASA", "Fits on a desk"), with the segment where they were introduced. Every criterion the assistant weighs options against counts, even if the reader never named it.
- **People** in the subject (researchers, authors) *and* in the conversation (the user's kids, a doctor mentioned) are Concepts of kind `person`.
- **Numbers that recur** (a price, a rate, a date) become Attributes on the Concepts they describe, not Concepts. Define the Attribute once (`attribute_define`) before you use it.
- **Dates:** set `date` when the Source gives or clearly implies one. Relative dates ("in ~8 weeks") are counted from the Source's own date (the export or conversation date in its header) and get `dateApprox: true`.
- Titles are the name a reader would search for; put abbreviations and other names in `aliases` ("Mixture of experts", aliases ["MoE"]).
- Don't make Concepts for chat mechanics ("the user asked", "the previous answer"), pleasantries, or tool calls.

## What makes a good Relationship

- Use the built-in types. `builtin:prerequisite` is directional: A → B means *you need A to understand B*.
- `part-of` for structure (component → whole, subtopic → topic).
- **Every self-correction** in a chat ("actually, I was wrong about…", "correction:") is a `corrects` Relationship from the corrected-to Concept (or claim) to the corrected-from one, with a note saying what changed.
- Evidence → claim: `supports` / `challenges`. Option → criterion: `meets` / `partly-meets` / `fails`, with a short note ("fails: Saturday check-in only").
- Aim for **at least 2 Relationships per Concept** (the `part-of` to a hub counts). No Concept should be an orphan.
- A **wrong hypothesis the reader offers and the assistant corrects** becomes a `claim` with a `corrects` Relationship from the correct Concept. A reader merely rephrasing their own question ("I meant sterols") is not a correction.

## Provenance

Every Concept and Relationship lists the segments it came from. When you add something the Sources don't say (a well-known prerequisite, a missing date), give it `prov: []` so it's marked background knowledge. Background additions should be rare in this stage.

## What it isn't

- Not the Views: they are built next, one at a time, and may add the Concepts and Relationships they need.
- Not the prose: writers add overviews and articles after the Views.
