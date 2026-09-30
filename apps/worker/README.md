# @seply/worker

**Lane:** B: Server & infra

## Contract

Cloudflare entry: the Worker (SPA assets + app), the Expedition Durable Object (live room) and the build Workflow.

Today (WP-1.1, WP-3.2) it contains:

- **Static assets:** `apps/web/dist`, with SPA fallback. Only `/api/*` runs the Worker first.
- **`/api`:** the `@seply/server` app (`createApp`), mounted with a `connect` that opens one `pg` client per request over the `HYPERDRIVE` binding (none at module scope). Routes: `/api/health`, Better Auth under `/api/auth/*`, `/api/me`, `/api/expeditions`. See the server README.
- **The Expedition room** (`src/room.ts`, WP-3.2): `ExpeditionRoom`, a SQLite-backed Durable Object per Expedition (`idFromName(expeditionId)`, binding `EXPEDITION_ROOM`) on the hibernation API. `GET /api/expeditions/:id/live` checks access in the app, then `roomRelay` forwards the upgrade with the join (`x-seply-room-join`, always overwritten). It sends `hello { headSeq, presence: [], builds }` on connect (the latest event of each running job and View, kept in storage; a job's entries go when it ends, and any older than a day), and fans out `build` (RPC `build(evt)`) and `poke { headSeq }` (RPC `poke(headSeq)`, after each commit). It never reads Postgres. Presence, `ops` and `kick` come with WP-4.1.
- **Jobs** (`src/jobs.ts`, WP-3.2): `JobWorkflow`, one Cloudflare Workflow (binding `JOBS`) that runs every kind in `@seply/server`'s `JOB_KINDS` through `runJob`; each `ctx.step` is a `step.do` with exponential backoff, so a step's result is its checkpoint. `workflowsEngine` launches one instance per attempt (`<jobId>-<attempt>`), terminates on cancel, and wakes by pause + resume. **`wrangler dev` doesn't resume a running Workflow after a restart** (production does): with `JOBS_WAKE_ON_START=1` the Worker wakes the open jobs on its first request. Workflow names are unique per account, so CI names it `<worker>-jobs` (`scripts/ci.mjs`).
- **Env:** vars `DB_BRANCH`, `BETTER_AUTH_URL`, `AUTH_PROXY_URL`, `AUTH_TRUSTED_ORIGINS` (set by CI with `--var`), and secrets `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (web push) (uploaded by CI with `--secrets-file`). `JOBS_WAKE_ON_START` for local dev only. Locally, `.dev.vars` (copy `.dev.vars.example`; gitignored).
- **Scripts:** `dev` (`wrangler dev`), `bundle` (a dry-run deploy that needs no account), `typecheck` (which runs `wrangler types` first), `test` and `lint`.
- **`scripts/ci.mjs`:** the deploy helpers the Deploy workflow uses (Hyperdrive, Neon branch and Worker lifecycle including its Workflow, Worker URLs, the secrets file).
- **Tests:** unit tests run in Node with `cloudflare:workers` stubbed (`src/test/`); the room and the Workflow run for real in `apps/web/e2e/api/jobs.spec.ts`, which starts its own `wrangler dev` and kills it mid-job.
- **`scripts/check-signin.mjs`:** checks a deployed Worker's Google sign-in redirect (production's callback as `redirect_uri`).

See [docs/ops/deploy.md](../../docs/ops/deploy.md) for previews, production, sign-in and local dev.

## Allowed dependencies

@seply/server, @seply/ai, @seply/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
