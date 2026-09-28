# Remote MCP server, auth, and skills

Research for [ticket 07](../tickets/07-remote-mcp-and-skills.md). Current as of 2026-09-24.

## TL;DR recommendation

- **One stateless Streamable HTTP endpoint** (`/mcp`) inside the existing backend, built on the **official MCP TypeScript SDK v2** (`createMcpHandler`, Web-standard `Request`/`Response`). The same code runs on Cloudflare Workers and on Node/Bun for self-hosters. No Durable Objects, no `McpAgent`.
- **Better Auth is the authorization server**: `@better-auth/mcp` + `@better-auth/cimd` + the JWT plugin. Don't add `workers-oauth-provider`.
- **Personal API tokens** via `@better-auth/api-key` as the fallback, sent as `Authorization: Bearer`. They can be scoped per Graph.
- **Per-Graph scoping** = coarse OAuth scopes (verbs) + the server-side Collaborator ACL (which Graphs) on every call. API tokens can also carry an explicit Graph allow-list. MCP write tools only create **Proposals**, so no token can change a Graph directly.
- **Skills**: one Agent Skills–format `mindmaps` skill (`SKILL.md` + `references/`) in the monorepo, packaged as a Claude Code plugin with its own marketplace in the repo. Keep the core guidance duplicated in the MCP server `instructions` and tool descriptions, so clients without skills (claude.ai, ChatGPT) still behave well.
- **No local stdio server in v1.** Keep the tool definitions transport-agnostic, so the Electron app can later expose the same tools on a loopback HTTP endpoint (phase 2).

## 1. Transport: Streamable HTTP, now stateless

