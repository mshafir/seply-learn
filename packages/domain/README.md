# @umbel/domain

**Lane:** A: Data & sync

## Contract

Drizzle schema (Postgres), op kinds and their Zod schemas, the pure `apply(state, op)`, Changes/undo/restore/Merge semantics, built-in Kinds and Relationship Types, View Type settings schemas (shared + personal, with per-View overrides), and the permissions matrix. No I/O. Spec: docs/spec/v1/01-domain-model.md.

## Allowed dependencies

none (besides third-party libraries). See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
