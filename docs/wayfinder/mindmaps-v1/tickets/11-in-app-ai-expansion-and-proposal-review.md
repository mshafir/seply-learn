---
id: 11
title: In-app AI expansion and Proposal review
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: [02, 08, 13]
---

## Question

How does a user interactively grow a Graph with the embedded Vercel AI SDK? Cover:
- registering their own provider API key: where it is stored and encrypted, and how that works in the local-first desktop app
- asking for more Concepts
- expanding a Concept with examples
- pulling mentioned-but-missing prerequisites into the Graph
- suggested Relationships

How are Proposals shown on the canvas, reviewed in bulk or one by one, and accepted or rejected (accepting makes one undoable Change; there are no Snapshots)? May spin off a prototype ticket if the UX needs something concrete to react to.

## Update (2026-09-25)

The UX is now designed on the canvas: see the Grow screen in [App layout and page flow](12-app-layout-and-page-flow.md) (suggestions drawn dashed on the canvas, a Suggestions tab, "Accept all", and the reader's own API key). This ticket now decides the mechanics behind it, using the newest AI SDK and its pluggable harness support (see [AI SDK and pluggable harnesses](13-ai-sdk-harness-research.md)). It also decides whether UI copy says "suggestions" while the domain term stays Proposal.

The data side is settled in [Core data model and operation log](08-core-data-model-and-operations.md): a Proposal is a pending op batch, accepted whole or item by item, and items whose target changed since are flagged "changed since proposed".

[Sources and the build pipeline](15-sources-and-build-pipeline.md) settled that the operator sets the key mode per instance (an instance key for everyone, or each reader brings their own). BYOK keys are stored server-side, encrypted, because builds outlive the tab. This ticket decides the storage and encryption details and the key-entry UX.

[Seeding workflow from chats and docs](02-seeding-workflow.md) and the amended [Sources and the build pipeline](15-sources-and-build-pipeline.md) settled that AI building is a **curator agent working through validated tools**, with the seeding prompts as its playbook. Grow should likely reuse the same agent and tools, with writes landing as a Proposal instead of a Change. This ticket decides that, plus the key storage and review UX.

## Resolution (2026-09-28)

Grilled with the user. The glossary now records that reader-facing copy says "suggestions".

- **Who:** **owners and editors only.** Viewers and public readers get no AI in v1, including "Write the article".
- **Engine:** the build's **curator agent and tools** ([Sources and the build pipeline](15-sources-and-build-pipeline.md)), scoped to one ask, with the same validation and `view.inspect` checks. Every write lands in **one Proposal per ask** (never a Change). Items stream as `data-proposal` parts and appear dashed on the canvas as they arrive.
- **Asks:**
  - A free-form **"Ask about this Expedition"** box in the side panel.
  - **Concept actions**, which are preset asks scoped to that Concept and the current View: "Add what's missing to understand this", "Add examples", "Write the article", "Suggest related".
- **Content:** new Concepts in a Proposal arrive with a **summary and overview**, written during the ask on the asker's key. Articles stay on demand. This replaces the canvas's "Write overviews too" checkbox.
- **Review (Suggestions tab):**
  - Accept or dismiss **per item**, or Accept all.
  - Accepting a Relationship to a new Concept includes that Concept, shown before confirming.
  - Each review action commits **one undoable Change**. Dismissed items are recorded as rejected.
  - Proposals never expire. Stale items show "changed since suggested" with both versions.
  - MCP Proposals appear in the same tab, announced with a toast.
- **History:** the ask is the Proposal's rationale, shown in **Activity** with its author. The chat transcript is session-only and not stored.
- **Keys** (bring-your-own-key mode):
  - Stored server-side with **AES-GCM encryption under an instance master key** (a CF secret or an env var), decrypted only inside the request or job that uses them, never returned to the browser.
  - The UI shows the provider, the last 4 characters and a Test button.
  - One key per provider per user, deletable anytime.
  - In instance-key mode, none is entered.
- **Limits:** a per-ask spending cap (default $0.50, changeable in Settings) and a **Stop** button. Stopping keeps the items already streamed. (These were proposed defaults, confirmed with the summary.)
- **Wording:** reader-facing copy says **Suggestions**; the domain, code, API and MCP say **Proposal**.
