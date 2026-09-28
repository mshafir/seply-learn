---
id: 16
title: Per-reader state
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: [08]
---

## Question

What state belongs to a reader rather than to the Expedition, and how is it stored and synced? Covers:

- **Reading status** per Concept (not read / read / known), and how Views use it (e.g. the Learning path hides or shortens what's read).
- **Personal View settings** (show all steps, hide what I've read) vs shared ones.
- **Continue reading** (last View, focus, step) across devices.
- Privacy (collaborators can't see your reading status unless you share it?), anonymous readers of public Expeditions (local only?), and the desktop app offline.

## Resolution (2026-09-25)

Grilled with the user.

- **Storage:** plain per-user tables, outside the Expedition's op log. They are not part of Changes or undo, and Fork does not copy them.
  - `reading_status(user_id, concept_id, state: unread|read|known, at)`
  - `personal_view_settings(user_id, view_id, settings jsonb, at)`: validated against the View Type's personal Zod schema
  - `reader_position(user_id, expedition_id, view_id, focus_concept_id, step, panel_depth, at)`

  They are saved through a small per-user API, last write wins by `at`. The reader's other tabs and devices get updates on the reader's own channel.
- **Privacy:** reading status and position are **private in v1**, with no "who has read this" for owners or editors. Shared progress (study groups, teachers) is phase 2, alongside learner progress.
- **Anonymous readers** of public or unlisted Expeditions keep their state in the browser's IndexedDB. On sign-in it merges into their account, newest wins. A "Sign in to keep your progress across devices" hint appears after the first mark.
- **Concept changes:**
  - Status stays as set.
  - On **Merge**, the survivor takes the higher status (known > read > unread).
  - Status rows of deleted Concepts are kept but hidden, so undo restores them.
  - v1 has no "updated since you read it" marker.
- **Views:**
  - Every View shows a check on read or known Concepts.
  - Sequence Views (Learning path, Outline) act on it: step counts exclude covered Concepts, and a personal setting, **Hide what I've read** (off by default), removes them.
  - Read and known count the same for skipping; the difference shows only in the panel.
- **Personal settings defaults** come from the **View Type's** Zod defaults only. Curators can't set per-View defaults for personal settings. A reader's own value overrides the default, and "Reset" clears it.
- **Continue reading:** one position per reader per Expedition (View, focused Concept, path step, panel depth). The Library lists the ~3 most recently read. Opening an Expedition you've read lands where you left off, with "Back to the start".
- **Offline:** covered by the read-only offline cache ([Deployment topology and monorepo layout](09-deployment-topology-and-monorepo.md)). Marks made offline are queued in IndexedDB and saved on reconnect (last write wins).
