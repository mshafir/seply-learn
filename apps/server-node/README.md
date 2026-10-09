# @seply/server-node

**Lane:** B: Server & infra

## Contract

The self-host entry (spec §2.2, §2.10; WP-6.1): one Node process serving the SPA, the API, `/mcp` and `/.well-known/*`, with in-process rooms shared across instances through Postgres LISTEN/NOTIFY, a pg-boss JobRunner, blobs on a volume or in S3, an optional SMTP Mailer and email + password sign-in. Configuration is env vars only. It composes `@seply/server` exactly as the Worker does; nothing here duplicates the app.

- **HTTP** (`src/server.ts`, `@hono/node-server`): `createApp(options)` at `/api`, `createRootRoutes(options)` at `/` (`/mcp`, `/.well-known/*`), `MAP_TILES_FILE` at `/tiles/basemap.pmtiles` with Range requests (`serveRangeFile`; PMTiles reads byte ranges; WP-6.2), and the built SPA (`WEB_DIST`, `src/static.ts`) for every other `GET`/`HEAD`, with `index.html` for client-side routes (the Worker's `single-page-application` fallback). `/assets/*` is cached for a year (hashed); everything else is `no-cache`. The options: `connect` checks a client out of one `pg` Pool per request (`src/db.ts`), `views: { read: readView }` (`@seply/views/inspect`), and `cimdFetch` from `@better-auth/cimd/node` (resolves the host once, refuses private addresses and redirects).
- **Rooms** (`src/live.ts`): one in-process room per Expedition with sockets on this instance, running `@seply/server`'s `Room` (the Durable Object's code) over `ws` sockets and memory. The live route checks access, then `Relay.handleUpgrade` upgrades the socket the request came on (the HTTP server keeps it in a `WeakMap` by `Request`). Postgres LISTEN/NOTIFY on a dedicated connection shares events between instances: `exp_ops` (`ops`, `poke`) and `exp_live` (`build`, `kick`, agents, collaborators' presence and `leave`, and `sync` from a new instance). Each instance applies its own events at once and ignores their echo. Payloads stay under 7.5 KB: an `ops` batch too large becomes a `poke` for the other instances, a build event drops its `previewNodes`. Collaborators on other instances show as timed participants (re-announced every 15 s, gone after 45 s without news; a stopping instance sends their `leave`). A room this instance opens reads the Expedition's open jobs, so `hello` lists running builds after a restart. After the listener reconnects, every open room is poked at its head so clients catch up. Sockets are pinged every 30 s.
- **Jobs** (`src/jobs.ts`): `createPgBossEngine`, a `JobEngine` over pg-boss (schema `pgboss`, queue `seply-jobs`): one pg-boss job per attempt (its id a UUID derived from `<jobId>-<attempt>`, so a launch is idempotent), run by `runJob` with steps recorded in `job_steps` (Workflows' semantics: retried with exponential backoff, a timeout per try, and a replay returns recorded results). pg-boss heartbeats each running attempt (`JOBS_HEARTBEAT_SECONDS`), so when an instance dies, another one or the same restarted picks the attempt up and replays it from its last recorded step (`jobs: resuming <id> after N recorded steps`). Cancel marks the row `cancelled`; the attempt stops at its next step boundary and stops waiting for a step in flight within a second (the step's late result is never recorded), on whichever instance runs it. After 20 restarts an attempt is marked failed ("The job stopped unexpectedly"). Every kind in `JOB_KINDS` runs (build, article, grow, the test-only fake), with `services` `{ env, blobs, views }` as on the Worker; the skim runs inside its request, as on the Worker.
- **Trash** (WP-5.2): a pg-boss schedule (`TRASH_PURGE_CRON`, UTC; one instance runs each occurrence) calls `purgeTrash` with the blob store.
- **Blobs** (`src/blobs.ts`): `fsBlobStore(dir)` (files under `BLOB_DIR`, each with a `.content-type` beside it, written through a temp file, keys never leave the directory) or `s3BlobStore(opts)` (SigV4 with `aws4fetch`; path-style for MinIO and most S3-compatible stores, virtual-hosted with `S3_FORCE_PATH_STYLE=0`).
- **Mail** (`src/mailer.ts`): `mailerFor(readConfig(env).mail)`: SMTP (`smtpMailer`, nodemailer) with `SMTP_HOST`, Resend with `RESEND_API_KEY`, else a log-only Mailer (invites still work through the link and the inbox).
- **Config** (`src/env.ts`): `readNodeConfig(process.env)` validates everything at startup (the app's own `readConfig` and `readAiConfig` included) and throws one `ConfigError` listing every problem; `main.ts` prints it and exits 78.
- **Migrations** (`src/migrate.ts`): `@seply/server`'s committed `drizzle/` folder under a Postgres advisory lock, so instances starting together take turns. On start unless `MIGRATE_ON_START=0`, or `migrate`.
- **Shutdown:** on SIGTERM or SIGINT it stops taking requests and jobs, NOTIFYs its collaborators' `leave`, closes sockets with 1001 (clients reconnect, to another instance behind a load balancer), gives running jobs `SHUTDOWN_GRACE_SECONDS` (a job still running then is picked up again later from its last step), and closes the pool. A second signal exits at once.

Also here: `scripts/real-build.ts` (WP-3.5b), which runs a real `build` job on a committed public fixture (`research-doc`, `ebike-chat`) against Postgres on the in-process engine, with the instance key from `apps/worker/.dev.vars`, and writes the resulting Expedition (our JSON) and a summary (Views, counts, `view.inspect` results, gateway-billed cost, time) to `packages/ai/fixtures/builds/`. It spends real money, so it is never part of `pnpm test`. `--crash-at-view n` simulates a runtime restart as View n starts (then wakes the job); `--kill-at-view n` exits the process there, and `--resume <jobId>` Retries it. Usage is at the top of the script. `scripts/real-grow.ts` (WP-4.4) runs one real Grow ask the same way and writes to `packages/ai/fixtures/grow/`.

## Running it

Node 24 (`mise.toml`; 22.12+ works) runs the TypeScript sources directly (`--experimental-transform-types`). The Docker image runs a bundle instead (below).

```sh
pnpm install --frozen-lockfile
pnpm --filter web build                      # the SPA, apps/web/dist
DATABASE_URL=postgres://… pnpm --filter @seply/server-node migrate   # optional: start migrates too
DATABASE_URL=postgres://… BETTER_AUTH_URL=http://localhost:3000 \
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) pnpm --filter @seply/server-node start
```

`start` is `node --experimental-transform-types --disable-warning=ExperimentalWarning src/main.ts` (`serve` is the default command; `migrate` applies migrations and exits). Several instances may share one database: put them behind one origin (`BETTER_AUTH_URL`); WebSockets need no sticky sessions.

### The Docker image (WP-6.2)

The root `Dockerfile` builds the SPA and `pnpm --filter @seply/server-node bundle` (`scripts/bundle.ts`: esbuild, every dependency inside, one ES module `dist/main.mjs` of about 14 MB), then copies only that, `@seply/server`'s `drizzle/` and `apps/web/dist` onto `node:24-alpine`: no `node_modules`, no TypeScript. Paths the sources find through `import.meta.url` are set by the image instead (`WEB_DIST=/app/web`, `MIGRATIONS_DIR=/app/drizzle`), with `BLOB_DIR=/data/blobs` on the `/data` volume. It runs as `node`, health-checks `/api/health`, and takes `serve` (default) or `migrate` as its command. `docker-compose.yml`, `.env.example` and [docs/self-host.md](../../docs/self-host.md) are the self-host guide; `scripts/compose-smoke.sh` (CI's Image workflow) proves the image end to end.

## Environment

Everything is an env var. Unknown variables are ignored; a bad value stops the server with a list of what's wrong.

### The server

| Variable | Default | What it is |
| --- | --- | --- |
| `DATABASE_URL` | required | `postgres://user:pass@host:5432/db`. A direct connection (LISTEN/NOTIFY and pg-boss need one; not PgBouncer in transaction mode). Postgres 16 or 17 (both tested) with the `pg_trgm` extension available (a migration creates it, so the user needs that right; the official image has it). |
| `DATABASE_POOL_MAX` | `10` | The app's pool per instance (pg-boss keeps 4 more, and the listener 1). |
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | |
| `WEB_DIST` | `apps/web/dist` | The built SPA. `off` serves the API only. |
| `MAP_TILES_FILE` | | A PMTiles extract on a volume for the Map View, served at `/tiles/basemap.pmtiles`; `MAP_TILES_URL` defaults to that path. It must exist. See [docs/self-host.md](../../docs/self-host.md#map-tiles). |
| `MIGRATE_ON_START` | `1` | `0` when you run `migrate` yourself. `MIGRATIONS_DIR` overrides where they are (default: `@seply/server`'s `drizzle/`). |
| `BLOB_STORE` | `s3` if `S3_BUCKET` is set, else `fs` | Where Source files and segments go. |
| `BLOB_DIR` | `./data/blobs` | `fs`: a directory on a volume. |
| `S3_BUCKET` | | `s3`: the bucket (it must exist). |
| `S3_ENDPOINT` | `https://s3.<region>.amazonaws.com` | e.g. `http://minio:9000`. |
| `S3_REGION` | `us-east-1` | |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required for `s3` | |
| `S3_FORCE_PATH_STYLE` | `1` | `<endpoint>/<bucket>/<key>`; `0` for `<bucket>.<endpoint host>`. |
| `JOBS_CONCURRENCY` | `4` | Jobs one instance runs at once (they wait on models, not CPU). |
| `JOBS_HEARTBEAT_SECONDS` | `30` | 10 or more. A job whose instance is silent this long is picked up again. |
| `TRASH_PURGE_CRON` | `17 4 * * *` | When Trash is purged (UTC, 5 fields), or `off`. |
| `SHUTDOWN_GRACE_SECONDS` | `25` | How long shutdown waits for running jobs. |

### The app (`@seply/server`'s `ServerEnv`; the same as on the Worker)

| Variable | Default | What it is |
| --- | --- | --- |
| `BETTER_AUTH_URL` | required | This instance's public origin, e.g. `https://learn.example.com` (OAuth callbacks, invite links, the MCP resource). |
| `BETTER_AUTH_SECRET` | required | At least 32 characters (`openssl rand -base64 32`). Keep it stable: sessions and the MCP signing keys depend on it. |
| `AUTH_EMAIL_PASSWORD` | `1` (on Node) | Email + password sign-in. `0` with Google configured for Google only. |
| `AUTH_EMAIL_SIGNUP` | open | `0` closes sign-up: existing accounts still sign in. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Google sign-in (redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`). |
| `AUTH_TRUSTED_ORIGINS` | | Extra trusted origins, comma-separated. |
| `AI_KEY_MODE` | `instance` | `instance` (the operator's key serves everyone) or `byok` (each reader adds their own). |
| `AI_GATEWAY_API_KEY` | | The instance key: a Vercel AI Gateway key, or one of the next. First found wins. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | | A direct provider key as the instance key. |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` | | An OpenAI-compatible endpoint (Ollama, LM Studio…) as the instance key. |
| `AI_MODEL_SKIM`, `AI_MODEL_CURATOR`, `AI_MODEL_WRITER` | the provider's defaults | Instance mode: the model per stage. |
| `AI_KEYS_MASTER_KEY` | required for `byok` | 32 random bytes, base64. Readers' keys are encrypted under it; changing it makes them unreadable. |
| `SMTP_HOST` | | Invite emails through SMTP. Without it (and without `RESEND_API_KEY`) invites are only logged; the link and the inbox still work. |
| `SMTP_PORT` | `587` (`465` with `SMTP_SECURE=1`) | |
| `SMTP_SECURE` | `0` | `1`: TLS from the start. Otherwise STARTTLS when the server offers it. |
| `SMTP_USER`, `SMTP_PASS` | | |
| `EMAIL_FROM` | required with SMTP | e.g. `Seply Learn <learn@example.com>`. |
| `RESEND_API_KEY` | | Resend instead of SMTP. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | | Web push for finished builds (off without the keys). |
| `MAP_TILES_URL` | `/tiles/basemap.pmtiles` with `MAP_TILES_FILE` | The Map View's PMTiles archive: a URL (it must allow Range requests and CORS) or a path on this origin. Unset: OpenFreeMap's styles. Served by `GET /api/map-config`. |
| `MAP_ASSETS_URL` | Protomaps' | A copy of Protomaps' fonts and sprites ([basemaps-assets](https://github.com/protomaps/basemaps-assets)). |
| `DB_BRANCH` | | A label `/api/health` reports. |
| `AUTH_TEST_CREDENTIALS` | | Tests only; honoured only on a localhost `BETTER_AUTH_URL`. |

## Tests

`pnpm --filter @seply/server-node test`. Without `TEST_DATABASE_URL` the database tests skip; with it (any Postgres the tests may create databases on; each file makes its own, `<db>_jobs`, `<db>_instances`) they run:

- `env.test.ts`: defaults, every problem listed at once, bad values, the web build, a way to sign in, BYOK's master key, S3 selection and its keys, SMTP passed through, `MAP_TILES_FILE` (served here unless `MAP_TILES_URL` says otherwise; it must exist).
- `blobs.test.ts`: one contract for every store (bytes and text with their content type, replace, delete, missing keys) on a volume (and that keys never leave it) and on S3: against a fake that checks SigV4 and the payload hash, path-style and virtual-hosted addressing, refusals; and against a real S3-compatible server when `S3_TEST_ENDPOINT` is set (CI runs moto's; MinIO works the same).
- `static.test.ts`: `serveRangeFile` (the PMTiles archive): the whole file, `bytes=a-b`, `a-` and `-n` as 206, HEAD, 416 past the end, 404 without the file.
- `mailer.test.ts`: an invite through a fake SMTP server (AUTH PLAIN, sender, recipient, the encoded subject, the link), an unreachable server as a `MailError`, and `mailerFor`'s choice (the log-only one never logs a body).
- `jobs.test.ts` (database): a job run to the end with each step recorded once, a retried step, progress to the room; cancel stopping at the next step; Retry as attempt 2 from the first step; an instance dying mid-job (its pg-boss stopped without grace, its run halted) while a second instance picks the attempt up and finishes it with every Change logged once.
- `instances.test.ts` (database; WP-6.1's "done when"): two server-node processes on one database. An edit pushed to one reaches a WebSocket client of the other as `ops`, both ways; a batch too large for NOTIFY arrives as a `poke`; collaborators on different instances see each other's presence, a newcomer's `hello` lists the other instance's collaborator, and closing a socket sends `leave` across; a job's progress on one reaches the room on the other.

The e2e suite runs against this entry with `E2E_SERVER=node` (`apps/web` README; CI's `e2e-node` job).

## Allowed dependencies

@seply/server, @seply/ai, @seply/domain, and @seply/views only for `@seply/views/inspect` (the curator's ViewReader; spec §2.1). See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
