---
id: 07
title: Remote MCP server, auth, and skills
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

What is the current best practice for a **remote MCP server** that is both self-hostable and deployable on Cloudflare? Cover:
- transport (streamable HTTP)
- OAuth per the MCP authorization spec, and whether Better Auth's MCP/OIDC plugin can act as the authorization server
- personal API tokens as a fallback
- per-Graph scoping
- how to ship **skills** alongside the MCP server (Claude Code / Agent Skills format, plugin marketplaces) so agents know how to read a Graph and create Proposals
- whether a local stdio MCP should also exist for the local-first desktop app

Summarize the options and recommend.

## Resolution

- **Transport:** one stateless Streamable HTTP `/mcp` route in the existing backend, on MCP spec 2026-07-28 with the official TS SDK v2 `createMcpHandler`. The same code runs on Cloudflare Workers (Postgres via Hyperdrive) and Node/Bun. No Durable Objects and no `McpAgent`.
- **Auth:** Better Auth (≥1.7) is the OAuth 2.1 authorization server via `@better-auth/mcp` + `@better-auth/cimd` + JWT. CIMD is preferred and DCR is opt-in only. Don't use `workers-oauth-provider`.
- **Fallback:** personal API tokens via `@better-auth/api-key`, sent on the same `Bearer` header.
- **Per-Graph scoping:** coarse verb scopes (`graphs:read`, `proposals:write`) + the Collaborator ACL on every call. Graph allow-lists are optional (API tokens and consent). MCP writes are Proposals only.
- **Skills:** an Agent Skills `mindmaps` skill shipped as a Claude Code plugin + repo marketplace (Agent Plugins 1.0 manifest optional). The guidance is mirrored in the server `instructions` and tool descriptions for hosted chat clients.
- **Local stdio:** none in v1. Keep tools transport-agnostic. Phase 2: the Electron app serves the same tools on a loopback HTTP endpoint.
- Details and sources: [../research/remote-mcp-and-skills.md](../research/remote-mcp-and-skills.md)
