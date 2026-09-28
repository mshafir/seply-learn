---
id: 04
title: Backend runtime for Cloudflare and self-hosting
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

Which backend runtime, framework, and Postgres access pattern runs the same TypeScript server both on **Cloudflare** (Workers/Containers, with Postgres via Hyperdrive or a hosted Postgres) and **self-hosted** (a Node/Bun container plus Postgres, e.g. docker compose)? Consider:
- Better Auth compatibility on Workers (Google social login)
- ORM/driver options (Drizzle, Kysely; postgres.js vs neon serverless)
- where the SPA is served from
- where MCP and AI-SDK streaming endpoints run
- Durable Objects as a phase-2 real-time path

Recommend one or two viable stacks, with trade-offs.

## Resolution

Recommend **one Hono app with two thin entrypoints**:
- A Cloudflare Worker (static assets serve the SPA, Hyperdrive → `pg` → Drizzle, clients created per request).
- A Node/Bun container (serves the same app plus SPA `dist/`, `pg` Pool, docker-compose Postgres).

Both entrypoints share the rest of the stack:
- **Better Auth** built per request, with the Drizzle adapter and Google login.
- **MCP** through the official SDK's web-standard Streamable HTTP transport (stateless, portable, not CF `McpAgent`).
- **AI SDK** `streamText` Responses. Workers have no wall-clock limit while the client stays connected.

Budget Workers Paid ($5/mo), because the Free plan's 10 ms CPU is too tight. Hyperdrive has no `LISTEN/NOTIFY` or advisory locks.

Fallback: run the same Node image on Cloudflare Containers (GA Apr 2026, about $33/mo always-on) or a VPS.

Phase-2 real-time: a Durable Object room on CF and a Hocuspocus v4 room when self-hosted, behind one interface. Self-hosted DO clustering in workerd was abandoned in Sep 2026.

Details: [../research/backend-runtime-cloudflare-and-selfhost.md](../research/backend-runtime-cloudflare-and-selfhost.md)
