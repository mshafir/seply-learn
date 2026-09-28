---
id: 10
title: MCP tool surface and skills
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: [07, 08]
---

## Question

What exactly do the MCP server's tools and the accompanying skills expose? Cover:
- reading a Graph (whole, per View, neighbourhood of a Concept)
- search
- proposing Concepts and Relationships
- editing content
- managing Tags and Relationship Types
- reading history (Changes) and Forking

Which operations go through Proposals and which apply directly? How are tokens scoped? What do the skills teach an agent (e.g. how to decompose a source into Concepts, reusing the seeding workflow)?

## Update (2026-09-25)

[Core data model and operation log](08-core-data-model-and-operations.md) dropped Snapshots (history is Changes from the op log; Fork for a separate copy) and settled that an agent acts as its user, labelled "agent via MCP", writing only Proposals.

## Resolution (2026-09-25)

Grilled with the user.

- **Read tools** return compact markdown with ids, not raw JSON dumps:
  - `list_expeditions` (mine, shared)
  - `get_expedition` (summary, Views, Kinds, Relationship Types, Attributes, counts)
  - `get_view` (the View's Concepts and Relationships in its own shape: a path, a table, an outline…)
  - `get_concept` (content at a chosen depth: summary / overview / article, plus neighbours N hops out)
  - `search` (free text and Tags across everything the user can see)
  - `list_sources`, `get_source_segments`
- **Create:** `create_expedition` takes Sources (text) plus the Concepts, Relationships and Views the agent extracted with its own model. They are validated against the `packages/domain` Zod schemas and written **directly as a first build** (one Change). The new Expedition is private and owned by the user. This is the "agent via MCP" entry point on the page flow.
- **Propose:**
  - `propose_changes(expedition, rationale, items[])` makes **one batch Proposal**. Items: create Concept, set a Concept field, add or remove a Relationship, add a Tag, add a View, …, with temp ids for new Concepts. The same Zod op schemas validate it. It returns the Proposal id, a per-item result, and a review link.
  - `list_my_proposals` and `withdraw_proposal`.
  - All other agent writes are Proposals, and the agent shows as "agent via MCP".
- **No server AI through MCP.** The agent is the model, and an MCP call never spends an API key.
- **Not in v1:** reading state, history (Changes), undo, restore, Fork, sharing and Visibility. They are app-only.
- **Scopes:** `expeditions:read`, `expeditions:create`, `proposals:write`. The consent screen (or an API token) can restrict a token to chosen Expeditions. The Collaborator role is checked on every call.
- **Skill:** one **`umbel-learn`** Agent Skill:
  - how to decompose Sources into right-sized Concepts, Relationships and provenance (the seeding heuristics);
  - how to pick and configure View Types (bundles the `docs/view-types` files as references);
  - how to propose well (small, coherent batches with a rationale).

  Its guidance and the build pipeline's prompts come from the **same source files in `packages/ai`**. The server `instructions` mirror it for hosted chat clients.
