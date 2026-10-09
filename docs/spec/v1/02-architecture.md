# 2. Architecture and deployment

Decided in:
- [Backend runtime for Cloudflare and self-hosting](../../wayfinder/mindmaps-v1/tickets/04-backend-runtime-cloudflare-and-selfhost.md)
- [Local-first sync for Electron and Postgres](../../wayfinder/mindmaps-v1/tickets/05-local-first-sync-engine.md)
- [Client sync layer and live relay](../../wayfinder/mindmaps-v1/tickets/20-client-sync-layer-and-live-relay.md)
- [Deployment topology and monorepo layout](../../wayfinder/mindmaps-v1/tickets/09-deployment-topology-and-monorepo.md)
- [Remote MCP server, auth, and skills](../../wayfinder/mindmaps-v1/tickets/07-remote-mcp-and-skills.md)
- [Search](../../wayfinder/mindmaps-v1/tickets/22-search.md)
- [Map basemap](../../wayfinder/mindmaps-v1/tickets/21-map-basemap-for-hosted-and-self-hosted.md)

## 2.1 Monorepo

pnpm + Turborepo, TypeScript throughout. Tools come from mise: Node LTS and pnpm. Wrangler, Turbo and drizzle-kit are dev dependencies, and Docker is used only to build the self-host image. Dependencies run one way: `domain ← sync ← views/ui ← web`, and `domain ← server/ai`. Apps compose packages. The apps that run the curator job (`worker`, `server-node`) may also take `views`, only for `@seply/views/inspect`: the pure, React-free reading of a View (as text) and its layout metrics, which they hand to `ai`'s `ViewReader` port for `view.inspect` ([AI §5.3](05-ai.md#53-tools-and-checks)). `ai` itself never imports `views`.

```
apps/
  web          Vite SPA (routes, screens), installable PWA
  worker       Cloudflare entry: Worker + Expedition Durable Object + build Workflow
  server-node  Node entry: Hono + in-process rooms + pg-boss worker (self-host image)
packages/
  domain   Drizzle schema, op kinds, pure apply(), View Type Zod schemas (shared + personal), permissions
  sync     op engine, push/pull client, TanStack DB collections, Relay client (partysocket)
  server   Hono app factory: Better Auth, /api, /mcp, Relay + JobRunner interfaces, search queries
  ai       curator agent, tools, checks, skim, writers, playbook, BYOK providers
  views    React Flow canvas, View renderers, layouts (ELK etc.), layout metrics
  ui       shadcn + Base UI components, tokens, brand (from `shadcn init -t vite --monorepo`)
  config   tsconfig, eslint, Tailwind preset
```

## 2.2 Backend: one Hono app, two entrypoints

- **The same app factory** (`packages/server`) runs as:
  - a **Cloudflare Worker** (static assets serve the SPA; Hyperdrive → `pg` → Drizzle, with clients created per request);
  - a **Node container** (serves the same app plus the SPA `dist/`; `pg` Pool).
- **Routes:**
  - `/api/*`: push/pull, per-reader state, Proposals review, search, export/import, keys, uploads
  - `/api/expeditions/:id/live`: WebSocket upgrade into the room
  - `/mcp`: stateless streamable HTTP
  - Better Auth's routes
- **Budget:** Cloudflare Workers Paid ($5/month), because the free plan's 10 ms CPU limit is too tight. Hyperdrive has no LISTEN/NOTIFY or advisory locks, which is why the relay on CF is a Durable Object. The fallback is the same Node image on Cloudflare Containers or a VPS.

## 2.3 Sync: op log, push/pull, client store

- **Push** (HTTP):
  - The client sends pending ops as a batch with `change_id`.
  - The server checks the role on the Expedition, validates each op with `packages/domain` Zod, assigns `server_seq`, and appends to `ops` while applying to the tables, all in **one transaction**. Ops are idempotent by `op_id`.
  - It then calls `Relay.published`.
