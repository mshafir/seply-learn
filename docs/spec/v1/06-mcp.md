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

## 6.4 Connecting an agent

One page, **`/connect`**, takes a signed-in reader from nothing to their agent's first result. It replaces the single command in Settings → Connected agents. It is part of the web client, so the web and the [desktop app](09-desktop.md) show the same page.

- **Four steps** on one page, each ticked as it is done:
  1. **Choose your agent:** tabs for Claude Code, Claude apps, Codex, Cursor and Other. The choice is remembered on the device.
  2. **Install:** the exact commands or clicks for that agent, each command in a copy field, with this server's address already filled in (`<origin>/mcp`).
  3. **Sign in:** what to do in the agent so it opens the consent screen (§6.1). While this step is open the page checks the reader's connected agents every few seconds, and ticks the step with the agent's name when a new one appears. "I've done this" moves on without waiting.
  4. **Give it a first prompt:** one or two prompts to copy (below).
- **Per agent** (hosted, `learn.seply.app`):

  | Agent | Install | Sign in |
  |---|---|---|
  | **Claude Code** | `claude plugin marketplace add mshafir/seply-learn`, then `claude plugin install seply-learn@seply` (the skill and the server together) | `/mcp` → seply-learn → Authenticate |
  | **Claude apps** (desktop and claude.ai) | Settings → Connectors → Add custom connector, and paste the server address | Connect, then allow in the browser |
  | **Codex** | `codex mcp add seply-learn --url <origin>/mcp` | `codex mcp login seply-learn` |
  | **Cursor** | An **Add to Cursor** install link, and the `mcp.json` snippet to paste instead | Cursor's prompt on first use |
  | **Other** | The server address, and **Create a token** in place (the Settings form, §3.10) with the `Authorization: Bearer` header to copy | None: the step ticks when the token is first used |

  The work package checks every command against the agent's current release before it ships; the table is the intent, not a guarantee of syntax.
- **On a self-hosted server** the plugin isn't offered, because its bundled server address is the hosted one. Claude Code gets `claude mcp add --transport http seply-learn <origin>/mcp` instead; the server's `instructions` carry the playbook (§6.3). Claude apps shows a note that the server must be reachable from the internet over `https`. Whether the server is the hosted one comes from `GET /api/instance` (`hosted: true`).
- **The first prompt fits where the reader came from:**
  - From the Library or New Expedition: *"Make a Seply Learn Expedition from this conversation."* and *"Make a Seply Learn Expedition about `<the subject typed so far, or a placeholder>`."*
  - From an Expedition (`/connect?e=<id>`): *"Read my Seply Learn Expedition "`<title>`" and suggest what's missing."* The step says the result will arrive in that Expedition's Suggestions, with a link back.
  - After a create prompt, the page links to the Library, where the new Expedition appears.
- **Entry points:**
  - **Create: Sources** (§3.3): "Or create it from your own agent".
  - **Suggestions tab** (§3.8): "Get suggestions from your own agent", in the tab and as its empty state. Owners and editors only.
  - **Ask** (§3.8): a link under the key line; when no AI key is set up, it is the panel's main action.
  - **The empty Library** (§3.2), and **Settings → Connected agents** (§3.10), which keeps the lists of agents and tokens.
  - **Desktop:** **Connect an agent…** in the app menu. Once, after the first sign-in, a reader with no connected agents lands here instead of the Library, with **Skip for now**.
- **Built from prebuilt components** (Tabs, Card, the copy field already in Connected agents, Badge); no new divergence.
- **Anonymous readers** who open `/connect` are sent to sign in first. Viewers of an Expedition see the create prompts only.
