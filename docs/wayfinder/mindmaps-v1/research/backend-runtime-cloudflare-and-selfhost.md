# Backend runtime: Cloudflare + self-hosting

Research for [ticket 04](../tickets/04-backend-runtime-cloudflare-and-selfhost.md). Checked 2026-09-24.

## TL;DR

**Recommended (A): one Hono app, two entrypoints.** Web-standard TypeScript server (Hono) with a thin `worker.ts` entry (Cloudflare Workers + static assets + Hyperdrive) and a thin `node.ts` entry (Node/Bun container + docker compose Postgres). Both entries use **Drizzle over node-postgres (`pg`)**, **Better Auth** with a per-request factory, the **official MCP SDK's web-standard Streamable HTTP transport**, and **AI SDK `streamText` → `Response`**. Only bindings/config differ.

**Fallback (B): one Node container everywhere.** Run the same Docker image self-hosted and on **Cloudflare Containers** (GA since Apr 2026) behind a small Worker. You get exact parity and no Workers constraints, but you pay for always-on memory (about $33/mo floor for `standard-1`) and lose the edge/isolate model.

## Options compared

| Dimension | A: Hono on Workers + Node | B: Node container everywhere (CF Containers) | C: Workers-native (D1/McpAgent/DO-first) |
|---|---|---|---|
| Same code both targets | Yes, different entry files | Yes, identical image | No, D1/DO/McpAgent have no self-host equivalent |
| Postgres on CF | Hyperdrive → any Postgres (Neon, Supabase, RDS…) | Direct or Hyperdrive | D1 (SQLite), which breaks the Postgres given |
| Better Auth + Google | Works (per-request instance) | Works (plain Node) | Works |
| MCP endpoint | MCP SDK web-standard transport, stateless | Same SDK, Node transport | `McpAgent` (a DO per session) |
| AI SDK streaming | Fine: no wall-clock limit while client connected | Fine | Fine |
| Cost on CF (small, personal instance) | Workers Paid $5/mo, Hyperdrive free, Postgres host extra | $5 + about $33/mo always-on `standard-1` (or scale-to-zero with cold starts) | $5 |
| Self-host ops | One Node/Bun container + Postgres | Same | n/a |
| Verdict | **Recommend** | Fallback if Workers limits bite | Reject |

## Key facts (with sources)

