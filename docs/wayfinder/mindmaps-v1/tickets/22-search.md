---
id: 22
title: Search
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: []
---

## Question

How does search work in v1 across every Expedition a user can see (their own, shared, public), by free text and Tags?
- Postgres full-text (tsvector) versus an external index.
- What is indexed (titles, aliases, summaries, overviews, articles, Tags, Expedition titles), and how results rank and group (Expedition / Concept / Tag, as on the Library's search).
- How Visibility and Collaborator access filter results.
- Search inside one Expedition (the canvas's "Search text or #tag").
- Whether the read-only offline cache searches locally.

Semantic search is phase 2.

## Resolution (2026-09-28)

Grilled with the user.

- **Engine: Postgres full-text.** Maintained `tsvector` columns with GIN indexes; `websearch_to_tsquery`; `pg_trgm` for fuzzy title and alias matches. It works on Neon and self-host alike, with no extra service. Weighting:
  - Concepts: title + aliases **A**, summary **B**, overview **C**, article sections **D**
  - Expeditions: title **A**, summary **B**
- **Global search**, the Library's search, which is a CommandDialog:
  - **Default scope:** Expeditions you own or collaborate on. An **"Include public Expeditions"** toggle widens it.
  - Results are **grouped: Expeditions, Concepts** (with their Expedition), **Tags**. `#tag` filters by Concept or Expedition Tags.
  - **Access is enforced in the query** (collaborator or Visibility), so nothing you can't open appears.
  - Needs a connection.
- **Inside an Expedition:** client-side over the data already loaded (titles, aliases, summaries, Tags), highlighting matches on the canvas as the prototype does. It also works in the **read-only offline cache**.
- **Phase 2:** semantic search (pgvector).
