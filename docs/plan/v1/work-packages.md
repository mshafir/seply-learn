# Work packages

Each package is sized to about one agent session. The format is parsed by `make_issues.py`: a `### WP-<id>: <title>` heading, then `lane`, `milestone`, `depends`, `spec` lines, then **Build** and **Done when** lists. "Done when" always includes: CI green (typecheck, lint, unit, e2e for the touched screens in light and dark), the package README updated, and no private data in fixtures.

## M0: Foundations and risk spikes

### WP-0.1: Monorepo scaffold and agent conventions
- lane: B
- milestone: M0
- depends: owner checklist
- spec: 02-architecture.md#21-monorepo
- **Build:**
  - pnpm + Turborepo, `mise.toml` (Node LTS, pnpm).
  - `shadcn init -t vite --monorepo` for `apps/web` + `packages/ui`.
  - Empty `packages/{domain,sync,server,ai,views,config}` and `apps/{worker,server-node}`, with the dependency rule enforced (eslint boundaries).
  - Root `CLAUDE.md` and package READMEs per the [plan](README.md#repo-conventions-set-up-in-wp-01).
  - `.gitignore` for private data.
  - The prototypes move under `prototypes/` unchanged.
- **Done when:** `pnpm i && pnpm turbo typecheck lint test` passes on a clean clone; `CLAUDE.md` links the glossary, spec, View Types and plan; a statins grep over tracked files is empty.

### WP-0.2: CI and per-PR previews
- lane: B
- milestone: M0
- depends: WP-0.1
- spec: 02-architecture.md#210-deployment
- **Build:**
  - GitHub Actions: typecheck, lint, Vitest, Playwright.
  - Wrangler deploys a hello-world Worker (SPA assets + `/api/health` reading Postgres through Hyperdrive).
  - Per PR, a Neon branch plus a preview Worker URL posted as a PR comment, torn down on close.
  - Main deploys to production.
- **Done when:** a PR shows its preview URL; `/api/health` returns the Neon branch name; closing the PR deletes the branch.

### WP-0.3: Design tokens, theme and brand
- lane: D
- milestone: M0
- depends: WP-0.1
- spec: 07-design-system.md
- **Build:**
  - Palette tokens (light and warm charcoal dark), `--suggested`, `--suggested-text`, `--success`, `--kind-*` (12 named hues), `--font-reading`.
  - Fontsource Plex Sans/Mono and Newsreader.
  - ThemeProvider with `resolvedTheme`, no-flash script, System/Light/Dark toggle.
  - Base UI Toast; Typeset prose.
  - `packages/ui/brand` (wordmark and umbel glyph, favicon, PWA icons).
  - `DIVERGENCES.md` skeleton listing the 8.
- **Done when:** a Storybook-less showcase route renders every token and component in both themes; a contrast test asserts the palette's minimums (text ≥ 4.5, suggested fills ≥ 3).

### WP-0.4: Domain schema, ops and apply
- lane: A
- milestone: M0
- depends: WP-0.1
- spec: 01-domain-model.md
- **Build:**
  - Drizzle schema (Postgres) for every table in §1.2.
  - Op kinds and Zod schemas (§1.3); a pure `apply(state, op)`.
  - Changes (grouping, coalescing), undo-per-Change semantics (skip fields changed since), restore as inverse ops, Merge, tombstone cascade.
  - Built-in Kinds and Relationship Types.
  - View Type Zod settings schemas (shared and personal) for all 11 types, ported from the prototype `types.ts`, with the per-View overrides (`placement`, `order`, `hide`, `fold`); path-level `view.set`.
  - A permissions table as code.
- **Done when:** unit tests cover every op kind, undo with a later edit kept, restore, Merge (including overrides and alias), delete/restore cascade, path-level settings edits, and the permissions matrix; the committed sample JSON (compute) and generated fixtures load through a converter.

### WP-0.5: Spike: op engine + TanStack DB optimistic flicker
- lane: A
- milestone: M0
- depends: WP-0.4
- spec: 02-architecture.md#23-sync-op-log-pushpull-client-store
- **Build:** a minimal op engine (confirmed + pending ops, rebase) feeding TanStack DB collections through custom `sync`; a test page that edits fast and simulates server echo and reorder.
- **Done when:** a written verdict in `packages/sync/SPIKE.md` (flicker or not, and the chosen mitigation); if TanStack DB fails, a recommendation brought to the owner before M1.

### WP-0.6: Canvas foundation, layouts and layout metrics
- lane: C
- milestone: M0
- depends: WP-0.1
- spec: 04-views.md#43-layout-rules-canvas-views
- **Build:**
  - Port the prototype canvas (React Flow 12, node component, floating edges, bands, animated transitions) and the layouts: ELK Learning path (visible-only, topic blocks), Cause & Effect (risk ranked column + acts-on chip + trace; mechanism band), Evidence, Lineage.
  - Port `layout-metrics.ts` as a library function.
- **Done when:** a fixture page renders the compute sample Views like the prototype (Playwright screenshots); the metrics report "reads well" on the hand-made fixtures.

## M1: Walking skeleton on Cloudflare

### WP-1.1: Server app, auth and database
- lane: B
- milestone: M1
- depends: WP-0.2, WP-0.4
- spec: 02-architecture.md#22-backend-one-hono-app-two-entrypoints
- **Build:** a Hono app factory; Better Auth (Google) with the Drizzle adapter per request; migrations; the Worker entry; the Expedition/collaborator basics (create, list mine).
  - **Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `BETTER_AUTH_SECRET` (repo secrets, already set by the owner). The deploy workflow copies them into each Worker as Worker secrets (`wrangler secret bulk`), and sets `BETTER_AUTH_URL` to that Worker's own URL. Local dev reads them from `apps/worker/.dev.vars` (gitignored).
  - **Previews sign in through production** with Better Auth's OAuth proxy plugin: Google allows no wildcard redirect URIs, so Google always calls back to production's `/api/auth/callback/google`, and production hands the session back to the preview that started the sign-in. The Google client lists only production and localhost (`docs/ops/deploy.md`).
- **Done when:** sign-in with Google works on a preview (through the proxy) and on production; an e2e test signs in with a test account (a credentials provider enabled only in CI).

### WP-1.2: Push/pull and the op log
- lane: A
- milestone: M1
- depends: WP-1.1
- spec: 02-architecture.md#23-sync-op-log-pushpull-client-store
- **Build:** `POST /push` (role check, Zod validation, `server_seq`, append + apply in one transaction, idempotent `op_id`) and `GET /pull?since=`; a `Relay.published` no-op stub.
- **Done when:** unit tests on the apply path; an e2e test where two browser contexts edit and see each other's edits after a pull.

### WP-1.3: Sync client
- lane: A
- milestone: M1
- depends: WP-0.5, WP-1.2
- spec: 02-architecture.md#23-sync-op-log-pushpull-client-store
- **Build:** the op engine (pending ops mirrored to IndexedDB), TanStack DB collections per table, `mutationFn` → ops, rebase on pull, Change coalescing on the client.
- **Done when:** a reload with pending ops loses nothing; conflicting field edits resolve last-writer-wins, as tested.

### WP-1.4: Import JSON (first-build path) and fixtures
- lane: A
- milestone: M1
- depends: WP-1.2
- spec: 01-domain-model.md#19-export-and-import
- **Build:** import our JSON as a new private Expedition via one "Imported from file" Change (validate, upgrade by `schemaVersion`, re-mint ids); convert the committed compute sample and the generated research-doc Expedition into fixtures. **No personal chats or graphs** (see the plan's private-data rule).
- **Done when:** importing each fixture yields the same Concept, Relationship and View counts as the source file.

### WP-1.5: App shell, Library list and the Expedition screen frame
- lane: D
- milestone: M1
- depends: WP-0.3, WP-1.3
- spec: 03-screens-and-flows.md
- **Build:** routes; a basic Library (your Expeditions); the Expedition screen's three panes (Views rail, canvas, side panel as a Sheet on narrow widths); the floating View button; a header with the title and account menu (theme toggle).
- **Done when:** Playwright screenshots match the canvas layout proportions (272/440 px panes) in both themes.

### WP-1.6: First two Views wired to data
- lane: C
- milestone: M1
- depends: WP-0.6, WP-1.3
- spec: 04-views.md
- **Build:** Learning path (canvas) and Comparison Table (bands, "?" cells, a must-have fail tint) reading live collections; View switching with animation.
- **Done when:** the imported compute fixture renders both Views (a synthetic options table covers the Comparison Table); an edit in another tab reflows after a pull.

### WP-1.7: Side panel reading
- lane: D
- milestone: M1
- depends: WP-1.5
- spec: 03-screens-and-flows.md#37-side-panel-reading-and-editing-canvas-04
- **Build:** summary → overview → article with a back stack; Typeset markdown with `#c/<id>` links navigating the panel; provenance badges (from the Source / background); Relationships in both directions with inverse labels; Attributes, Tags, aliases.
- **Done when:** e2e opens a Concept, follows an in-text link, goes back, and sees the provenance badges.

## M2: Read

### WP-2.1: Graph View renderers
- lane: C
- milestone: M2
- depends: WP-1.6
- spec: 04-views.md#41-view-types-in-v1
- **Build:** Cause & Effect (both modes), Evidence, Lineage, and Anatomy as live Views, including the trace and "acts on" chips.
- **Done when:** fixture Views render and layout metrics read well; clicking a lever lights its real path.

### WP-2.2: Non-graph View renderers
- lane: C
- milestone: M2
- depends: WP-1.6
- spec: 04-views.md#41-view-types-in-v1
- **Build:** Outline (tree, per-View placement/order/hide), Quadrant (with the progression ladder), Rates (log scale).
- **Done when:** fixture Views render in both themes and match the prototype screenshots.

### WP-2.3: Map and Timeline
- lane: C
- milestone: M2
- depends: WP-1.6
- spec: 07-design-system.md#74-dark-mode
- **Build:** MapLibre with our PMTiles (a script that extracts and uploads to R2, measuring and recording the size), Protomaps light/dark, a bundled coarse world, HTML-marker pins, OpenFreeMap as a fallback URL; vis-timeline with lanes, spans, fuzzy dates, and the dark override sheet.
- **Done when:** a **synthetic public trip fixture** (written in this WP) renders Map and Timeline in both themes, as does the compute Timeline; blocking the tile host still shows the coarse layer with a note.

### WP-2.4: View panel and settings
- lane: D
- milestone: M2
- depends: WP-1.5, WP-0.4
- spec: 04-views.md#42-a-views-parts
- **Build:** the View panel with forms generated from the Zod schemas (shared for editors, personal for everyone), "Duplicate", "Read the View Type" (renders the `docs/view-types` file), and the floating status chip.
- **Done when:** changing a shared setting syncs to another tab; a personal setting doesn't.

### WP-2.5: Reading status and Continue reading
- lane: A
- milestone: M2
- depends: WP-1.3
- spec: 01-domain-model.md#17-per-reader-state
- **Build:** the per-reader tables and API, the reader channel, the Reading status control and checks in every View, Learning path/Outline skipping and "Hide what I've read", reader position and Continue reading, anonymous IndexedDB state with merge on sign-in, the offline mark queue.
- **Done when:** e2e covers marking read on one device (context) and seeing it on another, plus an anonymous read → sign in → state kept.

### WP-2.6: Search
- lane: B
- milestone: M2
- depends: WP-1.2
- spec: 02-architecture.md#28-search
- **Build:** tsvector columns and triggers, GIN and pg_trgm; a global search API with access enforced in SQL; the Library command dialog (grouped results, `#tag`, a public toggle); client-side search inside an Expedition with canvas highlighting.
- **Done when:** unit tests on the query builder, including an access test that a private Expedition never appears for a stranger; e2e search from the Library and inside an Expedition.

### WP-2.7: Library complete, thumbnails and PWA offline reading
- lane: D
- milestone: M2
- depends: WP-2.5
- spec: 03-screens-and-flows.md#32-library-canvas-01
- **Build:** Continue reading, Shared/Drafts/Tags; cards with View Type thumbnails, avatars and counts; the PWA manifest and service worker; the IndexedDB cache of the last ~10 plus pinned Expeditions; the offline read-only chip.
- **Done when:** e2e opens an Expedition, goes offline and reloads, and reads it with the chip showing.

## M3: Create

### WP-3.1: Sources and segmentation
- lane: B
- milestone: M3
- depends: WP-1.2
- spec: 05-ai.md#52-building-an-expedition
- **Build:** uploads to R2 (25 MB cap) and paste/prompt Sources; parsers for chat exports (ChatGPT, Claude, Gemini), PDF, DOCX, MD, TXT, HTML; segmentation (port `segment.py`, with speaker detection for pasted chats); segments stored as blobs; a Source viewer that jumps to a segment.
- **Done when:** unit tests per format using **synthetic public transcripts and files** written in this WP, plus the research doc; never the owner's chats; a provenance link opens the right turn.

### WP-3.2: JobRunner and build relay events
- lane: B
- milestone: M3
- depends: WP-1.1
- spec: 02-architecture.md#25-jobs-builds-and-long-ai-work
- **Build:** the `JobRunner` interface; a Cloudflare Workflows implementation (steps, retries, checkpoint per commit, cancel); the Expedition Durable Object room, minimal (`hello`, `build`, `poke`); web push subscription and delivery.
- **Done when:** a fake multi-step job survives a forced step failure and a Worker restart, and its progress events reach the browser.

### WP-3.3: AI plumbing: providers, keys and cost
- lane: E
- milestone: M3
- depends: WP-1.1
- spec: 05-ai.md#56-keys-cost-and-limits
- **Build:** per-request providers; the instance-key vs bring-your-own-key mode from env (the hosted instance key is a Vercel AI Gateway key, `AI_GATEWAY_API_KEY`, already a repo secret; the deploy copies it into production and preview Workers, and the AI SDK's `gateway` provider reads it); AES-GCM key storage under the master key with a Settings UI (last 4, Test, Delete); default models per provider and stage, overridable; token estimation and cost estimate; spending cap accounting per build and per ask.
- **Done when:** unit tests show keys are never returned by any API and round-trip encryption works; the estimate is within ±30% of actual on the fixtures.

### WP-3.4: Skim and the create flow screens
- lane: E
- milestone: M3
- depends: WP-3.1, WP-3.3
- spec: 03-screens-and-flows.md#33-create-sources-canvas-02a
- **Build:** the Sources screen (paste, drop zone, prompt, goal chips, estimate); the skim (port `skim.md`, reading the View Type catalog from `docs/view-types`); the Choose Views screen (cards, suggest more, ask for a specific View, live Concept counter); Save draft.
- **Done when:** on synthetic chats and the research doc the skim returns 4–8 Views within 20 s, with valid ids and View Types.

### WP-3.5a: Curator tools and checks
- lane: E
- milestone: M3
- depends: WP-0.4, WP-0.6
- spec: 05-ai.md#53-tools-and-checks
- **Build:** the agent tools (`concept.*`, `relationship.*`, `attribute.define`, `view.build`, `view.inspect`, `source.read`, `search_existing`) over the domain Zod schemas, writing staged ops; `view.inspect` returns the reader rendering plus structure checks (port `validate.py`) plus layout metrics, with commit blocked on problems.
- **Done when:** the checks reproduce the prototype's findings on committed fixtures (e.g. flags a cluttered Learning path; flags `chosen` without a cited decision on a synthetic case).

### WP-3.5b: Curator agent loop and per-View commits
- lane: E
- milestone: M3
- depends: WP-3.5a, WP-3.2
- spec: 05-ai.md#52-building-an-expedition
- **Build:** the playbook in `packages/ai/playbook/` (moved from `prototypes/seeding/prompts/`); a `ToolLoopAgent` curator (whole Source, or chunk-and-merge fallback), the understanding note, the Concept-set Change, then per-View build, self-review, and commit as its own Change, with preview nodes streamed as `build` events and a plain failure reason; resume from the last commit.
- **Done when:** on the research doc and a synthetic chat, the build completes and every View passes `view.inspect`; killing the job mid-build and resuming produces no duplicate Views. **Owner review** of the output quality is required (no AI eval set).

### WP-3.6: Writers
- lane: E
- milestone: M3
- depends: WP-3.5b
- spec: 05-ai.md#52-building-an-expedition
- **Build:** batched writers (port `write.md`) for summaries and overviews for all Concepts, then articles in sections for core Concepts, with provenance per section, committed in batches; the "Write the article" action.
- **Done when:** every Concept has an overview and core Concepts have articles; every provenance ref resolves to a real segment.

### WP-3.7: Building UX
- lane: D
- milestone: M3
- depends: WP-3.2, WP-1.5
- spec: 03-screens-and-flows.md#35-building-canvas-02c-02d-02e
- **Build:** the rail's build statuses, skeletons per View Type, streaming nodes into reserved slots, first-ready auto-open, toasts, failed-View card (Retry / another View / Remove), Cancel, the spending-cap pause (Continue/Stop), "Leave it building" with a web push prompt, the header activity indicator.
- **Done when:** e2e with a stubbed job covers queued → building → ready/failed → retry.

## M4: Grow and collaborate

### WP-4.1: Live relay and presence
- lane: B
- milestone: M4
- depends: WP-3.2, WP-1.3
- spec: 02-architecture.md#24-live-relay-v1
- **Build:** the full room protocol (`ops`/`poke` after push, presence at 10–20 Hz, `leave`, `kick`, agent presence with TTL), a hibernating Durable Object, partysocket on the client, avatars and live cursors, and anonymous `ops`-only subscription.
- **Done when:** e2e with two contexts shows live edits without a pull, cursors appearing, and presence clearing on close.

### WP-4.2: History: Changes, undo, view as of, restore
- lane: A
- milestone: M4
- depends: WP-1.3
- spec: 01-domain-model.md#14-history-changes-undo-restore-fork
- **Build:** the History panel (Changes with author, label, time), Undo (reporting kept edits), View as of (a read-only replay), Restore to here.
- **Done when:** e2e where user A edits, user B edits the same Concept, A undoes, and B's edit is kept and reported.

### WP-4.3: Proposals and the Suggestions tab
- lane: A
- milestone: M4
- depends: WP-4.2
- spec: 01-domain-model.md#15-proposals
- **Build:** Proposal storage and API; the op engine's preview overlay (dashed in `--suggested`); the Suggestions tab grouped by ask; accept/dismiss per item and Accept all, with dependencies included and shown; stale detection with a both-versions view; one Change per review action; a toast for new MCP Proposals.
- **Done when:** unit tests on stale detection and dependency inclusion; an e2e accept/dismiss/undo round trip.

### WP-4.4: Grow
- lane: E
- milestone: M4
- depends: WP-4.3, WP-3.5b
- spec: 05-ai.md#55-grow-in-app-ai
- **Build:** the "Ask about this Expedition" box and the Concept actions (missing prerequisites, examples, article, related); the curator agent scoped to the ask, writing to one Proposal and streaming `data-proposal` parts; new Concepts arrive with summary and overview; Stop; the per-ask cap; the Activity list.
- **Done when:** "What would I need to understand QLoRA?" on the compute fixture streams dashed items that can be accepted. **Owner review.**

### WP-4.5: Editing in place, Merge and structure
- lane: D
- milestone: M4
- depends: WP-1.7, WP-0.4
- spec: 03-screens-and-flows.md#37-side-panel-reading-and-editing-canvas-04
- **Build:** inline editing of fields, sections and Relationships; Kind/Relationship Type/Attribute management (reassign-before-remove); "Merge with…"; re-parent with "Just this View" vs "Everywhere"; per-View hide and order; best View selection.
- **Done when:** e2e merges two Concepts (aliases, Relationships and reading status carried over) and re-parents in one View without affecting another.

## M5: Share

### WP-5.1: Collaborators, invites and permissions
- lane: B
- milestone: M5
- depends: WP-1.1
- spec: 01-domain-model.md#18-visibility-roles-permissions
- **Build:** the permissions matrix enforced in every API route; the share dialog (invite as editor or viewer); the `Mailer` (Resend when hosted); the invite link; the "Shared with you" inbox with a New badge; owner-only role changes and removal; transfer ownership; kick over the relay.
- **Done when:** unit tests run the permissions matrix against the API routes; e2e invites a second account and shows it under Shared with you.

### WP-5.2: Visibility, public links, Fork and Trash
- lane: B
- milestone: M5
- depends: WP-5.1
- spec: 03-screens-and-flows.md#39-history-and-sharing-canvas-06-amended
- **Build:** private/unlisted/public with the Sources warning; anonymous viewing of a live latest state; public listing in search; Fork (current state or as of a Change, a fresh log, Sources copied); owner delete to Trash with 30-day purge and restore.
- **Done when:** e2e has an anonymous user open an unlisted link, see a live edit, and be unable to write; a Fork has a fresh history.

### WP-5.3: Export and import UI
- lane: A
- milestone: M5
- depends: WP-1.4
- spec: 01-domain-model.md#19-export-and-import
- **Build:** JSON export (with optional Source files) and a Markdown folder export (zip), plus an import button in the Library.
- **Done when:** the round trip export → import preserves counts, and the Markdown folder opens in Obsidian with working links (checked by a link test).

### WP-5.4: MCP server and the `umbel-learn` skill
- lane: B
- milestone: M5
- depends: WP-5.1, WP-3.5a
- spec: 06-mcp.md
- **Build:**
  - `/mcp` with streamable HTTP; Better Auth OAuth (CIMD) and API tokens; scopes and per-Expedition restriction; the tools in §6.2, sharing definitions with the curator tools; agent presence.
  - The skill as a Claude Code plugin with a marketplace entry, mirrored in the server instructions.
- **Done when:** Claude Code connects, lists Expeditions, runs `create_expedition` from a chat, and has its `propose_changes` show up in Suggestions.

## M6: Self-host

### WP-6.1: Node entry
- lane: B
- milestone: M6
- depends: WP-4.1, WP-3.2
- spec: 02-architecture.md#210-deployment
- **Build:** `apps/server-node` serving the SPA and API, in-process rooms + LISTEN/NOTIFY, pg-boss JobRunner, local-volume/S3 blobs, optional SMTP Mailer, email+password auth, env-only config.
- **Done when:** the e2e suite passes against the Node entry, and two instances share live edits through NOTIFY.

### WP-6.2: Docker image, compose and docs
- lane: B
- milestone: M6
- depends: WP-6.1
- spec: 02-architecture.md#210-deployment
- **Build:** a multi-stage image, `docker-compose.yml` (app + Postgres, optional MinIO), and a self-host guide (keys mode, SMTP, PMTiles download and extract).
- **Done when:** `docker compose up` on a clean machine reaches sign-in, imports a fixture, and builds one Expedition with an instance key.