- Current spec is **2026-07-28** ([release post](https://blog.modelcontextprotocol.io/posts/2026-07-28/)). The key changes:
  - **Sessions are gone.** There is no `initialize` handshake and no `Mcp-Session-Id`. Each request describes itself (protocol version and client info go in `_meta`).
  - Requests carry **`Mcp-Method` / `Mcp-Name` headers**, so gateways and WAFs can route and rate-limit without parsing the body.
  - Server→client requests work through **multi-round-trip** (`resultType: "input_required"`) instead of held-open streams.
  - The legacy **HTTP+SSE transport is deprecated** (12-month window). **Roots, Sampling, and Logging are deprecated.**
- Result: an MCP server is an ordinary HTTP route. Cloudflare says servers "can now run in just a Worker, no stateful infrastructure needed". `createMcpHandler` has moved into the official TS SDK, and the SDK is now built on Web standards (Workers/Bun/Deno/Node) ([Cloudflare: next generation of MCP](https://blog.cloudflare.com/mcp-v2/), [createMcpHandler docs](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/)).
- **Gotcha:** most 2025 tutorials (McpAgent + Durable Objects, SSE, session IDs) are now stale. `McpAgent` is deprecated and feature-frozen ([McpAgent docs](https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/)).

## 2. Authorization

### MCP auth spec (2026-07-28 profile)
- OAuth 2.1. The MCP server is a **protected resource** that publishes RFC 9728 `/.well-known/oauth-protected-resource`. Tokens are **audience-bound** to the resource URL (RFC 8707 `resource`).
- Client registration, in order of preference: **pre-registered → CIMD (Client ID Metadata Documents) → DCR**. **DCR is deprecated**, with removal expected after summer 2027 ([Cloudflare](https://blog.cloudflare.com/mcp-v2/), [spec post](https://blog.modelcontextprotocol.io/posts/2026-07-28/)).
- Authorization servers **must return `iss`** (RFC 9207). Clients send `application_type`, which fixes localhost redirects for desktop and CLI clients.
- Client support: Claude's connector dialog recommends CIMD, and ChatGPT prefers CIMD when the AS advertises `client_id_metadata_document_supported`. Claude also supports static request headers and authless connectors ([Claude connector auth docs](https://claude.com/docs/connectors/building/authentication), [sunpeak overview](https://sunpeak.ai/blogs/claude-connector-oauth-authentication/)). Claude Code uses **loopback redirects on ephemeral ports**, so the AS must match `http://localhost/...` redirects without regard to port.

### Better Auth as the AS: yes, this is the intended use
- **Better Auth 1.7** (2026-08-17) removed `oidcProvider` and moved MCP auth to **`@better-auth/mcp`**, which targets the 2026-07-28 auth profile and SDK v2. New **`@better-auth/cimd`** package ([1.7 post](https://better-auth.com/blog/1-7), [MCP plugin docs](https://better-auth.com/docs/plugins/mcp)).
- `mcp()` *is* the OAuth provider. It builds on `@better-auth/oauth-provider`. **Don't also register `oauthProvider()`.** It serves protected-resource metadata, issues **JWT access tokens** (JWT plugin, `/jwks`), supports DPoP, and has `requiredScopes` with RFC 6750 `insufficient_scope` step-up.
- Same process: `requireMcpAuth(auth, handler, { resource, requiredScopes })`. Split auth and MCP services: `createMcpProtectedRequestHandler({ issuer, audience, jwksUrl }, handler)` verifies against JWKS locally, with no database round trip.
- DCR is **off unless explicitly enabled** (`allowDynamicClientRegistration`, `allowUnauthenticatedClientRegistration`). Recommend keeping it behind an instance config flag, for older clients only.
- Google social login stays the upstream identity. Better Auth runs the consent page.
- **Gotchas:**
  - `resource` must be an exact HTTPS URL (HTTP is accepted only on loopback). Self-hosters must configure a correct public base URL, or token audience checks fail.
  - The 1.7 migration touches OAuth client tables.
  - An older refresh-token replay advisory affected the removed plugins ([GHSA-pw9m-5jxm-xr6h](https://github.com/better-auth/better-auth/security/advisories/GHSA-pw9m-5jxm-xr6h)). Use ≥1.7.

### Why not Cloudflare's `workers-oauth-provider`
It makes the Worker issue its own tokens and store grants in KV. That duplicates Better Auth, is Cloudflare-only, and breaks self-host parity ([CF authorization docs](https://developers.cloudflare.com/agents/model-context-protocol/authorization/)). Cloudflare Access is an option only for private, org-internal instances.

### Personal API tokens (fallback)
- **`@better-auth/api-key`** provides key creation and verification, `permissions: Record<string, string[]>`, metadata, per-key rate limits, and expiry ([docs](https://better-auth.com/docs/plugins/api-key)).
- Use it for headless agents and CI, for clients that only support static headers, and for self-hosted instances without a working OAuth setup. The `/mcp` auth middleware tries a JWT first and then falls back to an API-key lookup on the same `Bearer` header. Use a recognizable key prefix (e.g. `mm_`) to pick the path cheaply.

### Per-Graph scoping
- OAuth scopes are coarse and verb-shaped: e.g. `graphs:read`, `proposals:write`. **Don't mint one scope per Graph ID.** The scope list would be unbounded, and clients handle dynamic scopes poorly.
- Which Graphs a token can reach is decided by the **Collaborator ACL at request time**: the token acts as the user and is never above the user's role.
- Optional narrowing: the consent screen can let the user pick Graphs and store them on the grant or token claim. API tokens carry an explicit Graph allow-list in `permissions` (e.g. `{ "graph:<id>": ["read","propose"] }`). This settles the map's open "MCP tokens scoped per Graph?" question: **optional, default all-accessible**.
- Because MCP writes are Proposals, the scopes in v1 need no "accept" or "direct write" verb.

## 3. Deployment: Cloudflare vs self-host

| | Cloudflare (user's instance) | Self-host |
|---|---|---|
| Runtime | Worker (`createMcpHandler` in `fetch`) | Node/Bun HTTP server, same handler |
| Postgres | via **Hyperdrive** | direct |
| State | none needed (stateless spec) | none needed |
| Auth | Better Auth in the same Worker | Better Auth in the same process |
| Endpoint | `https://<host>/mcp` + `/.well-known/*` at the root | same |

- Mount the MCP route in the **same backend** as the app API. It shares the Graph/Proposal domain services and the Better Auth instance, and needs no separate service.
- Optional: publish to the [MCP Registry](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-with-agent-skills) for the hosted instance.
- **Gotchas:**
  - Serve `/.well-known/oauth-protected-resource` and AS metadata at the **origin root**, not under `/api/auth`. Several guides call this out ([example issue](https://github.com/abustamam/tm-scheduler/issues/842)).
  - Configure CORS for browser-based MCP clients.
  - Don't run SCIM on D1 (not relevant with Postgres).

## 4. Skills distribution

- **Agent Skills** (`SKILL.md` with `name` + `description`, optional `references/`, `scripts/`) is an open standard at [agentskills.io](https://github.com/agentskills/agentskills). It is supported by about 40 clients, including Claude Code, Codex, Copilot/VS Code, Cursor, Gemini CLI, and Goose. The MCP docs themselves ship skills this way ([Build with Agent Skills](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-with-agent-skills)).
- **There is no MCP protocol mechanism for delivering skills.** They are distributed through packaging:
  - **Claude Code plugins**: `.claude-plugin/plugin.json` + `skills/` + `.mcp.json`, installed via `/plugin marketplace add <owner>/<repo>` and `/plugin install` ([plugins reference](https://code.claude.com/docs/en/plugins-reference)).
  - **Agent Plugins 1.0** (2026-08-06, vendor-neutral: Amazon, Cursor, Microsoft, OpenAI, Vercel): root `plugin.json` + `skills/` + `mcp.json` ([Google blog](https://developers.googleblog.com/agent-plugins-package-your-skills-tools-and-more/), [spec](https://agent-plugins.org/specification)). The Claude Code and Agent Plugins layouts differ. The `skills/` folder can be shared, and each layout needs its own small manifest. Claude Code ignores unknown `plugin.json` fields.
- **Recommended shape:** `plugins/mindmaps/` in the monorepo, containing:
  - `skills/mindmaps/SKILL.md`, covering how to read a Graph (Concepts, Relationships, Relationship Types, Views), the Proposal workflow (always propose, never assume acceptance, batch related Proposals, cite sources), and naming rules from CONTEXT.md;
  - `references/` for the tool catalog and examples;
  - an MCP config pointing at the hosted `/mcp` URL;
  - a `marketplace.json` at the repo root.

  Self-hosters point the MCP config at their own URL, or add the server manually (`claude mcp add --transport http …`) and install only the skill.
- **Always also** put a compact version of this guidance in the server's `instructions` and in the tool descriptions. Hosted chat clients (claude.ai, ChatGPT) don't load plugin skills.

## 5. Local stdio MCP for the Electron app?

- **Not in v1.** Official guidance treats stdio as the option for prototyping and for servers that must touch the local machine, packaged as an **MCPB** bundle for distribution ([MCP docs](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-with-agent-skills)).
- Mindmaps' local data lives inside the running Electron app. A separate stdio process would contend for the local store and bypass the app's operation log.
- Sync-enabled desktop users can already point agents at the remote server.
- **Phase 2 path:** the Electron app exposes the same tool set on a **loopback Streamable HTTP** endpoint (`127.0.0.1`, with a per-install token) while it runs. Add a thin stdio bridge or MCPB only if a target client needs stdio.
- **v1 requirement that keeps this cheap:** define tools in a transport- and runtime-agnostic package (e.g. `packages/mcp-tools`) over the domain services.

## Gotchas checklist
- Target spec **2026-07-28** and TS SDK **v2**. Ignore SSE, session, and McpAgent material.
- Better Auth **≥1.7**: `mcp()` + `cimd()` + `jwt()`, and no separate `oauthProvider()`. DCR is opt-in.
- The resource URL, audience, and issuer must match the public origin exactly. This is the most likely self-host footgun.
- Accept port-agnostic loopback redirects (Claude Code). Return `iss`.
- Never trust scopes alone. Check the Collaborator ACL on every tool call.
- Skills don't reach hosted chat clients. Mirror the guidance in server `instructions`.