- **Pull:** `?since=seq` returns ops. Clients rebase their pending ops on top (last writer wins per field or path).
- **Client store (`packages/sync`):**
  - Our **op engine** is the store of record. It holds confirmed ops and pending ops (in memory, mirrored to IndexedDB so a reload doesn't lose them), rebase, undo per Change, "view as of", and Proposal preview (applying a Proposal's ops virtually for the dashed overlay).
  - **TanStack DB** (0.9, MIT, pre-1.0) sits on top as the live query layer: one collection per table, fed by row diffs through its custom `sync`. UI edits become ops in `mutationFn`, with row types from `drizzle-zod`. Its own persistence and offline outbox are **not used**.
  - **First build task:** prototype that TanStack DB's optimistic layer doesn't flicker when the op engine emits its diff before `mutationFn` resolves.
- **Web is online-first.** Reading works offline (§2.9). Editing needs a connection.

## 2.4 Live relay (v1)

One WebSocket room per Expedition, behind one interface:

```ts
Relay {
  published(exp, batch); build(exp, evt); kick(exp, user | null, reason);
  agentPresence(exp, {userId, label, ttlMs}); handleUpgrade(req, join)
}
```

- **Cloudflare:** a hand-written **hibernating Durable Object** (`ctx.acceptWebSocket`). Presence lives in socket attachments (≤16 KB), and it never touches Postgres. Outgoing messages are free.
- **Node:** in-process rooms (`@hono/node-server` + `ws`). **Postgres LISTEN/NOTIFY** handles multi-instance fan-out: `exp_ops` fires on commit, and `exp_live` carries presence and build events, with payloads under 8 KB and a dedicated direct connection.
  - *As built (WP-6.1):* both runtimes run one room implementation, `@seply/server`'s `Room`, over a host of sockets (tags and an attachment each) and key-value storage with one alarm: the Durable Object's hibernatable sockets and storage on Cloudflare, `ws` sockets and memory on Node. Each Node instance applies its own events at once and NOTIFYs the rest; `exp_ops` carries `ops` and `poke` after a commit, `exp_live` carries builds, kicks, agents' presence and collaborators' presence and leave. `ops` too large for one NOTIFY reach the other instances as a `poke`, and a build event drops its `previewNodes`. Collaborators connected to another instance show as timed participants: each instance re-announces its own every 15 s and they leave after 45 s without news (a stopped instance sends their `leave` at once). A room Node opens reads the Expedition's open jobs from `jobs`, so `hello` lists running builds after a restart. After the listener reconnects, every open room is poked at its head.
