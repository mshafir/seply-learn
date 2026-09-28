---
id: 24
title: View-specific structure
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: []
---

## Question

Views that each want their own hierarchy compete for shared Relationships. For example, Anatomy and Outline both use `part-of`, so re-parenting a Concept for one View changes the other. The seeding prototype also found that `fold` by Relationship Type folds unrelated children.

Decide whether a View's own structure lives in its settings (as data owned by the View) or stays in shared Relationships, with rules for who wins:
- a Concept's parent within this View
- which children fold into which
- sibling order
- which Concepts are shown

Cover how the curator agent and Proposals write it, and how it survives Merge and delete.

## Resolution (2026-09-28)

Grilled with the user.

- **Shared by default:** `part-of` Relationships are the default structure. They are facts about the subject, and every View starts from them.
- **Per-View overrides live in the View's shared settings.** They are validated by the View Type's Zod schema and written through the same ops:
  - `placement: { conceptId: parentId }`: this View's parent for a Concept.
  - `order: { parentId: [conceptIds] }`: this View's sibling order (fractional keys under the hood).
  - `hide: [conceptIds]`: left out of this View by the curator. This is not the reader's personal "hide what I've read".
  - `fold: { conceptId: [conceptIds] }`: explicit folds, replacing "fold every child via a Relationship Type", which folded unrelated children.
- **Re-parenting in the UI** asks **"Just this View"** (an override) or **"Everywhere"** (edit the `part-of` Relationship). The curator agent and Proposals make the same choice explicitly.
- **Merge and delete:** overrides that reference a merged Concept switch to the surviving Concept. Overrides that reference a deleted Concept are ignored while it is deleted and come back if the delete is undone.
- **Concurrency:** View settings are edited by **path-level ops** (`view.set settings.placement.c-kv-cache`), so edits to different entries by different people don't overwrite each other.
- **Schema consequences for [Core data model and operation log](08-core-data-model-and-operations.md):**
  - `concepts.outline_key` is dropped; order is per View.
  - `views.settings` is edited by path.
  - `fold` in the prototype's `CauseEffectSettings` becomes the explicit map.
