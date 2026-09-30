# @seply/worker

**Lane:** B: Server & infra

## Contract

Cloudflare entry: the Worker (SPA assets + app), the Expedition Durable Object (live room) and the build Workflow.

Today (WP-1.1) it contains:

- **Static assets:** `apps/web/dist`, with SPA fallback. Only `/api/*` runs the Worker first.
- **`/api`:** the `@seply/server` app (`createApp`), mounted with a `connect` that opens one `pg` client per request over the `HYPERDRIVE` binding (none at module scope). Routes: `/api/health`, Better Auth under `/api/auth/*`, `/api/me`, `/api/expeditions`. See the server README.
- **Env:** vars `DB_BRANCH`, `BETTER_AUTH_URL`, `AUTH_PROXY_URL`, `AUTH_TRUSTED_ORIGINS` (set by CI with `--var`), and secrets `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (uploaded by CI with `--secrets-file`). Locally, `.dev.vars` (copy `.dev.vars.example`; gitignored).
- **Scripts:** `dev` (`wrangler dev`), `bundle` (a dry-run deploy that needs no account), `typecheck` (which runs `wrangler types` first), `test` and `lint`.
- **`scripts/ci.mjs`:** the deploy helpers the Deploy workflow uses (Hyperdrive, Neon branch and Worker lifecycle, Worker URLs, the secrets file).
- **`scripts/check-signin.mjs`:** checks a deployed Worker's Google sign-in redirect (production's callback as `redirect_uri`).

See [docs/ops/deploy.md](../../docs/ops/deploy.md) for previews, production, sign-in and local dev.

## Allowed dependencies

@seply/server, @seply/ai, @seply/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
