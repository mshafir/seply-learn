# @umbel/sync

**Lane:** A: Data & sync

## Contract

The client op engine (confirmed + pending ops, rebase, Change coalescing), push/pull client, TanStack DB collections, and later the Relay client (partysocket), undo per Change, view-as-of and Proposal preview. Spec: docs/spec/v1/02-architecture.md §2.3–2.4.

Built so far (WP-0.5 spike, WP-1.3):

| Export | Contract |
|---|---|
| `openSyncClient(opts)` → `SyncClient` | One user, one Expedition. Loads the saved pending ops, pulls the log from the start, rebases the saved ops on top (ops the server already logged are skipped, ops that no longer apply are dropped), then pushes. Rejects, leaving the saved ops untouched, if the first pull fails. `push()`, `pull()`, `sync()`, `status`, `flush()` (queued IndexedDB writes), `dispose()`. With `autoPush` (default) it pushes `pushDelayMs` (200) after an edit and retries failures with backoff (`retryMs`, doubling to a minute). |
| push rules | Pending ops in order, ≤ 1000 per request, with the metadata of their Changes. 409 (an op doesn't apply): pull, rebase, retry; the same op refused twice is dropped. 400 naming an op: that op is dropped. 403/404: the batch is dropped. Refusals go to `onError`. Network errors, 401 and 5xx keep the ops pending. Push results are applied directly when they follow our head with nothing between; otherwise the client pulls. |
| `OpEngine` | Confirmed ops (server order) + pending ops; visible state = confirmed + pending, via `@umbel/domain` `apply`. `propose(bodies, { label?, origin?, changeId?, coalesce? })` applies locally as part of one Change and emits the row diff **synchronously**; `receive(loggedOps)` acknowledges, applies and rebases pending on top (last writer wins per field; ours is the latest writer we know of); `reject(opIds)` drops; `restore(snapshot)` brings back ops saved before a reload. `onPendingChange(snapshot)` is called synchronously after every change to the pending ops. `subscribe(listener)` gets `RowDiff`s (unchanged rows are never re-sent; unchanged entities aren't even compared). |
| Changes | Change ids are ULIDs. An edit joins the open Change when `@umbel/domain`'s `shouldCoalesce` says so (same author, human, same subject, within `COALESCE_WINDOW_MS`); otherwise it starts one. Default labels follow the session ("Edited Attention", "Added Softmax", "Deleted X", "Edited the Timeline View"); a transaction's `metadata.change` (`ProposeOptions`) sets the label or origin or turns coalescing off. |
| `createEngineCollections(engine)` | One TanStack DB collection per logged table: `expeditions`, `concepts`, `articleSections`, `relationships` (keyed `from\|type\|to`), `kindDefs`, `relTypeDefs`, `attributeDefs`, `views`, `sources`. Rows are the `@umbel/domain` state types, live entities only; tags are row fields. Fed through custom `sync` (`rowUpdateMode: "full"`). Every collection's `onInsert/onUpdate/onDelete` and the exported `mutationFn` turn mutations into ops (`mutationsToOps`) and propose them as one Change, then resolve. Never resolve before the engine has emitted the diff (SPIKE.md). |
| `mutationsToOps(state, mutations, at)` | Row mutations → ops for any table, through `@umbel/domain`'s `opsToReach`: field-level sets, tag add/remove, View settings per path, create/delete/move ops. Updates use only the changed fields. Throws `UnsupportedEditError` ("no op for this edit") unless the ops produce exactly the requested rows: tombstones, Relationship endpoints, a View's type, a section's Concept, deleting a Kind or Relationship Type (hide it), invalid values. |
| `SyncTransport`, `fetchTransport({ baseUrl?, fetch?, headers? })`, `SyncHttpError` | Push/pull as an interface (no server imports); the fetch one speaks `POST /api/push` and `GET /api/pull` (packages/server README), same-origin credentials. Error statuses throw `SyncHttpError(status, body)`. |
| `PendingStore`, `IndexedDbPendingStore`, `MemoryPendingStore` | Where pending ops survive a reload. IndexedDB keeps one record per pending op (scoped by Expedition and user), plus the Changes' metadata and the open Change; writes are queued in order, and each tab only deletes ops it knew about, so two tabs don't lose each other's ops. |
| `projectRows`, `rowOf`, `RowProjection`, `TABLES`, row types | The DomainState → table rows projection. |
| `monotonicUlid(now?)` | Strictly increasing ULIDs (pending ops sort by id). |

`@tanstack/db` is pinned exactly (pre-1.0); re-run `src/spike/flicker.test.ts` on every bump. `pnpm --filter @umbel/sync harness` opens the dev-only flicker harness page.

**Tests:** `engine.test.ts` (rebase, coalescing, restore), `collections.test.ts` (every table's mutations → ops, refused edits), `client.test.ts` (a reload with pending ops over fake-indexeddb, last-writer-wins between two clients, 409/403 handling, auto push and retry, paging) against `src/test/fake-server.ts` (the WP-1.2 push/pull semantics in memory), `transport.test.ts`, and `src/spike/flicker.test.ts` (the WP-0.5 evidence, extended to other tables and to the `SyncClient` with its own push/pull timing). `apps/web/e2e/api/sync-client.spec.ts` runs the client against the real Worker and Postgres (CI).

## Allowed dependencies

@umbel/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
