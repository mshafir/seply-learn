# @umbel/server

**Lane:** B: Server & infra

## Contract

The Hono app factory: Better Auth, /api (push/pull, per-reader state, Proposals, search, export/import, keys, uploads), /mcp, and the Relay, JobRunner and Mailer interfaces. Runtime-agnostic (Workers and Node). Spec: docs/spec/v1/02-architecture.md, 06-mcp.md.

Today (WP-1.1):

| Export | What it is |
|---|---|
| `createApp({ connect })` | The Hono app. Runtimes mount it at `/api` and pass `connect(env)`, which returns a `DbConnection` (or `null` when there is no database). The app connects at most once per request, lazily, and closes after the response (`waitUntil` on Workers). Nothing is held across requests. |
| `connectPg(connectionString)` | One `pg` client wrapped in Drizzle over the domain schema. The Worker passes `env.HYPERDRIVE.connectionString`. |
| `createAuth(config, db)` | Better Auth, built per request with the Drizzle adapter over the `users`/`sessions`/`accounts`/`verifications` tables from `@umbel/domain`. Google when its credentials are set; the OAuth proxy plugin when `AUTH_PROXY_URL` is set; email + password only for tests (below). |
| `readConfig(env)`, `ServerEnv` | The env vars below, validated. Missing `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET` gives a 503 on routes that need auth. |
| `requireUser()` | Middleware: 401 without a session; sets `c.var.user`. |

**Routes** (under `/api`):

- `GET /health`: `{ ok, db, branch }`. `db` is `select current_database()`, `"unconfigured"` with no database, `"error"` (503) when it fails.
- `/auth/*`: Better Auth (sign-in, callbacks including `/auth/callback/google/oauth-proxy`, session, sign-out).
- `GET /me`: `{ user: { id, email, name } }`, or 401.
- `POST /expeditions` `{ title? }`: creates a private draft Expedition; the creator becomes its owner Collaborator (one transaction). 201 with an `ExpeditionSummary` (`id`, `title`, `summary`, `visibility`, `status`, `role`).
- `GET /expeditions`: `{ expeditions: ExpeditionSummary[] }`, every Expedition I collaborate on, not in Trash, newest first.

**Env** (`ServerEnv`): `BETTER_AUTH_URL` (this deploy's origin), `BETTER_AUTH_SECRET` (the same on every deploy), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_PROXY_URL` (production's origin, on previews and production), `AUTH_TRUSTED_ORIGINS` (comma-separated, `*` allowed), `AUTH_TEST_CREDENTIALS`, `DB_BRANCH`. See [docs/ops/deploy.md](../../docs/ops/deploy.md#sign-in-better-auth).

**Test credentials:** email + password sign-in is on only when `AUTH_TEST_CREDENTIALS=1` **and** `BETTER_AUTH_URL` is a localhost URL, so a deployed Worker can never enable it.

**Migrations:** `drizzle.config.ts` generates SQL migrations from `@umbel/domain`'s schema into `drizzle/` (committed). `db:generate` after a schema change; `db:migrate` (`scripts/migrate.mjs`) applies them to `$DATABASE_URL` and is what CI runs before each deploy.

**Tests** run the app over in-memory PGlite with the committed migrations applied (`src/test-harness.ts`), including the OAuth proxy round trip between a preview and production app with Google's token endpoint stubbed.

## Allowed dependencies

@umbel/domain, @umbel/ai. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
