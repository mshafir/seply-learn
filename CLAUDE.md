# Seply Learn: notes for agents

Seply Learn (Seply is the umbrella for Learn, Plan and Work; previously Umbel Learn; branding in [spec 7.5](docs/spec/v1/07-design-system.md#75-branding)) is a collaborative, LLM-assisted tool for building, curating and exploring **Expeditions**: bodies of knowledge on one subject, built from Sources, split into Concepts and Relationships, and read through Views.

## Read before you build

1. **[`CONTEXT.md`](CONTEXT.md):** the glossary. Use its words in code, UI copy and docs: Expedition (never Graph), Concept (never node), View (never pivot), Change (never snapshot or version), Proposal. Reader-facing copy says "suggestions".
2. **[`docs/spec/v1/`](docs/spec/v1/README.md):** the build spec. Every section links the decision ticket behind it.
3. **[`docs/plan/v1/`](docs/plan/v1/README.md):** milestones, lanes and work packages. Each GitHub Issue is one work package; do only what its **Build** list says and meet its **Done when**.
4. **[`docs/view-types/`](docs/view-types/README.md):** View Type definitions. They are part of the spec, and the AI playbook reads them.

## Rules

- **Package dependencies run one way:** `domain ← sync ← views/ui ← web`, `domain ← ai ← server`, and apps compose packages. `pnpm check:deps` enforces it. To change the rule, change the spec first.
- **The UI uses prebuilt shadcn (Base UI) components first.** Anything custom is a divergence and must be listed in `packages/ui/DIVERGENCES.md`, with why and what it's built from. Colours come from tokens, never hex values in components.
- **Layouts are always computed.** Never store node positions. Views shape their layout through settings.
- **AI never writes shared content silently.** Only first builds and explicitly requested Views write directly; everything else becomes a Proposal.
- **Spec changes happen by PR to `docs/spec`,** never silently in code. A hard-to-reverse, surprising choice gets an ADR in `docs/adr/`.
- **This repo is public. Private data never goes in:** no personal chats, no statins data, no family details. Fixtures are the committed compute sample, the research doc, or synthetic data you write. `pnpm check:private` must pass.

## Working

- **Tools:** `mise` provides Node and pnpm (`mise exec -- pnpm …`).
- **Cloud sessions (claude.ai/code):** the SessionStart hook in `.claude/settings.json` runs `scripts/claude-remote-setup.sh`, which installs mise, Node, pnpm, dependencies and Chromium. It does nothing locally. Each cloud session has its own VM, so the laptop limits below don't apply there. The PR rules do.
- **Resources (builders share one 14 GB laptop):**
  - At most **two builder lanes run locally at once**, and only one of them runs Playwright at a time.
  - While iterating, check only what you touch: `mise exec -- pnpm turbo typecheck lint test --filter=<package>...`. Run the full `pnpm check` once, before the PR. It already caps Turbo and Vitest at two workers each; locally Playwright uses one.
  - Run e2e only for the screens you changed; CI runs the whole suite.
  - Stop every dev server, `wrangler dev`, `vite preview` and watcher you start before you finish. Don't start Docker containers.
- **Before every PR:** `pnpm check` (dependency rule, typecheck, lint, tests) and `pnpm check:private`.
- **Branches:** `wp-<id>-<slug>` (e.g. `wp-0.4-domain`). One work package per PR, titled `WP-x.y: <title>`, with `Closes #<issue>` in the body.
- **Owner review:** PRs that touch the data model or ops, auth or permissions, or AI prompts and the playbook get the `needs-owner` label.
- **Commits** end with the Co-Authored-By line the session provides.
- **Package READMEs** state each package's contract. Update them when the contract changes.
- **Prototypes** (`prototypes/`) are reference code outside the workspace. Port from them; don't import them.
