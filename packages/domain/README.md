# @umbel/domain

**Lane:** A: Data & sync

## Contract

The domain model of an Expedition, pure TypeScript with no I/O. Spec: [`docs/spec/v1/01-domain-model.md`](../../docs/spec/v1/01-domain-model.md).

| Module | Exports |
|---|---|
| `schema` (as `schema.*`) | The Drizzle schema (Postgres, `drizzle-orm/pg-core`) for every table in §1.2, including the Better Auth tables. Logged tables are keyed `(expedition_id, id)`. |
| `ops` | `OpEnvelope`, `OpBody` (a discriminated union of the 28 op kinds in §1.3), `Op`, `parseOp`, `parseOpBody`, `makeOps`, `OP_KINDS`, `SCHEMA_V`, the per-path field schemas. |
| `state` | `DomainState` (the in-memory shape ops fold into), `emptyState`, `relKey`/`parseRelKey`, `isLive`. |
| `apply` | `apply(state, op)` and `applyAll`: pure, never mutate their input, throw `ApplyError` on an invalid op. Tombstone times come from the op's ULID. |
| `history` | `groupChanges`, `stateAt` ("view as of"), `opSubject`/`changeSubject`/`shouldCoalesce` (editing sessions), `undoChange` (reverts only fields still holding the Change's value; returns `kept`), `restoreTo` (inverse ops). Both return op bodies to append as a new Change. |
| `commands` | `mergeConcepts` (one Change: Relationships, Tags, provenance, alias, View overrides, tombstone), `removeKind`, `removeRelType`, `effectiveOverrides` (ignores deleted Concepts), `liveAttributes`, `higherReadingState`. |
| `fields` | The field-level view history is built on: `flattenState`, `diffKeys`, `opsToReach`. |
| `view-types` | `VIEW_TYPES`: for all 11 View Types, a versioned shared-settings schema (with the `placement` / `order` / `hide` / `fold` overrides) and a personal-settings schema; `parseSharedSettings`, `parsePersonalSettings`. |
| `builtins` | `BUILTIN_KINDS` (16), `BUILTIN_REL_TYPES` (18), ids `builtin:<name>`. |
| `permissions` | `PERMISSIONS` (the §1.8 matrix), `can`, `canPropose`, `actionForOp`. |
| `sample` | `sampleToState`: converts the prototype sample-graph JSON into one import Change. |
| `ulid`, `order-key`, `common` | ULIDs, fractional index keys, shared enums and schemas (palette, Visibility, roles, provenance, …). |

### Semantics worth knowing

- **Last writer wins per field** (or per settings path: `view.set` with `settings.placement.<conceptId>`). `value: null` unsets an optional field.
- **Create is an upsert that clears the tombstone** (`concept.create`, `section.create`, `relationship.add`, `kind.define`, `reltype.define`, `attribute.define`, `view.create`, `source.add`). Re-adding a Relationship updates its note; undo and restore use this to bring back entities that have no restore op.
- **Deleting a Concept tombstones its live Relationships** and marks them `deletedWith`; `concept.restore` brings back exactly those (or hands one on to its other end's cascade, if that end is still deleted).
- **Kinds and Relationship Types are hidden, never deleted.** Attributes are tombstoned; their values stay on Concepts and are hidden until undo.

## Allowed dependencies

none (besides third-party libraries: `zod`, `drizzle-orm`). See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
