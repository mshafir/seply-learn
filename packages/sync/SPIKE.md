# Spike WP-0.5: op engine + TanStack DB optimistic flicker

**Verdict: no flicker. Keep TanStack DB** (`@tanstack/db` **0.9.2**, pinned exactly).

With the wiring below, no row ever goes back to a value it had already moved past (optimistic → old → confirmed). That holds in every scenario we tried: fast overlapping edits, delayed confirmation, server echo, another client's op landing first, and refused ops. It holds both at the collection's change events and at a live query over it.

The risk from [ticket 20](../../docs/wayfinder/mindmaps-v1/tickets/20-client-sync-layer-and-live-relay.md) is real, but only for one wiring: an explicit transaction (`createTransaction` / `createOptimisticAction`) whose `mutationFn` resolves **before** the op engine's diff reaches the collection. That does flicker, and the tests show it (the negative control). The rule below prevents it.

## The rule (the mitigation we chose)

**The op engine applies the ops and emits the row diff synchronously, inside the `mutationFn`, before it resolves.** The collection's `sync` forwards that diff in the same call stack (`begin → write… → commit`).

This works because of how TanStack DB 0.9 handles sync (read in `collection/state.ts` and confirmed by the tests):

1. While any transaction is `persisting`, committed sync transactions are **queued**, not applied (`commitPendingTransactions`).
2. When the transaction completes, TanStack DB applies the queued sync writes **in the same recompute** that drops the optimistic layer (`onTransactionStateChange` → `capturePreSyncVisibleState`). The row goes straight from the optimistic value to the synced one, with no step in between.
3. This matches the docs: handlers should "coordinate sync internally … The handler completes only after sync coordination is done" ([collection options creator guide](https://tanstack.com/db/latest/docs/guides/collection-options-creator)). Our op engine is local, so "sync coordination" is a synchronous call, not an `awaitTxId`.

A second, built-in safety net: edits made through the collections' own handlers (`collection.update` → `onUpdate`) are "direct" transactions. TanStack DB **keeps a completed direct optimistic row until a sync write touches that key**. So even a late diff doesn't flicker on that path. Explicit transactions don't get this net, so they rely on the rule.

Consequences for WP-1.3:

- `mutationFn` = convert `transaction.mutations` to field ops → `engine.propose(ops)` (applies, queues as pending, emits the diff) → resolve. Durability, push, retry and rebase stay in the op engine. Never resolve first and emit later (no `queueMicrotask`/`requestAnimationFrame` batching of diffs between the engine and the collections).
- Because direct transactions keep their row until a sync write, **every accepted edit must produce a sync write for its key**. An edit no op can express must throw (the transaction rolls back); otherwise it would stay on screen. `conceptMutationToOps` does this.
- One transaction = one Change. `createEngineCollections(...).mutationFn` handles mutations across collections, so a multi-row edit (`createTransaction`) becomes one Change.
- `rowUpdateMode: "full"`: the engine sends whole rows, and unchanged rows are not re-sent (deep-equal check), so an echo of our own op emits nothing.

## Evidence

`src/spike/flicker.test.ts` (Vitest, node, no browser). Each test records **every change event** of the `concepts` collection **and** of a live query (`createLiveQueryCollection` with a `select`) over it. `findFlicker` then checks each timeline against the order values may appear in: values can be skipped or repeated, but a timeline must never go back to an earlier value or show one that should never appear. Change events are finer than renders (React batches events into one render), so a clean event stream means clean renders. That's why a browser run isn't needed to settle the question.

Each scenario runs twice: once through the collection handlers (`collection.update`), once through `createTransaction({ mutationFn })`.

| Scenario                                                                               | Result                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| One edit, echo later                                                                   | optimistic → synced, no revert (at most one redundant same-value event)   |
| Fast typing: 60 overlapping, unawaited edits; pushes and partial echoes interleaved    | no flicker; ends on the last value with nothing pending                   |
| Delayed confirmation: the handler also awaits push + echo (not the design)             | no flicker                                                                |
| Reorder: another client's edit of the same field lands first                           | ours stays on top through the rebase and wins on echo; theirs never shows |
| Reorder on another field                                                               | fields merge; the edited field doesn't move                               |
| A later remote edit legitimately replaces ours                                         | mine → theirs, no revert in between                                       |
| The server refuses the pending ops                                                     | one real revert to the confirmed value, not a flicker                     |
| Randomised: 200 steps of edits, pushes, partial pulls, remote edits (seeded)           | no flicker                                                                |
| **Negative control:** diff delivered after `mutationFn` resolved, explicit transaction | **flickers**: `Concept c1 → A → Concept c1 → A`, caught in both layers    |
| Same late diff, collection handlers                                                    | no flicker (the direct-row net)                                           |

`src/engine.test.ts` covers the op engine itself: pending ops and the synchronous diff, echo acknowledgement (and redelivery), rebase with ours on top, dropping ops that no longer apply, and a local op that doesn't apply.

Run: `mise exec -- pnpm --filter @umbel/sync test`.

## Harness page

`pnpm --filter @umbel/sync harness` (Vite, port 5199; dev-only, outside the package's exports). The page renders Concepts from a TanStack DB live query and types bursts into c1's title (50 edits, 10 ms apart by default). It simulates a random push delay, a random echo delay, and "another client's op landed before our push" with a set probability. A `MutationObserver` records every value the title cell shows in the DOM and counts flickers with the same `findFlicker`. You can switch the edit path (handlers or `createTransaction`) and the diff delivery (`sync`, or `deferred` to see the broken wiring flicker). Per the lane rules, the evidence comes from the Vitest suite. The page was bundled (`vite build`) but not driven in a browser, and there is no Playwright test: the change-event assertions already settle the question.

## What's in the spike code

- `src/engine.ts`: `OpEngine`, with confirmed ops (server order) and pending ops. The visible state is `confirmed + pending`, folded with `@umbel/domain`'s `apply`. `receive` acknowledges and rebases, `reject` drops, and every change emits a row diff synchronously.
- `src/rows.ts`: projects the Concepts and Relationships tables (live rows only).
- `src/collections.ts`: one TanStack DB collection per table with a custom `sync`, and the shared `mutationFn`. Only Concepts are editable in the spike.
- `src/spike/`: `SimServer`/`SimClient` (control over when pushes land and when each client pulls), and the `Recorder`/`findFlicker` detector.

Left for WP-1.3: all tables with `drizzle-zod` row types, IndexedDB mirroring of pending ops, push/pull transport, Change coalescing, undo per Change, view-as-of and Proposal preview. `projectRows` rebuilds every row map per step (O(n)). That's fine for the spike; WP-1.3 should diff only the entities the ops touched. A rebase already emits one diff, so one `begin/commit` per table.

**WP-1.3 update:** the spike code is now the production code (see README.md). All logged tables have collections (rows are the `@umbel/domain` state types rather than `drizzle-zod` ones: the client state has no `expedition_id` column and folds tags into rows); `RowProjection` skips entities whose identity didn't change; pending ops are mirrored to IndexedDB; push/pull go through a `SyncTransport`; Changes coalesce. `flicker.test.ts` runs against all of it, with two new suites: typing into other tables (a Relationship note, a View label) and the `SyncClient` with its own push/pull timing. Undo per Change, view-as-of and Proposal preview are later work packages.

## Watch list (TanStack DB is pre-1.0)

- The no-flicker behaviour depends on internals (queued sync while `persisting`, and direct rows kept until a sync write). Keep `flicker.test.ts` in WP-1.3's suite, and re-run it on every TanStack DB bump. Pin exact versions.
- A redundant same-value update event can fire when the synced row replaces the optimistic one. It's harmless; `useLiveQuery` consumers should not treat an update event as a change of value.
