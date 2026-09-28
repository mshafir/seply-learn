---
id: 09
title: Deployment topology and monorepo layout
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: [04, 05, 20]
---

## Question

What are the concrete deployment topologies and package boundaries? Cover:
- the Cloudflare hosted instance
- self-hosting (docker compose)
- the Electron local-first app with optional sync

And the Turborepo/pnpm packages: `apps/web`, `apps/desktop`, `apps/server`, and shared `packages/*` for the domain model, graph UI, sync, the MCP server, and AI features. Also: which pieces are shared between SPA and Electron, and which mise-managed tools are needed.

## Update (2026-09-25)

Add a shared UI package built on **shadcn with Base UI** (see [shadcn with Base UI, component inventory and dark mode](14-shadcn-base-ui-inventory.md)), used by both the SPA and Electron. Add wherever the build pipeline's jobs run (see [Sources and the build pipeline](15-sources-and-build-pipeline.md)). The first milestone deploys the web app on Cloudflare; self-host and desktop follow.

## Resolution (2026-09-25)

Grilled with the user.

- **Monorepo, split by layer.** Dependencies run one way: domain ← sync ← views/ui ← web.
  - **Apps:**
    - `apps/web`: Vite SPA, installable as a PWA.
    - `apps/worker`: the CF entry, holding the Worker, the Expedition Durable Object and the build Workflow.
    - `apps/server-node`: the Node entry, holding Hono, the in-process rooms and the pg-boss worker.
  - **Packages:**
    - `domain`: the Drizzle schema, op kinds, the pure `apply()`, and the View Type Zod schemas.
    - `sync`: the op engine, push/pull, the TanStack DB collections and the Relay client.
    - `server`: the Hono app factory (auth, `/api`, `/mcp`) and the `Relay` and `JobRunner` interfaces.
    - `ai`: the build pipeline stages, Grow, prompts and BYOK providers.
    - `views`: the React Flow canvas, View renderers and layouts.
    - `ui`: shadcn + Base UI.
    - `config`: shared tsconfig, eslint and the Tailwind preset.
- **Cloudflare instance:** one Worker serves the SPA, the API and `/mcp`.
  - It carries an Expedition Durable Object (the live room).
  - Builds run as **Cloudflare Workflows** behind our own `JobRunner`, one step per View.
  - Postgres is **Neon** via Hyperdrive. Source blobs go in **R2**.
- **Self-host:** docker compose with one Node container plus Postgres.
  - The container runs the SPA, API, MCP, live rooms and an in-process **pg-boss** worker.
  - Blobs go to a local volume, or to any S3-compatible bucket.
  - Multi-instance fan-out through LISTEN/NOTIFY is optional.
  - Configuration is env vars only. Email+password is the default login; Google is optional.
- **JobRunner:** a small interface (start, step, retry, cancel, progress → Relay) with a Workflows implementation for CF and a pg-boss one for Node. The stage functions in `packages/ai` are shared by both.
- **Desktop: no Electron in v1.** The web app is an installable **PWA**. Electron returns in phase 2, together with local-first editing.
- **Offline: read-only in v1.**
  - A service worker caches the app shell.
  - IndexedDB keeps the last ~10 opened Expeditions, plus any marked "Keep available offline". The copy is the state as of the last visit, overviews and articles included, Source files not.
  - Opening one offline shows it read-only, with an "offline, as of …" chip.
  - There are **no offline edits**. The op engine keeps pending ops in memory only.
- **Consequences for the data model:** the schema targets **Postgres only** in v1. `apply()` stays pure (no DB dependency), so SQLite can return with local-first desktop.
- **Deploys:**
  - GitHub Actions runs typecheck and tests, applies the Drizzle migrations, then deploys with Wrangler.
  - Each PR gets a **preview Worker and its own Neon branch**, so parallel agents never share a database.
  - Release tags publish the self-host image.
- **mise:** Node LTS and pnpm. Wrangler, Turbo and drizzle-kit are dev dependencies. Docker is needed only to build the self-host image.
