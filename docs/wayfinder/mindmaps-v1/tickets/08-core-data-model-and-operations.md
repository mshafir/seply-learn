---
id: 08
title: Core data model and operation log
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: [03, 05]
---

## Question

What is the v1 data model? Cover:
- Graph, Concept (Kind, Tags, markdown, date, Weight pin), Relationship, per-Graph Relationship Types and Packs, View definitions
- Proposal (pending Concept or Relationship, with provenance)
- Snapshot
- Visibility, Collaborators, and roles
- how edits are recorded as operations, so that local-first sync, Snapshots, Proposals, and phase-2 real-time all hang off one model

Informed by the View prototypes and the sync-engine research.

## Update (2026-09-25)

Graph is now **Expedition**. The model must also cover what the [App layout and page flow](12-app-layout-and-page-flow.md) design added: **Sources** and per-Concept (and per-section) provenance, build status per View, shared vs personal View settings, and **Reading status** (the storage and sync of per-reader state is decided in [Per-reader state](16-per-reader-state.md)). The first build writes Concepts directly, not as Proposals.

## Resolution (2026-09-25)

Grilled with the user. The glossary is updated ([`CONTEXT.md`](../../../../CONTEXT.md): **Change** and **Fork** replace Snapshot; Proposal is now a set of edits). ADR: [History comes from the operation log alone; no Snapshots](../../../adr/0001-history-from-the-op-log-no-snapshots.md).

**Operation log**
- **Scope:** everything shared goes through one per-Expedition log: Concepts, Relationships, Kinds, Relationship Types, Attributes, Tags, Views with their shared settings, and Source metadata. **Outside the log** (plain rows): Collaborators, Visibility, per-reader state ([Per-reader state](16-per-reader-state.md)), Proposals (pending).
- **Op shape:** field-level. `{op_id (client ULID), expedition_id, actor, change_id, client_seq, schema_v, kind, target, field?, value?}`, e.g. `concept.create`, `concept.set`, `concept.delete`, `relationship.add`. The server assigns a per-Expedition `server_seq` on push. Last writer wins per field.
- **Tags** are add/remove ops (a set), so concurrent tagging merges. Ops carry a schema version, and the server upgrades old ops on replay (defaults assumed during the session, not asked).
- **IDs** are generated on the client (ULIDs), so offline creation works.
- **Deletes** are tombstones. Deleting a Concept tombstones its Relationships in the same Change, and restoring brings them back together. Pending Proposals that touch it go stale. Nothing is hard-deleted in normal use; any privacy purge is a separate admin action.

**History (no Snapshots)**
- **Change** = a group of ops with one author, one purpose and a label ("Built from 3 Sources", "Accepted 12 Proposals"). Editing sessions coalesce, e.g. per Concept over a few minutes. The history panel lists Changes.
- **Undo** works per Change. It reverts only fields that still hold that Change's value, skips fields edited since, and reports what it kept ("2 edits kept: changed since by Ana").
- **View as of** any Change (replay). **Restore to here** appends inverse ops as a new Change; the log is never rewound.
- **Snapshots are dropped.** Public and unlisted links always show the latest state.
- **Fork** copies the current state (or any point in history) into a new private Expedition owned by the forker, with a fresh log that starts with one "Forked from X" Change. The original's history is not copied, and Sources come along.
- History is visible to **owners and editors only**. Viewers and link readers see the latest state.

**Proposals**
- A pending op batch held outside the log: status, author, origin (in-app AI / MCP), rationale, items.
- Accepting it, whole or item by item, pushes the ops as one Change. Rejecting it records the rejection.
- Each item records the value it expected to replace (its base). If the target has changed since, the item is flagged "changed since proposed" with both versions, and accepting it is an explicit overwrite. New Concepts and Relationships go stale only if an endpoint was deleted.

**Content**
- A Concept has a summary (markdown), an overview (markdown + provenance), and an **article made of ordered sections** `{id, heading, md, provenance}`, each a field-level unit. Phase 2 can swap a section's `md` for a Loro doc.
- The other Concept fields follow the sample format: Kind, Tags, Attributes (keyed by Attribute id), date/span/approx/lane, geo, Weight pin (core/aux), and provenance.
- A **Relationship** is unique per `(from, type, to)`, with a note and provenance. Re-adding it updates the note, so it never duplicates.
- **Built-in Kinds and Relationship Types** live in app code with stable ids (`builtin:prerequisite`). An Expedition refers to them, adds its own, and can hide a built-in. Exports inline the built-ins they use.
- **View** = View Type + shared settings (in the log) + build status and failure reason (in the log). Step labels, progress and streaming nodes are live-only, relayed by the Expedition's Durable Object and never logged. A finished build writes its Concepts as one Change. **Layouts are always computed**: no stored positions, and reader drags aren't saved.

**Sources**
- A Source is an entity in the log (kind: chat / file / link / prompt, title, added by, date). Its raw content is a blob in object storage (R2 on CF; disk or S3 when self-hosted).
- Provenance is a list of refs `{source, locator}` (chat turn, page, etc.). An empty list means background knowledge.
- **Any viewer can see an Expedition's Sources** (v1). The share dialog's "include the Sources" toggle goes away. Making an Expedition public publishes its Sources, and the share dialog must say so plainly.

