# @seply/server-node

**Lane:** B: Server & infra

## Contract

Self-host entry: Node + Hono serving the SPA and API, in-process rooms with LISTEN/NOTIFY, pg-boss JobRunner (M6).

## Allowed dependencies

@seply/server, @seply/ai, @seply/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