**Hyperdrive / Postgres access**
- Hyperdrive recommends **node-postgres (`pg` ≥ 8.16.3)**. postgres.js (≥ 3.4.5) is also supported. Drizzle and Kysely both sit on `pg`. ([CF docs](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/))
- "Create a new client instance for each request." Hyperdrive holds the real pool. A global pool on Workers throws *"Cannot perform I/O on behalf of a different request."* ([CF docs](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/), [OpenNext DB howto](https://opennext.js.org/cloudflare/howtos/db))
- Hyperdrive has **no extra charge**. It is on the Free plan (10 configs, ~20 origin conns) and on Paid (25 configs, ~100 origin conns). Queries are capped at 60 s. ([DEV summary](https://dev.to/kmanoj296/cloudflare-hyperdrive-heres-what-you-need-to-know-50ec), [product page](https://www.cloudflare.com/products/hyperdrive/))
- **Not supported through Hyperdrive:** `LISTEN/NOTIFY`, advisory locks, SQL-level `PREPARE`, session state. Use a direct connection for those. ([CF docs](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/))
- `nodejs_compat` turns on automatically from compatibility date 2026-08-04. Earlier dates need the flag. ([CF docs](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/))
- `@neondatabase/serverless` ties you to Neon. Skip it and use `pg` on both targets, so the self-host path gets the same driver.

**Workers limits**
- CPU: Free 10 ms/request. Paid 30 s default, configurable up to 5 min. **Wall-clock: no limit while the client is connected**, which suits SSE/streaming. Memory is 128 MB per isolate. Bundles are capped at 64 MiB. ([CF limits](https://developers.cloudflare.com/workers/platform/limits/))

**Better Auth**
- Runs on Workers with Hono. Build the auth instance **per request** from env bindings, mount it with `c.req.raw`, and match Hono's mount path to Better Auth's `basePath`. ([Hono example](https://hono.dev/examples/better-auth-on-cloudflare))
- Community kits: [better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare) (Hyperdrive/KV/D1 CLI) and [better-auth-workers](https://github.com/nalinda/better-auth-workers).
- Email/password scrypt (pure JS) takes about 80–100 ms of CPU, which kills Free-plan Workers. Google social login avoids this. If passwords are added later, use Paid or native `node:crypto` scrypt. ([issue #8860](https://github.com/better-auth/better-auth/issues/8860), [#8456](https://github.com/better-auth/better-auth/issues/8456))

**SPA serving**
- Cloudflare: Workers static assets with `not_found_handling: "single-page-application"` and `run_worker_first: ["/api/*", "/mcp*", ...]`. Asset requests don't bill as Worker invocations. ([CF docs](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/))
- Self-host: the same Node server serves `dist/` via Hono `serveStatic` with an index.html fallback, so there's one container. An optional Caddy/nginx can sit in front.

**MCP + AI SDK**
- The MCP TS SDK's `WebStandardStreamableHTTPServerTransport` runs on Node 18+, Workers, Bun and Deno. `@modelcontextprotocol/hono` adds body parsing and DNS-rebinding protection. It's portable, so use it rather than Cloudflare's `McpAgent`. ([SDK docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md), [npm](https://www.npmjs.com/package/@modelcontextprotocol/hono))
- Cloudflare's `createMcpHandler` is stateless Streamable HTTP. `McpAgent` is DO-backed and stateful, so it's CF-only. ([CF Agents docs](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/))
- AI SDK `streamText(...).toUIMessageStreamResponse()` returns a web `Response` that works unchanged in Hono on both targets. BYOK calls are outbound fetches, and the CPU spent waiting on them is ~0.

**Cloudflare Containers**
- GA 2026-04-13 on Workers Paid. Requests route through a Worker/DO. Billing is in 10 ms increments. CPU is billed only while active, but memory and disk are billed while awake. Sizes run from `lite` (1/16 vCPU, 256 MiB) to `standard-4`. ([changelog](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/), [cost analysis](https://bex.co/blog/2026/07/28/cloudflare-containers-ga-per-10ms-billing))

**Phase-2 real-time**
- Cloudflare: a Durable Object per Graph as the co-editing room, via [PartyServer / y-partyserver](https://github.com/cloudflare/partykit) or [y-durableobjects](https://github.com/napolab/y-durableobjects).
- Self-host: **Hocuspocus v4** (MIT) now runs on Node, Bun, Deno *and* Workers via crossws ([HN](https://news.ycombinator.com/item?id=48208834)). It's a candidate for one Yjs server on both targets.
- Don't plan on self-hosted DOs. workerd "cluster mode" ([PR #6780](https://github.com/cloudflare/workerd/pull/6780)) was **closed unmerged on 2026-09-11** because NFS locking was too slow. workerd DOs self-host on a single instance only.
- The sync-engine choice belongs to ticket 05. The runtime only has to leave room for a WebSocket "room" service: a DO on CF and a Node process when self-hosted.

## Gotchas

1. **No module-level DB/auth singletons.** Build `db` and `auth` per request, e.g. a `createContext(env)` passed through Hono middleware. On Node, a shared pool is fine, so let the entry file supply the `db` factory.
2. **Migrations run out-of-band.** Run `drizzle-kit migrate` from CI or a one-shot container, never inside the Worker.
3. **Operation log / notifications:** anything that needs `LISTEN/NOTIFY` or advisory locks (e.g. fan-out of Graph operations) can't go through Hyperdrive. Use a DO or queue on CF and in-process events on Node.
4. **Free plan is impractical.** 10 ms CPU is tight for auth, Drizzle and MCP JSON-schema work. Budget Workers Paid ($5/mo).
5. **SPA vs API routing:** without `run_worker_first`, a browser *navigation* to `/api/...` or `/mcp` gets `index.html`.
6. **OAuth callback URLs differ per deployment.** Set `BETTER_AUTH_URL` and Google redirect URIs per instance, and document this for self-hosters.
7. **Keep the core free of Node-only APIs.** Stick to web-standard `fetch/Request/Response/crypto.subtle` in shared code. Anything Node-only lives behind the node entry.
8. **Node vs Bun for self-host:** both run Hono and `pg`. Default the published image to Node LTS for the broadest `pg`/Drizzle-kit parity, with Bun optional.

## Recommendation

**Adopt Stack A.**
- `packages/server`: a Hono app factory taking `{ db, env }`. It holds Better Auth (Drizzle adapter, Google), REST/ops API, `/mcp` (MCP SDK web-standard transport, stateless, bearer-token auth) and `/api/ai` (AI SDK streaming).
- `apps/worker`: Workers entry with static assets serving the SPA, and Hyperdrive → `pg` → Drizzle per request.
- `apps/server-node`: Node container serving the same app plus `dist/` statics, with a `pg` Pool, shipped with a docker-compose Postgres.
- Phase-2 real-time: a DO room on CF and a Node/Hocuspocus room when self-hosted, behind one interface.

**Keep Stack B as the escape hatch.** If Workers limits (128 MB, CPU, no LISTEN/NOTIFY) start shaping the design, deploy the Node image to Cloudflare Containers or any VPS. Stack A's Node entry already is that image, so switching costs no rewrite.
