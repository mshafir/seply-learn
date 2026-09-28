---
id: 15
title: Sources and the build pipeline
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: [08, 13]
---

## Question

How does an Expedition get built from its Sources? The UX is fixed on the canvas (Start from anything, Choose Views, Building, First View ready, Skeletons, in [App layout and page flow](12-app-layout-and-page-flow.md)). Decide the mechanics:

- **Source ingestion:** pasted chat text from any assistant, share links (most need a signed-in browser), exports, files (PDF, Word, Markdown, HTML), links, and prompt-only. What is stored, where, size limits, and how provenance is tracked (per Concept, per article section).
- **Stages:** read Sources → find Concepts (shared) → propose Views → build each View → overviews → articles. What each stage's prompt or agent does, reusing the seeding heuristics ([Seeding workflow from chats and docs](02-seeding-workflow.md)).
- **Runner:** where long jobs run on Cloudflare (Workflows, Queues, Durable Objects), self-hosted, and on desktop; how per-View progress and streaming nodes reach the client; resume after a closed tab; notify when done.
- **Failure, retry and cost:** per-View failure reasons, retries, token budgets on the user's key, cancellation.
- How "Suggest more Views" and "Ask for a specific View" reuse the same View-building stage.

## Resolution (2026-09-25)

Grilled with the user. The glossary's Proposal entry was updated: later-requested Views are direct, and later Sources are Proposals.

- **Inputs (v1):** pasted text (any AI chat, notes), files (chat exports from ChatGPT/Claude/Gemini, PDF, DOCX, Markdown, TXT, HTML), or a prompt alone. **No link fetching** in v1, share links included; the "links" affordance on the canvas is dropped for now.
- **Storage:** the raw file is a blob. A normalized markdown copy is split into **segments** (chat turns with speaker and index, PDF pages, document headings/paragraphs), also stored as a blob with a segment index. Provenance ref = `{source, segment, quote?}`, so "from the chat, turn 14" links to the turn.
- **Stages:**
  1. **Segment** the Sources (no LLM, apart from speaker detection in pasted chats).
  2. **Skim**: one fast call proposes Views (question plus why), shown on Choose Views within ~10–20 s. **Extract Concepts** starts at the same moment in the background, and the Concept count ticks up live while the reader chooses.
  3. Extraction commits **one Change** ("Found 84 Concepts in 3 Sources"): Concepts, Relationships and provenance.
  4. **Build each chosen View** independently. Nodes stream as a live-only preview through the Expedition's room, then commit as that View's own Change (settings, the Attributes it filled, any Concepts it added). A failed View leaves nothing half-written.
  5. **Write**: summaries and overviews for every Concept; full **articles for core Concepts only** (by Weight), in the background, committed in batches. Other Concepts get a "Write the article" button.
- **Big inputs:** segments are grouped into chunks sized for the stage model. Concepts found per chunk are merged by normalized title and aliases, using the same matching as Merge. Caps: **25 MB per file**, plus a per-Expedition token cap shown up front with a cost estimate. Over the cap, the reader picks which Sources or sections to include.
- **Keys and models:** always the **key of the reader who asked** (Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint). Viewing and editing never need a key. Each provider ships tested **per-stage defaults** (a fast model for skim and extraction, a strong one for Views and articles), which the reader can override in Settings, with per-stage choices under Advanced. Builds keep running after the tab closes, so **the key is stored server-side, encrypted**; the details are in [In-app AI expansion and Proposal review](11-in-app-ai-expansion-and-proposal-review.md).
- **Cost, cancel, retry:**
  - The **estimate** is shown before Create.
  - Each build has a **spending cap** (default 2× the estimate). Reaching it pauses the build with Continue / Stop.
  - **Cancel** stops queued and running Views and keeps finished ones.
  - Each stage auto-retries twice (rate limits, timeouts), then the View fails with a plain reason. **Retry** reuses finished stages and reruns only that View.
