# @seply/domain

**Lane:** A: Data & sync

## Contract

The domain model of an Expedition, pure TypeScript with no I/O. Spec: [`docs/spec/v1/01-domain-model.md`](../../docs/spec/v1/01-domain-model.md).

| Module | Exports |
|---|---|
| `schema` (as `schema.*`) | The Drizzle schema (Postgres, `drizzle-orm/pg-core`) for every table in §1.2, including the Better Auth tables (their timestamps are `Date`s, as Better Auth expects; the rest are ISO strings). Migrations are generated from it in `packages/server/drizzle`. Logged tables are keyed `(expedition_id, id)`. |
| `ops` | `OpEnvelope`, `OpBody` (a discriminated union of the 28 op kinds in §1.3), `Op`, `parseOp`, `parseOpBody`, `makeOps`, `OP_KINDS`, `SCHEMA_V`, the per-path field schemas. |
| `state` | `DomainState` (the in-memory shape ops fold into), `emptyState`, `relKey`/`parseRelKey`, `isLive`. |
| `apply` | `apply(state, op)` and `applyAll`: pure, never mutate their input, throw `ApplyError` on an invalid op. Tombstone times come from the op's ULID. |
| `history` | `groupChanges`, `stateAt` ("view as of"), `opSubject`/`changeSubject`/`shouldCoalesce` (editing sessions), `undoChange` (reverts only fields still holding the Change's value; returns `kept`), `restoreTo` (inverse ops). Both return op bodies to append as a new Change. |
| `commands` | `mergeConcepts` (one Change: Relationships, Tags, provenance, alias, View overrides, tombstone), `removeKind`, `removeRelType`, `effectiveOverrides` (ignores deleted Concepts), `liveAttributes`, `higherReadingState`. |
| `fields` | The field-level view history is built on: `flattenState`, `diffKeys`, `opsToReach`. |
| `view-types` | `VIEW_TYPES`: for all 11 View Types, a versioned shared-settings schema (with the `placement` / `order` / `hide` / `fold` overrides), a personal-settings schema, and `refs` (the settings paths that name Relationship Types, Kinds and Concepts); `parseSharedSettings`, `parsePersonalSettings`. |
| `builtins` | `BUILTIN_KINDS` (16), `BUILTIN_REL_TYPES` (18), ids `builtin:<name>`. |
| `permissions` | `PERMISSIONS` (the §1.8 matrix), `can`, `canPropose`, `actionForOp`. |
| `sample` | `sampleToState`: converts the prototype sample-graph JSON into one import Change. |
| `expedition-json` | Our JSON (§1.9). `ExpeditionJson` (v1, `EXPEDITION_JSON_VERSION`): the Zod schema with internal references checked (unique ids; Concept Kinds, Relationship ends and types, Attribute values, View settings and their Kind/Relationship Type refs). `stateToExpeditionJson` (export: live entities only, built-ins inlined, sections in order, Views in rail order). `parseExpeditionJson` (validates, upgrading older `schemaVersion`s first; a file without one is version 0, the prototype sample-graph format). `importExpeditionJson` → `{ ops, change, state, ids }`: one "Imported from file" Change (origin `import`) with every entity id re-minted. Throws `ImportError` (`message`, `issues`). |
| `reader` | Per-reader state (§1.7) as **marks**, outside the log: `ReadingMark` (a Concept's Reading status), `ViewSettingsMark` (a View's personal settings: only the reader's own values; `{}` is "Reset"), `PositionMark` (View, focused Concept, step, panel depth), each with an ISO `at`; `ReaderBatch` (one save, across Expeditions, at most `READER_BATCH_LIMIT` of each). `isNewer` (the newest write wins; a tie keeps what is there), `applyMarks` → `ReaderState` (one Expedition, keyed by Concept and View), `stateToBatch`, `mergeBatches`, `coveredConcepts` (read or known). |
| `sources` | Sources and their segments (§5.2 step 1, WP-3.1). `Segment` (`id`, markdown `text`, and `speaker` for chat turns, `conversation` for exports holding several, `heading` for document sections, `page` for PDF pages), `SegmentsDoc` (the segments blob: `v`, `kind` chat \| document, `format`, `chars`, `segments`), `SourceFormat`, `MAX_SOURCE_BYTES` (25 MB), `SEGMENT_MAX_CHARS` (6,000). Ids per the seeding contract: `t14` turn 14, `s3` section 3, `p2` page 2; a longer segment is split at paragraphs into `t3a`, `t3b`, …. The pure port of `prototypes/seeding/segment.py`: `segmentText` (speaker detection, else sections), `detectChat` (pasted chats: `## User` headings, “You said:” / “ChatGPT said:”, `Human:` / `**User:**` lines; needs both a user and an assistant, little before the first marker, and, for heading markers, every heading at that level a speaker), `segmentTurns`, `segmentMarkdown` (levels 1–4, outside code fences), `segmentPages`, `splitLong`. Reading ids: `parseSegmentId`, `findSegments` (a ref's segment: the exact id, else all its parts). File parsers live in `@seply/server`. |
| `ulid`, `order-key`, `common` | ULIDs, fractional index keys, shared enums and schemas (palette, Visibility, roles, provenance, …). |

### Fixtures

`fixtures/` holds our JSON (v1) for the two public Expeditions: `compute.json` (the hand-made compute sample: 201 Concepts, 425 Relationships, 12 Views) and `research-doc.json` (generated from `docs/research/knowledge-graph-learning-tools.md`: 141, 331, 4), plus `trip.json`, a synthetic, hand-written week on a Swiss rail loop (public places, made-up plans, nobody real) with a Map and a Timeline View; the fixtures script leaves it alone. Import them as `@seply/domain/fixtures/<name>.json`. `pnpm --filter @seply/domain fixtures` regenerates them from `prototypes/sample-graphs` by upgrading version 0 files. Never add personal graphs (see the plan's private-data rule).

### Import: what is re-minted

- **Re-minted** (fresh ULIDs, references remapped): the Expedition, Concepts, article sections, Views, Sources, and so Relationship keys. Provenance refs follow their Source; in-text links (`#c/<id>`) in overviews and article sections follow their Concept (`remapConceptLinks`); View settings follow their Concepts (the View Type's `refs.concepts` paths and the `placement`/`order`/`hide`/`fold` overrides).
- **Kept:** custom Kind, Relationship Type and Attribute ids. They are Expedition-scoped vocabulary that View settings name (`x`, `colorBy`, columns), and every row is keyed by its Expedition. A `builtin:` id this server doesn't know becomes a custom definition from its inlined label and colour.
- **Dropped:** references to things not in the file (provenance to a missing Source, View overrides naming a deleted Concept), a dangling best View (the first View is used). Structural references that don't resolve (a Relationship end, a Concept's Kind) reject the file.
- Sources' `addedBy` becomes the importer; Views exported while `queued` or `building` arrive `failed`; the Expedition is `ready`.

### Semantics worth knowing

- **Last writer wins per field** (or per settings path: `view.set` with `settings.placement.<conceptId>`). `value: null` unsets an optional field.
- **Create is an upsert that clears the tombstone** (`concept.create`, `section.create`, `relationship.add`, `kind.define`, `reltype.define`, `attribute.define`, `view.create`, `source.add`). Re-adding a Relationship updates its note; undo and restore use this to bring back entities that have no restore op.
- **Deleting a Concept tombstones its live Relationships** and marks them `deletedWith`; `concept.restore` brings back exactly those (or hands one on to its other end's cascade, if that end is still deleted).
- **Kinds and Relationship Types are hidden, never deleted.** Attributes are tombstoned; their values stay on Concepts and are hidden until undo.

## Allowed dependencies

none (besides third-party libraries: `zod`, `drizzle-orm`). See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
