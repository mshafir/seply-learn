# @umbel/server

**Lane:** B: Server & infra

## Contract

The Hono app factory: Better Auth, /api (push/pull, per-reader state, Proposals, search, export/import, keys, uploads), /mcp, and the Relay, JobRunner and Mailer interfaces. Runtime-agnostic (Workers and Node). Spec: docs/spec/v1/02-architecture.md, 06-mcp.md.

## Allowed dependencies

@umbel/domain, @umbel/ai. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
