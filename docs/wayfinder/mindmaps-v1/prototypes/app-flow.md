# App layout and page flow (Claude Design canvas)

- **Canvas:** [Mindmaps app flow](https://claude.ai/artifact/91sXuKTVYYDqfe5AWdNbc6) (private to the owner; share it from its Share menu).
- **Saved copy:** [`app-flow/project/`](app-flow/project/). Each screen's `.dc.html` plus `canvas.json`. The markup is a design reference, not production code.
- **Date:** 2026-09-25. The canvas says "graph" and "Mindmaps" throughout; the product is now **Umbel Learn** and a graph is now an **Expedition** (see [`CONTEXT.md`](../../../../CONTEXT.md)). Copy gets updated at build time.
- **Sample content:** the AI compute Expedition only. The statins sample holds personal health data and stays local.

## Screens

| # | Artboard | What it is |
|---|---|---|
| 00 | Page flow (`Main`) | The map of screens and entry points (shared link, agent via MCP). |
| 01 | Library | Your Expeditions, shared ones, drafts, tags; "Continue reading"; cards with a thumbnail, sharing avatars, counts and date. |
| 01a | Graph thumbnails (`Thumbnails`, `Thumb`) | One miniature per View Type; a card shows its Expedition's best View. |
| 02a | Start from anything (`Source`) | Add Sources: an AI chat (any assistant), files or links, or just a prompt, with goal chips. Sources stack up. |
| 02b | Choose Views (`Seed`) | Proposed Views as cards (thumbnail, question, why); toggle; "Suggest more Views"; "Ask for a specific View". |
| 02c | Building (`Building`) | The Expedition opens immediately; Views build independently in the rail; the first View streams in; a stage panel. |
| 02d | First View ready (`BuildingReady`) | Use a finished View while others build; ready toast; a failed View with reason and Retry / another View / Remove; articles written in the background. |
| 02e | Skeletons (`Skeletons`) | What each View Type shows while it builds, and the failure rules. |
| 03 | Graph home (`Graph`) | Views rail · canvas · side panel. A floating View button opens the View panel; a path chip; the reading-status control. |
| 04 | Side panel states (`Panel`) | Overview → article (in the panel, with provenance) → editing in place. |
| 05 | Grow (`Grow`) | Ask for more; suggestions drawn dashed on the canvas and listed for accept/dismiss; presence; MCP proposals as a toast. |
| 06 | Versions & sharing (`Versions`) | Snapshot history with a diff summary; share dialog with roles and a public link to a frozen Snapshot. |

## Decisions

**Structure and navigation**
1. **Three panes on the Expedition screen:** Views rail (left, 272 px) · canvas (centre, as wide as possible) · side panel (right, 440 px, opens on selection).
2. **Views are a rail, not tabs.** Each entry shows the View's name and the question it answers. An Expedition opens on its best View.
3. **No toolbar above the canvas.** The View is a floating button on the canvas (icon, name, question, settings icon). Clicking it swaps the side panel to the **View panel**: description, settings, "Duplicate", "Read the View Type".
4. **View settings are split** into the reader's own (show all steps, hide what I've read) and shared ones (targets, core rule, Relationship Types followed), and the panel says which is which.
5. **View-specific status floats on the canvas** as a small chip (e.g. "Path to MLA · 7 of 11 read", with a clear button), not in a bar.

**Reading**
6. **Side panel reads at three depths:** summary → overview → full article, all inside the panel with a back stack; in-text links navigate the panel.
7. **Reading status is per reader and works in every View:** Not read yet / Read / I knew this, set in the Concept panel. Read Concepts show a check on the canvas. It replaces the Learning path's own "I know" button.
8. **Provenance per article section:** "from the chat" vs "background knowledge", with a link to the source turn.
9. **Library "Continue reading"** resumes the last path and step.

**Creating**
10. **Expeditions start from any Sources,** mixed and several at once: an AI chat from any assistant (pasted text, share link or export), files (PDF, Markdown, Word, text, HTML) or links, or a prompt alone. Prompt-only content is marked background knowledge.
11. **No Concept review step.** After the Sources, the only choice is which **Views** to start with (cards with thumbnail, question, and why it was proposed), plus "Suggest more Views" and "Ask for a specific View". Concepts are curated inside Views afterwards.
12. **The first build is not a Proposal.** Its Concepts and Views are created directly (recorded in the glossary).
13. **Building never blocks.** The Expedition opens straight away. Views build independently, each with its own status (queued, building with a step label and progress, ready, failed). A finished View can be used while others build, and a toast announces the next ready View. "Leave it building; we'll notify you" is offered.
14. **Build order:** read the Sources → find Concepts (shared by all Views) → build each View independently → write articles last, in the background (overviews come first, so reading can start early).
15. **Streaming and skeletons:** graph Views stream nodes into reserved slots (no layout jump); tables fill cells, with "?" rather than guesses; Anatomy and Outline show structure first; Map frames the area, then drops pins; Timeline and Rates draw the axis first.
16. **Failure is per View:** say why in plain words, offer Retry / another View / Remove, and leave other Views untouched.

**Growing and collaborating**
17. **In-app AI and MCP edits are Proposals,** drawn dashed on the canvas and listed in a Suggestions tab until someone accepts them. "Accept all" and "Write overviews too" are offered.
18. **Presence:** avatars in the header and live cursors; an agent via MCP appears as a participant.
19. **In-app AI uses the reader's own API key** ("Uses your API key").

**Sharing and history**
20. *(Amended by the Core data model decision: history is a list of Changes with undo, view-as-of and restore; no Snapshots.)* **Snapshots in a history list** with a diff summary (e.g. overviews added, Views changed); "Snapshot the draft".
21. **Sharing:** invite by email with a role (owner / editor / viewer). *(Amended by the Core data model decision: a public link shows the **latest state**; a stable copy is a Fork; Sources are visible to every viewer, so the "include the Sources" toggle becomes a plain warning that Sources go public too.)*
22. **Library cards show who an Expedition is shared with** (avatars plus a short summary).

**Visual language**
23. **Look:** warm neutral ground (#F6F5F1), ink #1D1C1A, one indigo accent (#3A45B5) for links and actions, amber for suggested / in progress / "from the source". IBM Plex Sans for UI, IBM Plex Mono for labels, **Newsreader serif for reading text** (overviews, articles, View questions). Kind colours as in the prototype.
24. **Thumbnails** are miniatures of each View Type, drawn per Expedition from its best View.

## Open questions this raises

- **Wording:** the UI says "Suggestions" and "Can suggest", while the glossary term is **Proposal** (avoid "Suggestion"). Decide whether UI copy may say "suggestions" or should say "proposals".
- ~~**A "can suggest" role**~~ *(resolved: not a role; an agent acts as its user, labelled "agent via MCP", Proposals only)* appeared for agents in the share dialog. Collaborator roles are editor / viewer; MCP already writes only Proposals. Decide whether this is a third role or just how agent tokens are shown.
- **Personal vs shared View settings** need a home in the data model (per-reader View state).
- **Reading status** needs sync and privacy rules (it's personal, but "Continue reading" works across devices).
- **Build pipeline** needs a job runner, progress streaming to the client, retries, and cost limits on the user's key.
- **Dark mode** isn't on the canvas; the palette needs a dark counterpart.