**Roles**
- Owner (Visibility, invites, delete), editor (edits directly, accepts or rejects Proposals), viewer (reads).
- "Can suggest" is not a role. An agent acts as its user, is labelled "agent via MCP", and only ever writes Proposals.

**Effects on the map**
- Canvas decisions 20–21 are amended: history of Changes, live public links, Fork.
- The "Snapshot compare and restore" fog is dissolved, and the "can suggest" open question is closed.
- [MCP tool surface and skills](10-mcp-tool-surface-and-skills.md) drops "taking Snapshots".
- [In-app AI expansion and Proposal review](11-in-app-ai-expansion-and-proposal-review.md) drops the automatic Snapshot, since an accept is one undoable Change.

## Reopened (2026-09-25)

The first session settled the operation log, history and Proposals, but not the materialized schema (tables, fields, typing of View settings and Attributes, accounts). Continuing the grilling on that.

## Resolution, part 2: the materialized schema (2026-09-25)

- **Storage:** relational tables with typed columns for what is queried or joined, and JSON for the flexible parts (attribute values, View settings, provenance). **One Drizzle schema** in a shared package targets Postgres (jsonb, tsvector) and SQLite (JSON text, FTS5). The op-apply code is shared, so client and server materialize identically. Server-only tables: users/sessions, collaborators, proposals, trash.
- **Accounts:** Umbel Learn's own Better Auth tables for v1. Shared Umbel identity is a later migration.
- **Tables:**

```
expeditions      id, owner_id, visibility, forked_from{exp,seq}?, deleted_at (trash), head_seq
                 + logged: title, summary, status (draft|building|ready), best_view_id
expedition_tags  expedition_id, tag
sources          id, exp, kind (chat|file|link|prompt), title, blob_key, mime, size, added_by, added_at
concepts         id, exp, title, aliases[], kind, summary, overview, overview_prov, attributes{},
                 date, date_end, date_approx, lane, lat, lon, weight_pin, outline_key, prov, deleted_at
article_sections id, concept_id, order_key, heading, md, prov, deleted_at
concept_tags     concept_id, tag
relationships    exp, from, type, to (unique), note, prov, deleted_at
kind_defs        exp, id, label, color, icon, hidden_builtin?
rel_type_defs    exp, id, label, inverse_label, color, dashed, hidden_builtin?
attribute_defs   exp, id, label, type (fixed at creation), unit, enum_values[], deleted_at
views            id, exp, view_type, label, question, order_key, settings{}, settings_version,
                 status (queued|building|ready|failed), fail_reason, deleted_at
changes          id, exp, author, origin (human|build|ai|mcp|restore|merge), label, first_seq, last_seq, at
ops              exp, server_seq, op_id, change_id, client_seq, schema_v, kind, target, field, value
proposals        id, exp, author, origin, rationale, status, created_at
proposal_items   id, proposal_id, ops[], base{}, status
collaborators    exp, user_id, role (owner|editor|viewer)
```

- **View settings:** each View Type ships versioned Zod schemas (shared and personal settings). One schema validates ops, generates the View panel form, and serves as the AI's structured output.
- **Expedition:** title, summary, Expedition Tags (separate from Concept Tags), status draft/building/ready, and a curator-chosen `best_view_id` (default: the first View to finish) are all logged. Owner, Visibility and forked_from are plain columns.
- **Thumbnails:** one fixed illustration per View Type (the design canvas's Thumb set). A Library card shows the best View's type. Nothing is stored per Expedition.
- **Ordering:** fractional index keys for article sections (now rows, not a JSON array), the Views rail and outline siblings.
- **Duplicates:**
  - Titles are not unique.
  - The normalized title and aliases are indexed, so the build and the AI find existing Concepts first.
  - **Merge** is a v1 action and one Change: it moves Relationships, Tags and provenance to the survivor, keeps the loser's title as an alias, and tombstones the loser.
- **Removing a Kind or Relationship Type in use:** reassign or delete its members first, in the same Change. Hiding a built-in works the same way.
- **Relationship Types** store a forward and an inverse label.
- **Attributes:** the type is fixed at creation. Removing an Attribute tombstones the definition and hides its values, so undo restores them.
- **Deleting an Expedition:** owner only; 30 days in Trash, then purge (tables, log, proposals, Source blobs). Forks are unaffected.
- **Tenancy:** one database, every row carries its Expedition's id. The per-Expedition Durable Object is only the live relay.
- **Left to other tickets:** per-reader tables go to [Per-reader state](16-per-reader-state.md); the provenance locator shape goes to [Sources and the build pipeline](15-sources-and-build-pipeline.md).

**Amended by [View-specific structure](24-view-specific-structure.md) (2026-09-28):** `concepts.outline_key` is dropped (sibling order is per View, in settings). View settings are edited by path-level ops. Per-View `placement` / `order` / `hide` / `fold` overrides live in `views.settings`.
