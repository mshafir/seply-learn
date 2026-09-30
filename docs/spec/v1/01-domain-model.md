# 1. Domain model

Decided in:
- [Core data model and operation log](../../wayfinder/mindmaps-v1/tickets/08-core-data-model-and-operations.md) (with its amendments)
- [View-specific structure](../../wayfinder/mindmaps-v1/tickets/24-view-specific-structure.md)
- [Per-reader state](../../wayfinder/mindmaps-v1/tickets/16-per-reader-state.md)
- [Permissions table](../../wayfinder/mindmaps-v1/tickets/23-permissions-table.md)
- [Import and export](../../wayfinder/mindmaps-v1/tickets/25-import-and-export.md)

Architectural reason: [ADR 0001: history comes from the operation log alone](../../adr/0001-history-from-the-op-log-no-snapshots.md).

## 1.1 Principles

- **One operation log per Expedition is the source of truth** for everything shared. The tables are a materialized projection of it.
- **Field-level ops, last writer wins per field**, with client-generated ids (ULIDs) and tombstones instead of deletes. Nothing is hard-deleted in normal use.
- **History is Changes, not Snapshots.** Undo, "view as of", restore and Fork all work from the log.
- **AI never writes shared content silently.** The first build (from Sources, from an MCP agent's `create_expedition`, or from an import) and Views a reader explicitly asks for are written directly. Everything else AI produces is a **Proposal**.
- **Per-reader state is private and outside the log.**
- **Layouts are always computed**, and no positions are stored. Views shape their layout through settings.

## 1.2 Entities (materialized tables)

A single Drizzle schema in `packages/domain`. **Postgres only in v1.** The op-apply code (`apply(state, op)`) is pure, so SQLite can return with local-first desktop in phase 2. Every row carries its Expedition's id; everything lives in one database.

```
expeditions      id, owner_id, visibility (private|unlisted|public), forked_from{exp,seq}?, deleted_at (trash), head_seq
                 + logged: title, summary, status (draft|building|ready), best_view_id
expedition_tags  expedition_id, tag                                   (logged, add/remove)
sources          id, exp, kind (chat|file|prompt), title, blob_key, segments_key, mime, size, added_by, added_at
concepts         id, exp, title, aliases[], kind, summary, overview, overview_prov, attributes{},
                 date, date_end, date_approx, lane, lat, lon, weight_pin (core|aux|null), prov, deleted_at
article_sections id, concept_id, order_key, heading, md, prov, deleted_at
concept_tags     concept_id, tag                                      (logged, add/remove)
relationships    exp, from, type, to  UNIQUE(from,type,to), note, prov, deleted_at
kind_defs        exp, id, label, color (palette name), icon, hidden_builtin?
rel_type_defs    exp, id, label, inverse_label, color (palette name), dashed, hidden_builtin?
attribute_defs   exp, id, label, type (text|number|money|bool|enum; fixed at creation), unit, enum_values[], deleted_at
views            id, exp, view_type, label, question, order_key, settings{} (path-edited), settings_version,
                 status (queued|building|ready|failed), fail_reason, deleted_at
changes          id, exp, author, origin (human|build|ai|mcp|import|restore|merge), label, first_seq, last_seq, at
ops              exp, server_seq, op_id, change_id, client_seq, schema_v, kind, target, path?, value?
proposals        id, exp, author, origin (ai|mcp), rationale (the ask), status (pending|partly|accepted|rejected|withdrawn), created_at
proposal_items   id, proposal_id, ops[], base{}, status (pending|accepted|dismissed|stale)
collaborators    exp, user_id, role (owner|editor|viewer)              (plain rows, not logged)
users, sessions, accounts, api_keys                                    (Better Auth tables)
ai_keys          user_id, provider, ciphertext, iv, last4, created_at  (BYOK mode only)
ai_settings      user_id, provider, models{provider: {stage: model}}, ask_cap_cents, updated_at  (per reader)
reading_status   user_id, concept_id, state (unread|read|known), at    (per reader)
personal_view_settings  user_id, view_id, settings{}, at               (per reader)
reader_position  user_id, expedition_id, view_id, focus_concept_id, step, panel_depth, at  (per reader)
trash            expedition_id, deleted_by, purge_after                (30 days)
```

**Field notes:**
- **Provenance** (`prov`, `overview_prov`, section `prov`) is a list of refs `{source, segment, quote?}`. An empty list means **background knowledge**.
- **Dates:** precision comes from the string (`"1987"`, `"2026-11"`, `"2026-11-03"`). `date_end` can be `"ongoing"`. `date_approx` marks relative or fuzzy dates. BCE, eras and "circa" are phase 2.
- **Built-in Kinds and Relationship Types** live in app code, with stable ids (`builtin:prerequisite`). An Expedition refers to them, adds its own, and can hide a built-in. The v1 set is the one in the [seeding contract](../../../prototypes/seeding/prompts/_contract.md):
  - **16 Kinds:** idea, topic, question, goal, person, place, thing, claim, evidence, criterion, decision, action, event, source, measurement, risk.
  - **~18 Relationship Types**, each with a forward and an inverse label, including `corrects` for self-corrections.
- **Colours** are stored as palette names (blue, teal, green, amber, orange, red, pink, violet, indigo, slate, brown, olive), never hex values, so dark mode works.
- **Weight** is computed from structure; `weight_pin` is a curator override. Weight describes the **subject** and is the same for every reader. "I already know this" is Reading status, never a pin.
- **Ordering** uses fractional index keys: article sections and the Views rail. Sibling order inside a View is per View (see §1.6). There is no `outline_key`.

## 1.3 Operations

- **Shape:** `{op_id (ULID), expedition_id, actor, change_id, client_seq, schema_v, kind, target, path?, value?}`.
- **Ordering:** the server assigns a per-Expedition `server_seq` on push, in one Postgres transaction that appends to `ops` and updates the tables.
- **Kinds (v1):**
  - `expedition.set`
  - `concept.create | concept.set | concept.delete | concept.restore`
  - `concept.tag.add | concept.tag.remove`
  - `section.create | section.set | section.move | section.delete`
  - `relationship.add | relationship.set | relationship.remove`
  - `kind.define | kind.hide`
  - `reltype.define | reltype.hide`
  - `attribute.define | attribute.delete`
  - `view.create | view.set (path-level, e.g. settings.placement.c-kv-cache) | view.move | view.delete`
  - `source.add | source.remove`
  - `expedition.tag.add | expedition.tag.remove`
- **Conflicts:** last writer wins per field (or per settings path). Tags are add/remove sets *(assumed default)*. Ops carry `schema_v`, and the server upgrades old ops on replay *(assumed default)*.
- **Deletes are tombstones.** Deleting a Concept tombstones its Relationships in the same Change, and restoring brings them back together.
- **Removing a Kind or Relationship Type in use** first reassigns or deletes its members, in the same Change. **Attribute types are fixed.** Removing an Attribute tombstones the definition and hides its values, so undo restores them.
- **Merge** is one Change. It moves Relationships, Tags and provenance to the surviving Concept, keeps the other's title as an alias, and tombstones it. Reading status: the survivor takes the higher status (known > read > unread).

## 1.4 History: Changes, undo, restore, Fork

- A **Change** groups ops with one author, one purpose and a label ("Built from 3 Sources", "Accepted 12 suggestions", "Edited the MLA overview"). Editing sessions coalesce, for example per Concept over a few minutes.
- **Undo** a Change: revert only the fields that still hold that Change's value, and report the ones kept because they changed since ("2 edits kept: changed since by Ana").
- **View as of** any Change: replay the log up to that point, cached if needed.
- **Restore to here:** append inverse ops as a new Change. The log is never rewound.
- **Fork:** a new private Expedition owned by the forker, holding the current state (or any point in history), with `forked_from` recorded. Its log starts fresh with one "Forked from X" Change. Sources come with it.
- History is visible to **owners and editors**. Viewers and anyone with a link see the latest state only.
- **Public and unlisted links always show the latest state.** For a stable copy, Fork.

## 1.5 Proposals

- A **pending op batch outside the log.** It carries an author, an origin (in-app AI or MCP), a **rationale** (the ask) and items.
- Each item records the **base**: the value it expected to replace. If the target has changed since, the item is `stale` and shows "changed since suggested" with both versions. Accepting a stale item is an explicit overwrite. New Concepts and Relationships go stale only if an endpoint was deleted.
- **Review:** accept or dismiss per item, or accept all.
  - Accepting a Relationship to a new Concept includes that Concept, shown before confirming.
  - Each review action commits **one undoable Change**.
  - Dismissed items are recorded as dismissed.
  - Proposals never expire.
- **What creates a Proposal:**
  - Grow asks (in-app AI).
  - MCP `propose_changes`.
  - A Source added to an existing Expedition: what it adds becomes one Proposal.
  - Changes a later-requested View would make to existing Concepts.

## 1.6 Views: shared settings, personal settings, per-View structure

- A View = a View Type + **shared settings** (logged, and validated by the View Type's versioned Zod schema) + build status and failure reason (logged).
- **Personal settings** (such as "show all steps" or "hide what I've read") live in `personal_view_settings`. They default from the View Type's Zod defaults only; curators can't set per-View defaults for them.
- **Per-View structure overrides** live in shared settings:
  - `placement: {conceptId: parentId}`
  - `order: {parentId: [ids]}`
  - `hide: [ids]`
  - `fold: {conceptId: [ids]}`

  Shared `part-of` Relationships are the default. Re-parenting asks "Just this View" or "Everywhere". Overrides that point at a merged Concept switch to the survivor, and overrides that point at a deleted Concept are ignored until it's restored.
- **Settings are edited by path**, so concurrent edits to different entries don't collide.
- The Views and their settings are specified in [Views and View Types](04-views.md).

## 1.7 Per-reader state

- **Tables:** `reading_status`, `personal_view_settings` and `reader_position`. They are plain, per user, outside the log, and saved through a small per-user API with the newest write winning. Other tabs and devices get updates through the reader's own relay channel.
- **Private in v1:** no "who has read this". Shared progress is phase 2.
- **Anonymous readers** of public or unlisted Expeditions keep this state in the browser's IndexedDB. It merges into their account when they sign in, newest winning, and a "sign in to keep your progress" hint appears after their first mark.
- **Offline:** marks made offline are queued in IndexedDB and saved on reconnect *(assumed)*.
- **Continue reading:** one position per reader per Expedition. The Library lists the three most recent, and opening an Expedition lands where you left off, with a "Back to the start" option.

## 1.8 Visibility, roles, permissions

- **Visibility:**
  - private: the owner and invited Collaborators
  - unlisted: anyone with the link
  - public: listed and searchable

  Viewing needs no login.
- **Roles:** exactly one **owner**, plus **editors** and **viewers**. "Can suggest" is not a role: an agent acts as its user, is labelled "agent via MCP", and writes only Proposals.

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| Read; search; see Sources | ✓ | ✓ | ✓ (anyone, where Visibility allows) |
| Fork | ✓ | ✓ | ✓ (signed in) |
| Edit Concepts, Relationships, Views (shared settings), Kinds, Relationship Types, Attributes | ✓ | ✓ | – |
| Add or remove Sources; Merge; delete Concepts | ✓ | ✓ | – |
| In-app AI (Grow, Write the article); accept or dismiss Proposals | ✓ | ✓ | – |
| View history; undo any Change; restore to a point | ✓ | ✓ | – |
| Invite editors and viewers | ✓ | ✓ | – |
| Change a role; remove a collaborator *(assumed owner-only)* | ✓ | – | – |
| Change Visibility; transfer ownership (to an existing editor); delete to Trash or restore from it | ✓ | – | – |

- **Sources are visible to anyone who can view the Expedition.** Making an Expedition public publishes its Sources, and the share dialog says so plainly.
- **API tokens and MCP agents** inherit their user's role. They optionally restrict to chosen Expeditions, and their writes are always Proposals (or a first build, via `create_expedition`).
- **Deleting an Expedition:** owner only. It goes to Trash for 30 days, then everything is purged: tables, log, Proposals and Source files. Forks are unaffected.

## 1.9 Export and import

- **Export** is available to anyone who can view, in two formats:
  1. **Canonical JSON:** the current state, with `schemaVersion`, built-ins inlined, View settings including overrides, and provenance. Source files are included optionally (default on for owners and editors).
  2. **A Markdown folder:** one note per Concept, with frontmatter, the overview and article as the body, and typed `[[wikilinks]]`, plus an index note per View.

  No history, Proposals, per-reader state or collaborators are exported.
- **Import:** our own JSON only, as a **new private Expedition via a first build** ("Imported from file"). It is validated, upgraded from older versions, and gets fresh ids.
  - A file without `schemaVersion` is version 0: the prototype sample-graph format, upgraded like any older version.
  - Fresh ids go to the Expedition, Concepts, article sections, Views and Sources, with references remapped. Custom Kind, Relationship Type and Attribute ids are Expedition-scoped vocabulary that View settings name, so they are kept.
