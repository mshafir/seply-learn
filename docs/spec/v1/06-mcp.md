# 6. MCP and skills

Decided in:
- [Remote MCP server, auth, and skills](../../wayfinder/mindmaps-v1/tickets/07-remote-mcp-and-skills.md)
- [MCP tool surface and skills](../../wayfinder/mindmaps-v1/tickets/10-mcp-tool-surface-and-skills.md)
- [Permissions table](../../wayfinder/mindmaps-v1/tickets/23-permissions-table.md)

## 6.1 Server

- **One stateless streamable-HTTP `/mcp` route** in the Hono app, on MCP spec 2026-07-28 with the official TS SDK v2 (`createMcpHandler`). It runs unchanged on Cloudflare Workers and Node. It uses no Durable Objects and no `McpAgent`.
- **Auth:**
  - **OAuth 2.1** with Better Auth as the authorization server (`@better-auth/mcp` + CIMD; dynamic client registration opt-in only).
  - **Personal API tokens** as the fallback, on the same Bearer header.
  - **Scopes:** `expeditions:read`, `expeditions:create`, `proposals:write`.
  - The Collaborator role is checked on every call, and a token can be restricted to chosen Expeditions at consent.
- **Where** *(WP-5.4)*: `/mcp` and the OAuth discovery documents (`/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server/api/auth`) sit at the origin's root; the resource is `<origin>/mcp`, the issuer `<origin>/api/auth`. 2025-era clients are served by the SDK's stateless fallback. The consent screen is the app's `/consent`: the reader picks the scopes and the Expeditions (all, or chosen ones; stored per user and client in `agent_grants`). API tokens are made and revoked in Settings → Connected agents, with the same choices.
- **No local stdio server in v1.** Tools stay transport-agnostic, so phase-2 desktop can serve them on loopback.
- **Presence:** each tool call marks "agent via MCP" in the Expedition's room with a TTL.

## 6.2 Tools

All output is compact markdown with ids, not raw JSON dumps.

| Tool | Does |
|---|---|
| `list_expeditions` | Mine and shared |
| `get_expedition` | Summary, Views, Kinds, Relationship Types, Attributes, counts |
| `get_view` | The View's Concepts and Relationships in its own shape (a path, a table, an outline…) |
| `get_concept` | Content at a chosen depth (summary / overview / article), plus neighbours N hops out |
| `search` | Free text and Tags across everything the user can see |
| `list_sources`, `get_source_segments` | Read Sources by segment |
| `create_expedition` | Sources plus the Concepts, Relationships and Views the agent extracted with its own model. Validated, then written **directly as a first build**; private and owned by the user |
| `propose_changes` | `(expedition, rationale, items[])`: **one batch Proposal** (temp ids allowed). Returns per-item results and a review link |
| `list_my_proposals`, `withdraw_proposal` | Manage one's own Proposals |

- **The server never spends an API key on an MCP call:** the agent is the model.
- **Items are curator tool calls** *(WP-5.4)*: each `propose_changes` item is `{ tool, ref?, input }` for `concept_create`, `concept_update`, `relationship_add`, `relationship_remove` or `view_build`, its input exactly as the curator tool takes it. Temp ids look like `new:<name>`; later items (and `create_expedition`'s Relationships, View settings, prov and overview links) use them. A refused item is skipped with its reason; a proposed View must pass `view.inspect`. `create_expedition` takes Sources as segments with the agent's own ids (`t1…`, `s1…`), so prov can cite them, and is all or nothing.
- **Withdrawing** a Proposal dismisses its pending items (accepted ones stay) and marks it `withdrawn`.
- **Not exposed in v1:** reading state, history, undo and restore, Fork, sharing, Visibility.
- **Tool definitions and validation are shared in-process** with the curator agent's tools (`packages/ai`), so MCP and in-app AI can't drift.

## 6.3 The `seply-learn` skill

- **One Agent Skill,** shipped as a Claude Code plugin through a repo marketplace, and mirrored in the server's `instructions` and tool descriptions for hosted chat clients. It covers:
  - how to decompose Sources into right-sized Concepts, Relationships and provenance
  - how to choose and configure View Types (bundles `docs/view-types/`)
  - how to propose well: small, coherent batches with a rationale
- **The same playbook** as the curator agent ([AI §5.4](05-ai.md#54-the-playbook)).
