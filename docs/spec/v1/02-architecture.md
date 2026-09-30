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

pnpm + Turborepo, TypeScript throughout. Tools come from mise: Node LTS and pnpm. Wrangler, Turbo and drizzle-kit are dev dependencies, and Docker is used only to build the self-host image. Dependencies run one way: `domain ← sync ← views/ui ← web`, and `domain ← server/ai`.

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
  published(exp, batch); build(exp, evt); kick(exp, user);
  agentPresence(exp, {userId, label, ttl}); handleUpgrade(req)
}
```

- **Cloudflare:** a hand-written **hibernating Durable Object** (`ctx.acceptWebSocket`). Presence lives in socket attachments (≤16 KB), and it never touches Postgres. Outgoing messages are free.
- **Node:** in-process rooms (`@hono/node-server` + `ws`). **Postgres LISTEN/NOTIFY** handles multi-instance fan-out: `exp_ops` fires on commit, and `exp_live` carries presence and build events, with payloads under 8 KB and a dedicated direct connection.
- **Protocol** (JSON `{t, …}`):
  - `hello {headSeq, presence[], builds[]}`
  - `ops {from, to, ops[]}`, or `poke {headSeq}` for large batches and gaps
  - `presence {view, cursor, selection[], editing?}`, at ~10–20 Hz, throttled by the client, and `leave`
  - `build {viewId, status, step, progress, previewNodes?}`
  - `kick {reason}`
- **Who connects:** signed-in collaborators connect with presence. Signed-in viewers connect read-only. **Anonymous readers of a public or unlisted link subscribe to `ops` but send no presence** *(assumed; the research proposed it)*.
- **Agents via MCP** appear as a participant. The MCP handler calls `agentPresence` on each tool call, with a TTL.
- **Client:** `partysocket` for reconnect with backoff.

## 2.5 Jobs: builds and long AI work

- **The interface:** `JobRunner` (start, step, retry, cancel, progress → Relay).
  - **Cloudflare:** **Workflows**, with persisted, retried steps. One step runs the curator agent until its next View commit, so each committed View is a checkpoint and a restart resumes from the last one.
  - **Node:** **pg-boss** in Postgres, with an in-process worker.
- The step functions (the curator agent loop, the skim, writers) live in `packages/ai` and are shared by both.
- Build progress and preview nodes go to the room as `build` events. The View's status and failure reason are logged fields.
- **Notifications:** live status on Library cards, an activity indicator in the header, and **web push** if the reader allowed it (asked on the first "Leave it building"). Build notifications don't use email in v1.
- **Email (invites only):** a `Mailer` interface. Hosted: a transactional provider (Resend assumed; Cloudflare's email service if it fits better). Self-host: optional SMTP via env vars. Without one, invites use the link and in-app inbox only ([Invites and email](../../wayfinder/mindmaps-v1/tickets/26-invites-and-email.md)).

## 2.6 Auth, keys and tokens

- **Better Auth ≥ 1.7** with the Drizzle adapter, built per request.
  - **Hosted:** Google login by default.
  - **Self-host:** email + password by default, Google optional.
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
- **Map tiles:** our own **Protomaps PMTiles** copy (R2 when hosted, volume/S3 when self-hosted), with OpenFreeMap as a configurable fallback. The build picks the max zoom and **measures the extract size**; the figures quoted during planning were unverified. A coarse world layer is bundled.

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
- **Self-host:** release tags publish the Node image. `docker compose` runs the app and Postgres, with an optional S3 bucket. Configuration is env vars only.
- **Desktop:** none in v1. Electron (local-first, SQLite, offline op queue) is phase 2.
