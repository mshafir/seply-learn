# Stage 4: Write summaries, overviews and articles

Runs last, in the background, in batches. **Every** Concept gets a summary and an overview; only **core** Concepts get a full article in the first build (others get a "Write the article" button that runs this same prompt for one Concept).

## Input

- A batch of Concepts (~10) with their Relationships (titles of neighbours, by type).
- For each, the segments listed in its `prov`.
- The Expedition title and summary, and the reader's goal if known.

## Summary

One line, ≤ 20 words: what it is, in plain words. No "This concept…".

## Overview

**One deep paragraph** (60–160 words; shorter when the Sources say little and you would otherwise pad) that teaches the Concept to someone who has read its prerequisites but not this. Say what it is, why it matters here, and how it connects to the one or two most important neighbours. Use **markdown links** to other Concepts by id (`[mixture of experts](c-mixture-of-experts)`) where the reader would want to jump. Newsreader serif in the panel, so write prose, not bullets.

`overviewProv`: the segments it draws on; `[]` if it's background knowledge.

## Article (core Concepts only)

A wiki-style write-up in **ordered sections**, each with its own provenance:

```json
"article": [
  { "heading": "How it works", "md": "…", "prov": [{ "source": "compute-chat", "segment": "t14" }] },
  { "heading": "Why it matters for cost", "md": "…", "prov": [] }
]
```

- 2–6 sections, **150–900 words** in total, scaled to what the Sources and well-established background knowledge support. Never pad. Headings are the questions a curious reader asks next.
- A section that goes beyond the Sources is **background knowledge** (`prov: []`); say so plainly in the text only if the Sources contradict it.
- If the Sources corrected themselves on this Concept, include the correction and what changed.
- No invented citations, numbers or quotes. Numbers from the Sources keep their provenance.

## Output

`[ { "id": "c-…", "summary": "…", "overview": "…", "overviewProv": [ … ], "article": [ … ] } ]`
