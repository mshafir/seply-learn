# Skim (propose Views)

Runs on a fast model the moment the reader clicks Next, with structured output (no tools). It must finish in ~10–20 s, so it reads a **sample**, not everything: the first and last few segments of each Source, every user turn of a chat (they carry the questions), and the headings of documents. The curator starts building the Concept set at the same moment; this stage never waits for it.

## Input

- The segments sample, labelled with source and segment ids.
- The View Type catalog: for each View Type, its name, the question it answers, what it draws on, and how it is built from a source (from `docs/view-types/*.md`: the frontmatter `answers` line and the sections "Draws on" and "Building it from a source"). Only proven and experimental View Types are offered; candidates never are.
- Optionally the reader's goal chips from the Sources screen (e.g. "learn it", "decide", "plan").

## Task

1. Name the Expedition: a short title (≤ 6 words) and a one-sentence summary of what it covers.
2. Propose **4–8 Views** that would each answer a real question these Sources raise. For each:
   - `id`: `v-` plus a short kebab name (`v-learning-path`, `v-compare-models`).
   - `viewType`: one from the catalog.
   - `question`: the question in the reader's terms, specific to this material ("How do the open models stack up?", not "Comparison").
   - `why`: one short line tying it to the Sources ("You kept asking 'what is…' and 'back up'", "The sources disagree on a few numbers").
   - `on`: true for the 3–4 you'd start with.
   - `confidence`: high / medium.
3. Rank them; the first is the proposed **best View** (what the Expedition opens on).

## Rules

- A View Type fits only when its central Concepts clearly exist in the Sources (a Timeline needs dates, a Map needs places, a Comparison Table needs ≥ 3 comparable options, Rates needs several numeric estimates of the same trends, Evidence needs claims with support or dissent).
- Prefer the question the reader was actually asking. A learning chat almost always wants a Learning path; a decision chat a Comparison Table; a trip a Map and Timeline.
- Two Views of the same View Type are fine when they answer different questions (e.g. two Comparison Tables: models vs techniques).
- Don't propose candidate View Types (see the catalog's "candidates" list).

## Output

```json
{ "title": "…", "summary": "…", "views": [ { "id": "v-…", "viewType": "…", "question": "…", "why": "…", "on": true, "confidence": "high" } ] }
```
