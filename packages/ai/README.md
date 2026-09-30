# @seply/ai

**Lane:** E: AI

## Contract

The curator agent (AI SDK 7 ToolLoopAgent), its tools and view.inspect checks, the skim, writers, the playbook, BYOK/instance providers and cost accounting. Spec: docs/spec/v1/05-ai.md.

### Curator tools and checks (spec §5.3)

| Module | Exports |
|---|---|
| `tools` | `createCuratorTools(opts)` → `{ tools, stage, inspect, commit }`. `TOOL_NAMES` (the model-facing name → the spec's name). Types `CuratorTool`, `ToolResult`, `CuratorCommit`, `CommitResult`, `CuratorToolsOptions`. |
| `stage` | `Stage`: the staged op bodies over a working copy of `DomainState` (`state`, `base`, `staged`, `stage(bodies)` all-or-nothing, `take()`, `discard()`). |
| `inspect` | `inspectView(state, viewId, { views, sources })` → `ViewInspection` (`reading`, `layout?`, `problems`, `warnings`, `ok`). |
| `checks` | `checkView(state, viewId, { sources })`, `checkExpedition(state)` → `Finding[]` (`severity` problem/warning, `code`, `message`, `concepts?`); `MIN_FILL`, `MIN_ROWS`. |
| `search` | `searchExisting(state, query, limit?)`, `normalizeTitle`. |
| `ports` | `ViewReader`, `ViewReading`, `LayoutReport`; `SourceReader`, `Segment`, `memorySourceReader(sources)`. |

- **Tools** (model-facing names; providers allow no dots): `concept_create`, `concept_update`, `relationship_add`, `relationship_remove`, `attribute_define`, `view_build`, `view_inspect`, `source_read`, `search_existing`, and `view_commit` when `onCommit` is given. Each is `{ description, inputSchema, execute }`, the shape AI SDK's `tool()` takes. Inputs are Zod schemas over the `@seply/domain` op schemas (`view_build` is a union with one variant per View Type, carrying that type's settings schema), and `execute` parses its input again whoever calls it. Writing tools return `{ ok: true, id | viewId }` or `{ ok: false, error }`; nothing throws for a bad call.
- **Staged ops:** every write becomes op bodies, validated (`parseOpBody`) and applied (`apply`) to the working copy at once, so the domain's refusal comes back as the tool's error and nothing of that call is staged. Ids are minted with `opts.newId` (ULIDs by default). New Views start `building`, last in the rail.
- **`view_inspect`:** the `ViewReader`'s reading of the View (text) and layout metrics, plus the checks. A `cluttered` layout is a problem.
- **Checks** (ported from `prototypes/seeding/validate.py`, and the build-view playbook's rules). Problems: a Relationship with a missing end; settings naming Concepts, Kinds, Relationship Types or Attributes that don't exist (`dangling-ref`); more than one `part-of` parent in a View that reads part-of (Outline, Anatomy, Learning path) unless its `placement` settles it; Comparison Table: fewer than 3 rows, a criterion column without a priority, a class statement ("Enclosed printers meets Runs ABS") not applied to a member row, a column under 70% filled (a sparse must-have only warns), `chosen` without a citation of the reader deciding (a `user` chat turn or a prompt Source, on the row or a linked `decision` Concept); Cause & Effect: no outcome, nothing into the outcome, lever→lever links, a lever's `part-of` steps not in `fold`. Warnings: Concepts with no Relationships; an outcome that cites no reader turn.
- **`commit({ label, views? })`:** takes everything staged as one Change. It inspects every View the staged ops create or change, plus `views`, and checks the Expedition; with any problem it returns `{ ok: false, blocked }` and keeps the staged ops. Otherwise it marks those Views `ready`, returns `{ ok: true, label, bodies, views }`, calls `onCommit`, and makes the state the new base.
- **Ports:** the app that runs the job fills them. `views` is `@seply/views/inspect`'s `readView` (`{ read: readView }`); `sources` is WP-3.1's segment store (`memorySourceReader` meanwhile). This package never imports `@seply/views` (spec §2.1).

## Allowed dependencies

@seply/domain (and `zod`). See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
