---
id: 12
title: App layout and page flow
labels: [wayfinder:prototype]
status: closed
assignee: claude
blocked_by: [03]
---

## Question

What are the screens of the product and how does a user move between them: finding an Expedition, starting one from Sources, choosing Views, waiting for the build, reading in the side panel, growing it with AI, and sharing it? Worked as a Claude Design canvas the curator commented on directly.

## Resolution

Designed on the [Mindmaps app flow canvas](https://claude.ai/artifact/91sXuKTVYYDqfe5AWdNbc6); the saved copy, screen list and all 24 decisions are in [prototypes/app-flow.md](../prototypes/app-flow.md). In short:

- **Expedition screen:** Views rail · canvas · side panel. The View is a floating button that opens View settings in the side panel; there's no toolbar above the canvas. View settings are split into the reader's own and shared ones.
- **Reading:** side panel at three depths (summary → overview → article) with a back stack and provenance. **Reading status** (not read / read / known) is per reader and works in every View.
- **Creating:** an Expedition starts from any mix of **Sources** (an AI chat from any assistant, files or links, a prompt alone). The only review step is choosing **Views** (cards with thumbnails, plus "suggest more" and "ask for a specific View"). The first build is not a Proposal.
- **Building never blocks:** Sources → Concepts → each View independently → articles last. Views stream in with skeletons, can be used as soon as they're ready, and fail one at a time with a reason and retry.
- **Growing:** in-app AI and MCP edits are Proposals, drawn dashed and accepted or dismissed; presence and cursors; the reader's own API key.
- **Sharing:** Snapshot history with diffs; public links point at a frozen Snapshot; Library cards show who an Expedition is shared with.

Glossary updated at the same time: **Expedition** replaces Graph, the product is **Umbel Learn** (placeholder), and **Source** and **Reading status** are new terms.
