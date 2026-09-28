---
id: 19
title: Implementation game plan
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: [18]
---

## Question

How will the v1 spec be built? Given (decided 2026-09-25): the **first milestone is the web app on Cloudflare**, every canvas screen is v1 but phased (read → create → grow → share), and the builders are **Claude agents working in parallel** with the owner reviewing. Decide:

- **Milestones,** starting with a walking skeleton (SPA + Hono backend on Cloudflare, auth, one Expedition from a Source, Expedition screen with Views and the side panel), then the phases, then self-host and the desktop app.
- **Work packages** sized to one agent session, each with explicit inputs, outputs, dependencies, and acceptance checks (tests, typecheck, screenshots against the canvas).
- **Parallel lanes** and the order packages unlock in; what must be serial (the data model, the op log).
- **Verification:** the test strategy (unit, integration against Postgres, Playwright), CI, preview deploys, and how the owner reviews agent work.
- **Repo conventions** for agents: CLAUDE.md, per-package docs, where the glossary and View Type docs are linked from.
- Where the plan lives and how progress is tracked once building starts (a new map or tracker).

## Resolution (2026-09-28)

Grilled with the user. The plan is at [`docs/plan/v1/`](../../../plan/v1/README.md): a README (how we build, conventions, lanes, milestones, owner checklist, unlock order), [work-packages.md](../../../plan/v1/work-packages.md) (39 packages, each with lane, milestone, dependencies, a spec link, **Build** and **Done when**), and `make_issues.py` (generates GitHub Issues from it).

- **Tracking and delivery:** the GitHub repo (`mshafir/umbel-learn`), one Issue per work package (generated; the plan stays the source), PRs from agent worktrees, and a Project board by milestone and lane. Every PR gets a preview Worker + Neon branch.
- **Milestones:**
  - M0: foundations and risk spikes (TanStack DB flicker, layouts + metrics)
  - M1: walking skeleton on CF
  - M2: read
  - M3: create (the curator agent)
  - M4: grow and collaborate
  - M5: share (+ MCP)
  - M6: self-host

  Desktop is phase 2.
- **Lanes:** 3–4 in parallel: A data & sync (the serial critical path in M0–M1), B server & infra, C views, D app & UI, E AI (from M3).
- **Review:** an automated check and review pass on every PR. The owner reviews at milestone demos, plus PRs labelled `needs-owner` (data model/ops, auth/permissions, AI prompts/playbook).
- **Testing (user's choice: lighter):** Vitest units and Playwright e2e (light and dark) only. There is **no Postgres integration layer and no AI eval set**. Accepted risk: sync, permission and prompt regressions surface in e2e or review; `view.inspect` still guards builds at runtime, and the AI work packages require owner review of output quality.
- **Conventions:** a root `CLAUDE.md` (glossary, spec, View Types, plan, the dependency rule, prebuilt-first + DIVERGENCES.md, spec-changes-by-PR, ADRs) and per-package README contracts.
- **Private data:** the statins chat and everything derived from it never enter the repo, fixtures or CI. It is enforced by `.gitignore`, and WP-0.1 checks it.
