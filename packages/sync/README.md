# @umbel/sync

**Lane:** A: Data & sync

## Contract

The client op engine (confirmed + pending ops, rebase, undo per Change, view-as-of, Proposal preview), push/pull client, TanStack DB collections, and the Relay client (partysocket). Spec: docs/spec/v1/02-architecture.md §2.3–2.4.

Built so far (the WP-0.5 spike, see [SPIKE.md](SPIKE.md)):

| Export | Contract |
|---|---|
| `OpEngine` | Confirmed ops (server order) + pending ops; visible state = confirmed + pending, via `@umbel/domain` `apply`. `propose(bodies)` applies locally as one Change and emits the row diff **synchronously**; `receive(loggedOps)` acknowledges, applies and rebases pending on top; `reject(opIds)` drops. `subscribe(listener)` gets `RowDiff`s (unchanged rows are never re-sent). |
| `createEngineCollections(engine)` | TanStack DB collections (`concepts`, `relationships`) fed by the engine through custom `sync` (`rowUpdateMode: "full"`), plus the shared `mutationFn`: mutations → field ops → `engine.propose`, then resolve. Never resolve before the engine has emitted the diff (SPIKE.md). An edit no op expresses throws. |
| `projectRows`, `TABLES`, row types | The DomainState → table rows projection (live rows only). |

`@tanstack/db` is pinned exactly (pre-1.0); re-run `src/spike/flicker.test.ts` on every bump. `pnpm --filter @umbel/sync harness` opens the dev-only flicker harness page.

## Allowed dependencies

@umbel/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
