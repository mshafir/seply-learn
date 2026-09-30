# @seply/worker

**Lane:** B: Server & infra

## Contract

Cloudflare entry: the Worker (SPA assets + app), the Expedition Durable Object (live room) and the build Workflow.

Today (WP-1.1) it contains:

- **Static assets:** `apps/web/dist`, with SPA fallback. Only `/api/*` runs the Worker first.
- **`/api`:** the `@seply/server` app (`createApp`), mounted with a `connect` that opens one `pg` client per request over the `HYPERDRIVE` binding (none at module scope). Routes: `/api/health`, Better Auth under `/api/auth/*`, `/api/me`, `/api/expeditions`. See the server README.
- **`SOURCES`:** the R2 bucket for Source files and segments (spec §2.7), passed to the app as `blobs` (`r2BlobStore`). `wrangler.jsonc` names `seply-sources`; CI points previews at `seply-sources-preview` (`scripts/ci.mjs r2-bucket`, which also creates a missing bucket). `wrangler dev` simulates it locally.
- **Env:** vars `DB_BRANCH`, `BETTER_AUTH_URL`, `AUTH_PROXY_URL`, `AUTH_TRUSTED_ORIGINS` (set by CI with `--var`), and secrets `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (uploaded by CI with `--secrets-file`). Locally, `.dev.vars` (copy `.dev.vars.example`; gitignored).
- **AI env** (WP-3.3; the server README's "AI" section has the full list):
  - `AI_GATEWAY_API_KEY` (secret): the hosted instance key. CI uploads it from the repo secret of the same name.
  - `AI_KEYS_MASTER_KEY` (secret): 32 random bytes, base64 (`openssl rand -base64 32`). Readers' own keys are AES-GCM encrypted under it in bring-your-own-key mode. CI uploads it when the repo secret exists; the hosted instance doesn't need it while it runs in instance-key mode.
  - `AI_KEY_MODE` (var): `instance` (default) or `byok`. Unset on previews and production. The e2e Worker runs `byok` with a test-only master key (`apps/web/playwright.config.ts`).
- **Scripts:** `dev` (`wrangler dev`), `bundle` (a dry-run deploy that needs no account), `typecheck` (which runs `wrangler types` first), `test` and `lint`.
- **`scripts/ci.mjs`:** the deploy helpers the Deploy workflow uses (Hyperdrive, Neon branch and Worker lifecycle, the Sources R2 bucket, Worker URLs, the secrets file).
- **`scripts/check-signin.mjs`:** checks a deployed Worker's Google sign-in redirect (production's callback as `redirect_uri`).

See [docs/ops/deploy.md](../../docs/ops/deploy.md) for previews, production, sign-in and local dev.

## Allowed dependencies

@seply/server, @seply/ai, @seply/domain, and @seply/views only for `@seply/views/inspect` (the curator's ViewReader; spec §2.1). See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
