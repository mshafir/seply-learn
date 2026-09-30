# Seply Learn v1: build spec

**Seply Learn** (Seply is the umbrella for separate LLM tools: Learn, Work, Plan; previously Umbel Learn, see [ADR 0002](../../adr/0002-rename-to-seply.md)) is a collaborative, LLM-assisted tool for building, curating and exploring **Expeditions**: bodies of knowledge on one subject. A reader learns a subject in well-defined chunks, sees it from several angles, and sees what they need to know first. Humans and LLMs curate Expeditions together.

This spec is **build-ready**: every decision it relies on was made on the [wayfinder map](../../wayfinder/mindmaps-v1/map.md), and each section links the ticket that holds the detail and the reasoning. Where this spec and a ticket disagree, the ticket's latest resolution or amendment wins; please fix the spec. The **implementation game plan** (milestones, work packages, lanes) is a separate document built on this one.

## Read in this order

| # | Section | What it fixes |
|---|---|---|
| 1 | [Domain model](01-domain-model.md) | Entities, schema, operation log, history (Changes), Proposals, Fork, per-reader state, permissions |
| 2 | [Architecture and deployment](02-architecture.md) | Monorepo, Cloudflare and self-host topologies, sync, live relay, jobs, auth, search, storage, deploys |
| 3 | [Screens and flows](03-screens-and-flows.md) | Every screen, what it does, and its states |
| 4 | [Views and View Types](04-views.md) | The View Types shipped in v1, settings, per-View structure, layout rules |
| 5 | [AI: building and growing](05-ai.md) | The curator agent, its tools and checks, the skim, writing, Grow, keys and cost |
| 6 | [MCP and skills](06-mcp.md) | The remote MCP server, tools, auth and the `seply-learn` skill |
| 7 | [Design system](07-design-system.md) | shadcn with Base UI, tokens, dark mode, divergences, branding |
| 8 | [Phase 2 sketch](08-phase-2.md) | What comes after v1, and what v1 must not block |

## Vocabulary

[`CONTEXT.md`](../../../CONTEXT.md) is the glossary, and this spec uses its terms exactly: **Expedition, Source, Concept, Concept Kind, Attribute, Weight, Tag, Relationship, Relationship Type, View, View Type, Reading status, Visibility, Collaborator, Change, Fork, Proposal**. Older planning documents and the prototypes say *Graph* (read: Expedition), *Pivot* (read: View) and *Snapshot* (dropped; see Changes). Reader-facing copy says "Suggestions" for Proposals; code, API and MCP say Proposal.

## Fixed givens

- **Stack:** a pnpm + Turborepo TypeScript monorepo, with tools installed by mise.
  - React 19 + Vite SPA; React Flow 12; shadcn **with Base UI** (prebuilt components wherever possible, every divergence listed).
  - Tailwind v4, with **dark mode** required.
  - Hono backend; Drizzle over Postgres; Better Auth (Google login by default).
  - **Core AI SDK 7** for in-app AI; MCP TS SDK for the MCP server.
- **Hosting:** the **web app on Cloudflare** is the first milestone. **Self-hosting** (docker compose) comes next. A **desktop** app (Electron, local-first) is phase 2; v1 is an installable PWA.
- **Collaboration:** multi-editor, recorded as operations. v1 has live presence and live updates. Character-level text co-editing is phase 2, and the model doesn't block it.

## v1 scope in one screen

- **Create** an Expedition from any mix of Sources: pasted AI chats, files, or a prompt alone. Choose which Views to start with and watch them build. Each View is usable as soon as it's ready.
- **Read** it through several Views. Open any Concept in a side panel at three depths (summary, overview, article), with provenance. Mark Reading status. Continue where you left off. Read offline.
- **Curate** it: edit Concepts, Relationships and Views; Merge duplicates; override structure per View.
- **Grow** it with an in-app curator agent. Its suggestions are Proposals, drawn dashed, and accepted or dismissed item by item.
- **Collaborate** with owner, editor and viewer roles, live presence, a history of Changes with undo and restore, and Fork.
- **Share** it: private, unlisted or public, with a live link. Export JSON or Markdown, and import JSON.
- **Search** across everything you can see.
- **Let agents in** through a remote MCP server and the `seply-learn` skill.

## Assumptions made while assembling

These were decided with defaults rather than asked, and are marked where they appear. Challenge any of them before building:

1. Tags are add/remove ops; ops carry a schema version ([Core data model and operation log](../../wayfinder/mindmaps-v1/tickets/08-core-data-model-and-operations.md)).
2. Reading marks made offline are queued and saved on reconnect ([Per-reader state](../../wayfinder/mindmaps-v1/tickets/16-per-reader-state.md)).
3. Changing roles and removing collaborators is owner-only; ownership transfers only to an existing editor ([Permissions table](../../wayfinder/mindmaps-v1/tickets/23-permissions-table.md)).
4. Map tile extract sizes are unverified; the build measures them ([Map basemap](../../wayfinder/mindmaps-v1/tickets/21-map-basemap-for-hosted-and-self-hosted.md)).
5. Anonymous readers of a public or unlisted link receive live `ops` but send no presence ([Client sync layer and live relay](../../wayfinder/mindmaps-v1/tickets/20-client-sync-layer-and-live-relay.md)).
6. Invite email on the hosted instance uses Resend unless Cloudflare's email service fits better ([Invites and email](../../wayfinder/mindmaps-v1/tickets/26-invites-and-email.md)).
