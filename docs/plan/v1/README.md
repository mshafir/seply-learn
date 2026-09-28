# Umbel Learn v1: implementation game plan

How the [v1 spec](../../spec/v1/README.md) gets built. It was decided in [Implementation game plan](../../wayfinder/mindmaps-v1/tickets/19-implementation-game-plan.md). The work packages are in [work-packages.md](work-packages.md), and `make_issues.py` turns them into GitHub Issues.

## How we build

- **Builders:** Claude agents, **3–4 lanes in parallel**, each working in its own git worktree on a branch and opening a PR.
- **Tracking:** a private **GitHub repo**, with **Issues** (one per work package, generated from `work-packages.md`) and a **Project board** by milestone and lane. This plan is the source of truth. Issues track progress, and changes to scope go through a PR to this file.
- **Every PR** passes CI: typecheck, lint, Vitest units and Playwright e2e for the screens it touches (light and dark). Each PR also gets:
  - an automated code-review pass
  - a **preview Worker plus its own Neon branch** (from M0.2)
- **The owner reviews:**
  - at each **milestone demo**
  - on any PR that touches the **data model and ops, auth and permissions, or AI prompts and playbook**, which are labelled `needs-owner`
- **Testing is deliberately light:** unit tests plus e2e. There is **no Postgres integration layer and no AI eval set**. The accepted risk is that sync, permissions and prompt regressions surface in e2e or review rather than in dedicated suites. The curator agent's `view.inspect` checks still guard every build at runtime.
- **Private data: the repo is public.** Only non-personal material is committed. The following **never enter the repo, fixtures or CI** (enforced by `.gitignore`):
  - the statins chat and everything derived from it;
  - the owner's raw chats (`prototypes/seeding/sources/`) and seeding runs;
  - the printer and family-trip graphs.

  **Committed fixtures:** the hand-made **compute** sample, the generated compute and research-doc Expeditions, and `docs/research/knowledge-graph-learning-tools.md` as a document Source. **Synthetic, public fixtures are written where a View needs more,** for example a located trip for Map (WP-2.3) and a small chat transcript for chat parsing (WP-3.1).

## Repo conventions (set up in WP-0.1)

- **Root `CLAUDE.md`:**
  - what Umbel Learn is
  - links to [`CONTEXT.md`](../../../CONTEXT.md), the spec, `docs/view-types/` and this plan
  - the one-way package dependency rule (`domain ← sync ← views/ui ← web`; `domain ← server/ai`)
  - "prebuilt shadcn/Base UI first; every divergence goes in `packages/ui/DIVERGENCES.md`"
  - "use the glossary's words in code"
  - how to run checks; branch, commit and PR conventions
  - "spec changes happen by PR to `docs/spec`, never silently in code; hard-to-reverse choices get an ADR in `docs/adr/`"
- **Each package's `README.md`** states its public contract (exports, invariants) and its owning lane.

## Lanes

| Lane | Owns | Notes |
|---|---|---|
| **A: Data & sync** | `packages/domain`, `packages/sync` | **Serial critical path in M0–M1**: schema, ops, apply, push/pull. Other lanes build against its contracts. |
| **B: Server & infra** | `packages/server`, `apps/worker`, `apps/server-node`, CI, deploys | |
| **C: Views** | `packages/views` | Renderers, layouts, layout metrics |
| **D: App & UI** | `packages/ui`, `apps/web` | Screens, design system |
| **E: AI** | `packages/ai` | Starts in M3. It replaces lane C's slot once M2's Views land. |

## Milestones

| M | Name | Demo at the end |
|---|---|---|
| **M0** | Foundations and risk spikes | A monorepo that deploys a preview per PR; tokens and dark mode; domain ops with tests; the TanStack DB flicker spike answered; layouts and metrics ported |
| **M1** | Walking skeleton on Cloudflare | Sign in with Google; import a sample Expedition from JSON; open it; switch between Learning path and Comparison Table; read Concepts in the side panel; edits sync between two tabs (by pull) |
| **M2** | Read | All 11 View Types; View panel (shared and personal settings); Reading status and Continue reading; search; thumbnails and Library; offline read cache (PWA) |
| **M3** | Create | Paste a chat or upload files → skim → Choose Views → the curator agent builds Views one by one, streaming in, with failure and retry; overviews and articles; bring-your-own-key and instance key modes; web push |
| **M4** | Grow and collaborate | Live presence and cursors; History with undo, view as of, restore; editing in place and Merge; per-View overrides; Proposals and the Suggestions tab; Grow asks and Concept actions |
| **M5** | Share | Roles and invites (email, link, inbox); Visibility and live public links; Fork; Trash; export and import; the MCP server, OAuth and the `umbel-learn` skill |
| **M6** | Self-host | A Node image with docker compose: in-process rooms + LISTEN/NOTIFY, pg-boss, volume/S3 blobs, optional SMTP, email+password auth; PMTiles instructions |

Desktop (Electron, local-first) is phase 2. See [Phase 2 sketch](../../spec/v1/08-phase-2.md).

## Owner checklist before M0 (a task only the owner can do)

- [ ] **GitHub:** a private repo, with the agent's `gh` authenticated. Push the current tree, and exclude `prototypes/seeding/sources/`, `runs/statins-chat/` and any `gen-statins*` files (see WP-0.1).
- [ ] **Cloudflare:** a Workers Paid account, plus an API token for CI (Workers, R2, Durable Objects, Workflows, Hyperdrive).
- [ ] **Neon:** a project, plus an API key for CI branch creation.
- [ ] **Google OAuth:** a client ID and secret (hosted login).
- [ ] **Email:** a Resend account and API key (invites), or say which provider to use instead.
- [ ] **AI keys** for development and for the instance-key mode on the hosted instance (e.g. Anthropic).

## Unlock order

```
M0: 0.1 ─┬─ 0.2 (B)
         ├─ 0.3 (D)
         ├─ 0.4 (A) ── 0.5 (A)
         └─ 0.6 (C)
M1: 0.2+0.4 → 1.1 (B) → 1.2 (A) → 1.3 (A) → 1.5 (D), 1.6 (C) → 1.7 (D);  1.2 → 1.4 (A)
M2: everything after M1, fully parallel across A–D
M3: 3.1 (B) ‖ 3.2 (B) ‖ 3.3 (E) → 3.4 (E) → 3.5a (E) → 3.5b (E) → 3.6 (E);  3.7 (D) after 3.2
M4: 4.1 (B) ‖ 4.2 (A) ‖ 4.5 (D) → 4.3 (A) → 4.4 (E)
M5: 5.1 (B) → 5.2 (B/D) ‖ 5.3 (A) ‖ 5.4 (B/E)
M6: 6.1 (B) → 6.2 (B)
```
