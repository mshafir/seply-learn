# @umbel/sync

**Lane:** A: Data & sync

## Contract

The client op engine (confirmed + pending ops, rebase, undo per Change, view-as-of, Proposal preview), push/pull client, TanStack DB collections, and the Relay client (partysocket). Spec: docs/spec/v1/02-architecture.md §2.3–2.4.

## Allowed dependencies

@umbel/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
