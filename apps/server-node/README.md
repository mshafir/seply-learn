# @seply/server-node

**Lane:** B: Server & infra

## Contract

Self-host entry: Node + Hono serving the SPA and API, in-process rooms with LISTEN/NOTIFY, pg-boss JobRunner (M6).

Today: `scripts/real-build.ts` (WP-3.5b), which runs a real `build` job on a committed public fixture (`research-doc`, `ebike-chat`) against Postgres on the in-process engine, with the instance key from `apps/worker/.dev.vars`, and writes the resulting Expedition (our JSON) and a summary (Views, counts, `view.inspect` results, gateway-billed cost, time) to `packages/ai/fixtures/builds/`. It spends real money, so it is never part of `pnpm test`. `--crash-at-view n` simulates a runtime restart as View n starts (then wakes the job); `--kill-at-view n` exits the process there, and `--resume <jobId>` Retries it. Usage is at the top of the script.

## Allowed dependencies

@seply/server, @seply/ai, @seply/domain, and @seply/views only for `@seply/views/inspect` (the curator's ViewReader; spec §2.1). See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