- **Runner:** `JobRunner` (Cloudflare Workflows, one step per stage/View; pg-boss on Node). Stage functions live in `packages/ai` and use AI SDK 7 `streamText`/`generateText` with `Output.object`/`Output.array`. Progress and preview nodes go through the Relay as `data-*` events keyed by View id. The View's status and failure reason are logged fields.
- **Notify:** live status on Library cards and an activity indicator in the header. **Web push** if allowed (the PWA asks on the first "Leave it building"). No email in v1.
- **After the first build:**
  - **Suggest more Views / Ask for a specific View** run the skim or View stage. The new View and any new Concepts or Relationships it needs are created **directly** (one undoable Change). Changes to existing Concepts arrive as a **Proposal**.
  - **A Source added later** is segmented and extracted, and what it adds (new Concepts, Relationships, provenance on matched Concepts) arrives as **one Proposal**. Existing Views are not rebuilt.
- **The prompts themselves** (decomposition heuristics) are still [Seeding workflow from chats and docs](02-seeding-workflow.md).

**Amended by the user (2026-09-25): whose key is an instance setting.** An instance runs in one of two modes, set by the operator in env config:
- **Instance key:** the operator provides API keys (per provider) used for everyone's AI actions.
- **Bring your own key:** each reader adds their own; this was the default above.

This applies to self-hosted and hosted instances alike. Usage caps or quotas on a shared instance key are **deferred to v2**; v1 has only the per-build estimate and spending cap. The UI's "Uses your API key" copy follows the mode.

## Reopened and amended (2026-09-28): a curator agent, not a stage chain

Reopened after [Seeding workflow from chats and docs](02-seeding-workflow.md) showed that a staged pipeline loses judgement: each stage lacks context the others have. A curator agent working through validated tools matched the hand-made Expeditions in the user's review. The user agreed to replace the stage design. **What changes:**

- **Builder:** one **curator agent** per build (AI SDK 7 `ToolLoopAgent`; on desktop or self-host it can later run as a harness "agent mode"). It works like this:
  1. Reads the whole Source set when it fits in context. Chunking (segment → chunk → merge) is only the fallback for Sources that don't.
  2. Writes an *understanding* note: what the reader wanted, what they decided, what's still open.
  3. Builds Concepts and Views through **tools**, not free-form JSON: `concept.create/update`, `relationship.add/remove`, `attribute.define`, `view.build`, `view.inspect`.
  4. Self-reviews each View against its question before committing it.
- **Guardrails live in the tools.** Every tool call validates against the `packages/domain` Zod schemas. `view.inspect` returns what a reader would see plus the **checks**:
  - structure: dangling ids, one parent each, column fill ≥ 70% after filling, priority on every criterion, `chosen` only with a cited reader decision, no lever→lever links;
  - **layout metrics** from the real layout code: crossings, edges through nodes, cross-topic prerequisites.

  A View can't be committed while it has problems. The agent may reshape structure to fix layout, but never sets positions.
- **The playbook:** the seeding prompts become the agent's instructions (`packages/ai/playbook/`), shared with the MCP `umbel-learn` skill.
- **Unchanged from the first resolution:**
  - Inputs, and segment-level provenance.
  - The **fast skim** that proposes Views on Choose Views within ~10–20 s (still a separate, fast call).
  - **Per-View commits and retries.** Each View the agent finishes is committed as its own Change and streams to the canvas, and a failed View retries on its own.
  - Extraction commits as a Change.
  - Overviews for all Concepts, and articles for core Concepts, written after the structure by writer calls, which can run in parallel.
  - Keys (instance key or bring-your-own), the estimate and spending cap, cancel, notifications, and Proposals for later Sources and for edits to existing Concepts.
- **Models:** a fast model for the skim; a **strong model for the curator** (the structure is where judgement pays); writer calls can use a mid-tier model. The defaults per provider are still overridable.
- **Runner:** unchanged. `JobRunner` (CF Workflows / pg-boss) runs the agent loop in steps, checkpointing after each committed View, so a restart resumes from the last commit. Progress goes to the Relay as before.
- **Cost:** a long-context agent with prompt caching. The estimate covers the agent's reads, its tool loop and the writers. The spending cap pauses the loop, as before.