- **Protocol** (JSON `{t, …}`; the schemas are `@seply/domain`'s `room.ts`):
  - `hello {headSeq, presence[], builds[], you?}`: `presence` is everyone else here, as participants `{id, userId, name, agent?, view, cursor, selection[], editing?}` (one per connection, so a reader with two tabs is two); `you` is this connection's participant id, given only to those who may send presence
  - `ops {from, to, ops[]}`, or `poke {headSeq}` for large batches (over 64 KB of JSON) and gaps. `from` is the head the ops follow (exclusive): a client at `from` or later applies them, one further behind pulls
  - `presence {view, cursor, selection[], editing?}`, at ~10–20 Hz (15), throttled by the client, and `leave`; the room fans them out with the sender's `id`, `userId` and `name`, and sends `leave {id}` when a connection leaves or closes. A `cursor` is `{x, y, on?: {id, x, y}}`: fractions of the canvas pane and, over a Concept, of that Concept's box, so it lands on the same Concept in another reader's window
  - `build {jobId, kind, viewId?, status, step, progress, previewNodes?, reason?, at}`: with `viewId` about that View (its status), without it about the whole job (queued, running, paused, complete, failed, cancelled)
  - `kick {reason}`, then the room closes the connection; the client doesn't reconnect until the Expedition is opened again (which checks access). `kick(exp, null)` kicks every connection that isn't a collaborator's (a Visibility change)
- **Who connects:** signed-in collaborators (owner, editors, viewers) connect with presence and hear each other's. Other signed-in readers of a public or unlisted link connect read-only: `ops`, `poke` and `build`, no presence either way, so a link doesn't reveal who is working on it. **Anonymous readers of a public or unlisted link subscribe to `ops` (and `poke`) but send no presence** *(assumed; the research proposed it)*, and hear neither presence nor builds.
- **Agents via MCP** appear as a participant. The MCP handler calls `agentPresence` on each tool call, with a TTL.
- **Client:** `partysocket` for reconnect with backoff.

## 2.5 Jobs: builds and long AI work

- **The interface:** `JobRunner` (start, step, retry, cancel, progress → Relay).
  - **Cloudflare:** **Workflows**, with persisted, retried steps. One step runs the curator agent until its next View commit, so each committed View is a checkpoint and a restart resumes from the last one.
  - **Node:** **pg-boss** in Postgres, with an in-process worker. *As built (WP-6.1):* one pg-boss job per attempt, with Workflows' step semantics: each step's JSON result is recorded in `job_steps` (job, attempt, name), retried with backoff, and a replay of the attempt returns recorded results. pg-boss heartbeats each running attempt, so when an instance dies another one (or the same, restarted) picks the attempt up and replays it from its last recorded step. Cancel marks the row `cancelled`; the attempt stops at its next step boundary, and stops waiting for a step in flight within a second, wherever it runs. A daily pg-boss schedule (one instance runs it) purges Trash.
- The step functions (the curator agent loop, the skim, writers) live in `packages/ai` and are shared by both.
- Build progress and preview nodes go to the room as `build` events. The View's status and failure reason are logged fields.
- **Checkpoints and commits:** a job commits through a pair of steps (make the ops, then append them as one Change with origin `build`); op ids are fixed in the first, so a retried or replayed commit is never logged twice. A job's row (`jobs`) holds its status, step, progress, failure reason and attempt; Retry starts the next attempt from the first step, and the job resumes from its logged state (Views already ready are kept).
- **The spending cap:** a step that throws `SpendingCapReached` (spec §5.5) is not retried: the attempt ends `paused`. **Continue** (`POST /jobs/:id/continue`) starts the next attempt with the job's `cap_raises` one higher (the job's meter calls `raise()` that many times); **Stop** is Cancel. Views left queued by a cancelled or stopped job stay queued in the log, and the app shows them as "Not built", with Retry and Remove (§3.5).
- **Local dev:** `wrangler dev` does not resume a running Workflow after a restart (production does), so with `JOBS_WAKE_ON_START=1` the Worker wakes open jobs on its first request.
- **Notifications:** live status on Library cards, an activity indicator in the header, and **web push** if the reader allowed it (asked on the first "Leave it building"). Build notifications don't use email in v1.
- **Email (invites only):** a `Mailer` interface. Hosted: a transactional provider (Resend assumed; Cloudflare's email service if it fits better). Self-host: optional SMTP via env vars. *As built (WP-6.1):* `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM`; without them the Node entry only logs that an invite would go out. Without one, invites use the link and in-app inbox only ([Invites and email](../../wayfinder/mindmaps-v1/tickets/26-invites-and-email.md)).

## 2.6 Auth, keys and tokens

- **Better Auth ≥ 1.7** with the Drizzle adapter, built per request.
  - **Hosted:** Google login by default.
  - **Self-host:** email + password by default, Google optional. *As built (WP-6.1):* `AUTH_EMAIL_PASSWORD=1` (the Node entry's default) turns it on, `AUTH_EMAIL_SIGNUP=0` closes sign-up, and `GET /api/sign-in-options` tells the sign-in screen which to show. Accounts made this way have unverified emails, so pending email invites aren't claimed automatically; the invite link still works.
- **MCP OAuth:** Better Auth is the OAuth 2.1 authorization server (`@better-auth/mcp` + CIMD; dynamic client registration opt-in only). Personal API tokens (`@better-auth/api-key`) are the fallback on the same Bearer header. Scopes are coarse (`expeditions:read`, `expeditions:create`, `proposals:write`), and the Collaborator role is checked on every call.
- **AI key mode** is an instance setting in env config (`AI_KEY_MODE`: `instance`, the default, or `byok`):
  - **instance key:** the operator's keys serve everyone; usage caps are phase 2.
  - **bring your own key:** each reader adds their own.
- **BYOK storage:** AES-GCM encrypted in `ai_keys` under an **instance master key** (`AI_KEYS_MASTER_KEY`: a CF secret or env var, 32 bytes base64), decrypted only inside the request or job that uses it, and never returned to the browser, which shows the provider, the last 4 characters and a Test button. One key per provider per user. Each ciphertext is bound to its user and provider (AES-GCM additional data).
- **Instance key:** `AI_GATEWAY_API_KEY` on the hosted instance; self-hosts may set a direct provider key or an OpenAI-compatible endpoint instead (see the server README).

## 2.7 Storage

- **Postgres:** Neon via Hyperdrive when hosted; docker-compose Postgres when self-hosted. Migrations with drizzle-kit.
- **Blobs** hold raw Source files, segmented Source text and exports:
  - **R2** when hosted;
  - a local volume or any S3-compatible bucket when self-hosted.

  Files are capped at 25 MB each.
- **Map tiles:** our own **Protomaps PMTiles** copy (R2 when hosted, volume/S3 when self-hosted), with OpenFreeMap as a configurable fallback. The build picks the max zoom and **measures the extract size**; the figures quoted during planning were unverified. A coarse world layer is bundled. *As built (WP-6.2):* the tiles URL is read at runtime too: `GET /api/map-config` answers `MAP_TILES_URL` and `MAP_ASSETS_URL`, which the web app prefers over its build's `VITE_MAP_*`, so the published image needs no rebuild. The Node entry serves `MAP_TILES_FILE` (an extract on the volume) at `/tiles/basemap.pmtiles` with Range requests; an extract in S3 is reached through its own public URL (`MAP_TILES_URL`).

## 2.8 Search

- **Postgres full-text:**
  - Weighted `tsvector` with GIN indexes. Concepts: title and aliases A, summary B, overview C, article sections D. Expeditions: title A, summary B.
  - `websearch_to_tsquery`, plus `pg_trgm` for fuzzy titles.
- **Global search:**
  - Default scope: Expeditions you own or collaborate on, with an "Include public Expeditions" toggle.
  - Results are grouped by Expedition, Concept and Tag, and `#tag` filters by Tag.
  - Access is enforced in the query.
- **Inside an Expedition:** client-side over the loaded data, which also works offline.
- Semantic search is phase 2.

## 2.9 PWA and offline reading

- **The service worker** caches the app shell, the self-hosted fonts, and map tiles already viewed.
- **IndexedDB** keeps the **last ~10 opened Expeditions**, plus any marked "Keep available offline". It stores the state as of the last visit (overviews and articles included, Source files not).
- Opening one offline shows it **read-only**, with an "offline, as of …" chip. There are no offline edits in v1.

## 2.10 Deployment

- **Hosted:** GitHub Actions runs typecheck and tests, applies Drizzle migrations to Neon, then deploys with Wrangler.
  - Each pull request gets a **preview Worker and its own Neon branch**, so parallel agents never share a database.
  - Cloudflare resources: the Worker (with static assets), a Durable Object class (the room), Workflows, R2 buckets (Sources, tiles), Hyperdrive, and secrets (master key, OAuth, instance AI keys).
- **Self-host:** release tags publish the Node image. `docker compose` runs the app and Postgres, with an optional S3 bucket. Configuration is env vars only. *As built (WP-6.1):* `apps/server-node` validates its env at startup and stops with every problem listed, applies migrations on start (or `migrate`), and shuts down gracefully on SIGTERM. Its README lists every variable. *As built (WP-6.2):* the root `Dockerfile` bundles the Node entry with esbuild into one module and ships it with the migrations and the SPA on `node:24-alpine` (no `node_modules`; about 70 MB compressed), running as a non-root user with a health check. `docker-compose.yml` runs it with Postgres 17, and the `s3` profile adds MinIO (a community build: MinIO no longer publishes images) with a one-shot bucket container. The Image workflow runs a compose smoke test on pull requests and publishes `ghcr.io/mshafir/seply-learn` (amd64 and arm64) on `v*` tags. Guide: [docs/self-host.md](../../self-host.md).
- **Desktop:** none in v1. Electron (local-first, SQLite, offline op queue) is phase 2.
