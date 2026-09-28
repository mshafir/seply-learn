# Umbel Learn

A collaborative, LLM-assisted tool for building, curating and exploring **Expeditions**: bodies of knowledge on one subject. Start from an AI chat, a few files or just a prompt. Umbel Learn breaks the material into well-defined **Concepts**, links them, and lets you look at them through several **Views**: a learning path, a comparison table, cause and effect, a timeline, a map, and more. Humans and AI agents curate it together, and every AI change is a suggestion you accept or dismiss.

> **Status:** planning complete; the build is starting. "Umbel Learn" is a placeholder name (Umbel is the umbrella for separate LLM tools: Learn, Work, Plan).

## What's here

| Path | What it is |
|---|---|
| [`docs/spec/v1/`](docs/spec/v1/README.md) | The build-ready v1 spec: domain model, architecture, screens, Views, AI, MCP, design system, phase 2 |
| [`docs/plan/v1/`](docs/plan/v1/README.md) | The implementation game plan: milestones M0–M6 and work packages (tracked as GitHub Issues) |
| [`CONTEXT.md`](CONTEXT.md) | The glossary. Code and docs use these words |
| [`docs/view-types/`](docs/view-types/README.md) | View Type definitions, written as instructions for curators and agents |
| [`docs/wayfinder/mindmaps-v1/`](docs/wayfinder/mindmaps-v1/map.md) | The planning map and every decision ticket behind the spec |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`prototypes/sample-graphs/`](prototypes/sample-graphs/) | A static viewer prototype for the View Types |
| [`prototypes/seeding/`](prototypes/seeding/README.md) | The curator-agent playbook prototype, with its checks and layout metrics |

## Stack (v1)

A TypeScript monorepo (pnpm + Turborepo):
- **Frontend:** React 19 + Vite; React Flow; shadcn with Base UI; Tailwind v4, with dark mode.
- **Backend:** Hono on Cloudflare Workers (Durable Objects, Workflows, R2, Hyperdrive → Postgres on Neon). Self-hostable as one Node container plus Postgres.
- **Auth:** Better Auth.
- **AI:** AI SDK 7 for the in-app curator agent. A remote MCP server lets outside agents read and propose.

## Contributing

Building is done in the lanes described in the [plan](docs/plan/v1/README.md). Start from an open Issue, read the linked spec section, and open a PR. Keep fixtures synthetic or public: this repo is public, and personal chats never go in it.

## License

[MIT](LICENSE)
