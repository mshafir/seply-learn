# @seply/worker

**Lane:** B: Server & infra

## Contract

Cloudflare entry: the Worker (SPA assets + app), the Expedition Durable Object (live room) and the build Workflow.

Today (WP-1.1, WP-3.2, WP-4.1, WP-5.2) it contains:

- **Static assets:** `apps/web/dist`, with SPA fallback. Only `/api/*` runs the Worker first.
- **`/api`:** the `@seply/server` app (`createApp`), mounted with a `connect` that opens one `pg` client per request over the `HYPERDRIVE` binding (none at module scope). Routes: `/api/health`, Better Auth under `/api/auth/*`, `/api/me`, `/api/expeditions`. See the server README.
- **The Expedition room** (`src/room.ts`, WP-3.2, WP-4.1): `ExpeditionRoom`, a SQLite-backed Durable Object per Expedition (`idFromName(expeditionId)`, binding `EXPEDITION_ROOM`) on the **hibernation API** (`ctx.acceptWebSocket`), keeping nothing in memory, so it can be evicted while its sockets stay open. `GET /api/expeditions/:id/live` checks access in the app, then `roomRelay` forwards the upgrade with the join (`x-seply-room-join`, always overwritten: user, name and `access`). Each socket's join (with its Collaborator `role`, WP-5.1) and presence live in its attachment, and its tags are its access and `u:<userId>`. Storage holds the head seq, the latest event of each running build (a job's entries go when it ends, and any older than a day) and agents' presence with their expiry. The protocol (`@seply/domain` `room.ts`):
  - On connect, `hello { headSeq, presence, builds, you? }`: collaborators get everyone else's presence and their own participant id; signed-in readers of a link get no presence; anonymous readers get no presence and no builds.
  - `ops { from, to, ops }` (RPC `ops(msg)`) and `poke { headSeq }` (RPC `poke(headSeq)`) to everyone after each commit: `roomRelay.published` sends the ops themselves when the batch is contiguous and under 64 KB of JSON (`opsMessage`), else a poke, so large batches never cross into the room. `roomRelay.poke` pokes at the current head when Proposals change (WP-4.3), so open Suggestions tabs fetch them again.
  - `build` (RPC `build(evt)`) to collaborators and readers.
  - A collaborator's `presence {view, cursor, selection, editing?}` is stored on its socket and fanned out to the other collaborators; `leave`, a close or an error sends `leave { id }` once. Frames from readers, frames over 4 KB and invalid ones are ignored.
  - `kick(userId | null, reason)` sends `kick {reason}` and closes the user's sockets (or every reader's and anonymous reader's) with code 4001; clients don't reconnect after it. Sharing (WP-5.1) kicks a user who is removed or whose role changes; the Expedition screen then reopens and reads its new access (gone, or read-only).
  - **Roles:** the room takes no ops from any client, whatever its role (ops arrive only through `/push`, which checks the role per op, then the Worker's `ops` RPC); a viewer's presence never carries `editing`.
  - `agentPresence({ userId, label, ttlMs })` shows an agent (`agent:<userId>`) to collaborators until its TTL passes without a renewal; an alarm sends its `leave`.
  It never reads Postgres.
- **Jobs** (`src/jobs.ts`, WP-3.2): `JobWorkflow`, one Cloudflare Workflow (binding `JOBS`) that runs every kind in `@seply/server`'s `JOB_KINDS` through `runJob`; each `ctx.step` is a `step.do` with exponential backoff, so a step's result is its checkpoint. `workflowsEngine` launches one instance per attempt (`<jobId>-<attempt>`), terminates on cancel, and wakes by pause + resume. **`wrangler dev` doesn't resume a running Workflow after a restart** (production does): with `JOBS_WAKE_ON_START=1` the Worker wakes the open jobs on its first request. Workflow names are unique per account, so CI names it `<worker>-jobs` (`scripts/ci.mjs`). The jobs get `services` (WP-3.5b): the env (for the AI setup), the Sources R2 bucket, and `@seply/views/inspect`'s `readView` as the curator's `ViewReader` (the only `@seply/views` import this Worker makes).
- **Cron** (WP-5.2): `scheduled` purges Expeditions whose 30 days in Trash are over (`@seply/server`'s `purgeTrash`, Source files from `SOURCES` included), daily at 04:17 UTC (`triggers.crons` in `wrangler.jsonc`). Only production runs it: `scripts/ci.mjs hyperdrive-upsert` drops the trigger for previews (`seply-pr-*`), which would each take one of the account's cron triggers. Locally, `wrangler dev` runs it on `curl http://localhost:8787/cdn-cgi/local/scheduled`.
- **`SOURCES`:** the R2 bucket for Source files and segments (spec §2.7), passed to the app as `blobs` (`r2BlobStore`). `wrangler.jsonc` names `seply-sources`; CI points previews at `seply-sources-preview` (`scripts/ci.mjs r2-bucket`, which also creates a missing bucket). `wrangler dev` simulates it locally.
- **Env:** vars `DB_BRANCH`, `BETTER_AUTH_URL`, `AUTH_PROXY_URL`, `AUTH_TRUSTED_ORIGINS` (set by CI with `--var`), and secrets `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (web push) and `RESEND_API_KEY` (invite email, WP-5.1) (uploaded by CI with `--secrets-file`). `EMAIL_FROM` (the invite sender) is a var: CI passes the repo variable with `--var` when it is set; the server's default is `Seply Learn <invites@mail.seply.app>`. `JOBS_WAKE_ON_START` for local dev only. Locally, `.dev.vars` (copy `.dev.vars.example`; gitignored).
- **AI env** (WP-3.3; the server README's "AI" section has the full list):
  - `AI_GATEWAY_API_KEY` (secret): the hosted instance key. CI uploads it from the repo secret of the same name.
  - `AI_KEYS_MASTER_KEY` (secret): 32 random bytes, base64 (`openssl rand -base64 32`). Readers' own keys are AES-GCM encrypted under it in bring-your-own-key mode. CI uploads it when the repo secret exists; the hosted instance doesn't need it while it runs in instance-key mode.
  - `AI_KEY_MODE` (var): `instance` (default) or `byok`. Unset on previews and production. The e2e Worker runs `byok` with a test-only master key (`apps/web/playwright.config.ts`).
- **Scripts:** `dev` (`wrangler dev`), `bundle` (a dry-run deploy that needs no account), `typecheck` (which runs `wrangler types` first), `test` and `lint`.
- **`scripts/ci.mjs`:** the deploy helpers the Deploy workflow uses (Hyperdrive, Neon branch and Worker lifecycle including its Workflow, the Sources R2 bucket, Worker URLs, the secrets file).
- **Tests:** unit tests run in Node with `cloudflare:workers` stubbed (`src/test/`); `src/room.test.ts` drives the room's protocol over a fake Durable Object context (who hears what, leave once, kick, agent TTL, and every call on a fresh instance, as after hibernation). The room and the Workflow run for real in `apps/web/e2e/api/jobs.spec.ts`, which starts its own `wrangler dev` and kills it mid-job, and in `apps/web/e2e/app/live.spec.ts` (presence, cursors and `ops` across a real hibernation).
- **`scripts/check-signin.mjs`:** checks a deployed Worker's Google sign-in redirect (production's callback as `redirect_uri`).

See [docs/ops/deploy.md](../../docs/ops/deploy.md) for previews, production, sign-in and local dev.

## Allowed dependencies

@seply/server, @seply/ai, @seply/domain, and @seply/views only for `@seply/views/inspect` (the curator's ViewReader; spec §2.1). See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
