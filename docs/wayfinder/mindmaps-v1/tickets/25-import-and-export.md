---
id: 25
title: Import and export
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: []
---

## Question

What does v1 export and import?
- Is the sample-graph JSON (with provenance and View settings) the canonical export?
- Is there a Markdown/Obsidian vault export?
- Does import (of our own format) exist in v1, and does it create a new Expedition as a first build?
- Are Sources included? Readers who can view can see the Sources.
- Do per-reader state and history travel with it?

## Resolution (2026-09-28)

Grilled with the user.

- **Export (anyone who can view):**
  1. **Canonical JSON:** the sample-graph format grown to the v1 schema, with a `schemaVersion`. It contains:
     - Concepts with aliases, provenance and article sections
     - Relationships
     - the Kinds, Relationship Types and Attributes used, with built-ins inlined
     - Views with their settings, including per-View overrides
     - the Expedition's fields and Tags
     - Source metadata, and the raw Source files if the "Include Source files" box is checked (default on for owners and editors)
  2. **Markdown folder** (Obsidian-readable): one note per Concept, with frontmatter (kind, tags, aliases, attributes, date), the overview and article as the body, and Relationships as `[[wikilinks]]` under typed headings. It also has an index note per View.
- **Contents:** **current state only.** No Changes or op log, no Proposals, no per-reader state, no collaborators. This is consistent with Fork: the other side starts a fresh history.
- **Import (v1):** our own JSON only, always as a **new private Expedition via a first build** (one Change, "Imported from file"). It is checked against the domain Zod schemas and upgraded from older `schemaVersion`s. Ids are re-minted, with references remapped. This covers backups and moving between hosted and self-hosted instances.
- **Phase 2:** Markdown/Obsidian import, and export with history.
