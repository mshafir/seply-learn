# 8. Phase 2 sketch

Out of v1, but v1's design must not block any of it. Each item notes what v1 already does to keep the door open.

| Item | What it is | What v1 already does to allow it |
|---|---|---|
| **Desktop, local-first** | Electron app that edits offline on SQLite and syncs to any server | Pure `apply()`; op log with client ULIDs and push/pull; the Drizzle schema is portable; the op engine is shared |
| **Real-time text co-editing** | Character-level co-editing of overviews and article sections | Sections are separate rows; phase 2 adds a CRDT state column (Yjs likely, following the editor choice) and a `text.update` op, relayed through the same room |
| **Agent mode (harnesses)** | Run builds or Grow with the reader's own Claude Code / Codex / Pi subscription (AI SDK `HarnessAgent`) on desktop and self-host | A tool-based curator agent behind one seam; the tools are shared with MCP |
| **Semantic search** | pgvector embeddings next to full-text | Search queries are isolated in `packages/server` |
| **Cross-Expedition Concepts** | Linking the same Concept across Expeditions | Concept ids are global ULIDs |
| **Shared learner progress** | Study groups or a teacher's view of who read what | Reading status is already a per-user table; sharing becomes a permission on it |
| **AI for viewers** | Question-only "Ask about this Expedition" for readers | The agent and asks are already scoped per request; this adds a read-only toolset |
| **More View Types** | funnel, rationale, hub, conversation story, weighted core (in `docs/view-types/candidates/`); second graphs to prove the experimental types; user-authored and published View Types | View Types are instructions plus a versioned Zod schema, so adding one is data plus a renderer |
| **Instance key quotas** | Usage caps per user when the operator shares a key | Per-request cost accounting already exists for the estimate and caps |
| **Dates** | BCE, eras, "circa" | Date strings carry their own precision |
| **Import/export** | Markdown/Obsidian import; export with history | `schemaVersion` on the JSON; import runs through the first-build path |
| **Email notifications** | Build finished or failed (invites already email in v1) | The `Mailer` and notification events exist |
