# @umbel/worker

**Lane:** B: Server & infra

## Contract

Cloudflare entry: the Worker (SPA assets + app), the Expedition Durable Object (live room) and the build Workflow.

Today (WP-0.2) it contains:

- **Static assets:** `apps/web/dist`, with SPA fallback. Only `/api/*` runs the Worker first.
- **`GET /api/health`** (Hono): `{ ok, db, branch }`. `db` is `select current_database()` over the `HYPERDRIVE` binding using `pg`, with a client per request. It is `"unconfigured"` when there is no binding and `"error"` (HTTP 503) when the query fails. `branch` is the `DB_BRANCH` var, which is the Neon branch that CI deployed against.
- **Scripts:** `dev` (`wrangler dev`), `bundle` (a dry-run deploy that needs no account), `typecheck` (which runs `wrangler types` first), `test` and `lint`.
- **`scripts/ci.mjs`:** the deploy helpers the Deploy workflow uses (Hyperdrive, Neon branch and Worker lifecycle).

See [docs/ops/deploy.md](../../docs/ops/deploy.md) for previews, production and local dev.

## Allowed dependencies

@umbel/server, @umbel/ai, @umbel/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
