# Local-first sync engine for Electron + Postgres

Ticket: [05 — Local-first sync for Electron and Postgres](../tickets/05-local-first-sync-engine.md). Researched 2026-09-24.

## Requirements, in brief

1. The Electron app works **fully offline**, including **offline writes**, and syncs with a server when one is configured.
2. The server persists to **Postgres** and is **easy to self-host**. The user's own instance runs on **Cloudflare**.
3. v1 records multi-editor sharing **as operations**. Phase 2 adds real-time co-editing without changing the data model.
4. Authorization is **per Graph**: owner/editor/viewer roles, plus public and unlisted reads with no login.
5. **Snapshots** (named, frozen, comparable, restorable) and **Proposals** (pending LLM changes) must map cleanly.

## Options compared

| Option | Maturity (Sep 2026) | License | Self-host | Cloudflare fit | Offline writes | Per-Graph auth | Snapshots / Proposals / op log |
|---|---|---|---|---|---|---|---|
| **ElectricSQL + PGlite** | Sync service 1.8.x, stable. PGlite 0.5.x | Apache-2.0 | Elixir service + Postgres with logical replication | Poor. It needs a long-running server; the only option is Containers (GA Apr 2026) with ephemeral disk. Electric Cloud is hosted | **No write path.** You build writes yourself | "Shapes" filtered by your proxy/auth layer | Read-sync only. The op log, Snapshots, and Proposals are all yours to build |
| **Zero (Rocicorp)** | 1.0 (Jun 2026), stable | Apache-2.0 | zero-cache (Node, SQLite replica) + Postgres with `wal_level=logical` + your API | Poor. It needs a long-running process with a persistent replica file | **No.** Reads work offline; writes are rejected | Good (server-side queries/mutators) | Custom mutators are the op log. Snapshots and Proposals are app tables. The blocker is **offline writes** |
| **PowerSync** | Service v1.26 (Sep 2026), mature, commercial backing | **FSL-1.1-ALv2** (service; becomes Apache-2 after 2 yrs). SDKs are Apache/MIT | Docker service + bucket storage (MongoDB, or Postgres, which is in beta) | Poor. The service is long-running. Containers are possible but not a natural fit | Yes (SQLite upload queue → your backend API) | Good (Sync Streams + JWT). A 2026 bug leaked rows past Sync Stream auth | The upload queue gives you operations. Snapshots and Proposals are app tables. The sync server is source-available, not OSI |
| **LiveStore** | v0.4.0 (Jun 2026), **beta**, breaking changes in minors | Apache-2.0 | Sync backend is pluggable | **Excellent.** First-party Workers + Durable Objects provider (DO SQLite / D1) | Yes (event-sourced, SQLite on the client) | Per-store (one store per Graph); auth is in your Worker | **Best conceptual fit:** the event log *is* the op log. Snapshot = event sequence number. Proposal = event/state. But the canonical log lives in DO SQLite/S2, **not Postgres** |
| **Jazz** | **v2 is alpha** (2.0.0-alpha.56); a rewrite of "classic" Jazz | MIT | Single-tenant server, file/RocksDB storage | Classic had a DO setup. For v2 it is unclear | Yes | Row-level security / groups | Per-row git-like history is nice for Snapshots. **No Postgres.** An alpha rewrite is too risky |
| **Triplit** | Effectively dormant. Acquired by Supabase (Oct 2025); last release Jul 2025, last push Jan 2026 | AGPL-3.0 | Node server | It had a DO backend | Yes | Schema permissions | Don't adopt |
| **CRDT libs (Yjs / Automerge / Loro) + custom Postgres store** | Yjs 13.6.x, Automerge 3 / repo 2.x, Loro 1.16. All mature | MIT (Loro, Automerge); Yjs MIT | You write the server. y-durableobjects exists for CF | Good (DO per document) | Yes | Yours (doc = Graph) | A document blob fights relational Postgres, search, and Proposals. **Best reserved for phase-2 rich-text Concept content** |
| **Hand-rolled op log** | n/a. Well-trodden pattern (Replicache/Linear/Figma-style) | Yours | Trivial: any Node/Workers backend + Postgres | **Excellent.** Worker + Hyperdrive → Postgres; a Durable Object per Graph for live fan-out in phase 2 | Yes (local SQLite + pending-ops queue) | Natural: every op carries a `graph_id` and is checked on push/pull | **Native.** Ops table = history. Snapshot = named `server_seq` (+ materialized copy). Proposal = op batch with `status=pending` |

## Key facts

- **Zero does not support offline writes.** "Reads are allowed while `disconnected`, but writes are rejected." This is a deliberate design choice. [zero docs/offline](https://zero.rocicorp.dev/docs/offline) · 1.0 released Jun 2026, Apache-2 [InfoQ](https://www.infoq.com/news/2026/06/zero-version-1/), [open-source](https://zero.rocicorp.dev/docs/open-source) · zero-cache needs a SQLite replica file + `wal_level=logical`, and deploys to Docker/Fly/SST/K8s [self-host](https://zero.rocicorp.dev/docs/self-host).
- **Electric does no write-path sync.** "Electric does read-path sync… Electric does not do write-path sync." The write patterns (optimistic, through-PGlite) are left to you. [electric.ax/docs/guides/writes](https://electric.ax/docs/guides/writes). Latest `@core/sync-service@1.8.1`, `pglite@0.5.8` (GitHub releases). Electric is also pushing Durable Streams / Electric Cloud [blog](https://electric-sql.com/blog/2026/01/22/announcing-hosted-durable-streams).
- **PowerSync service is FSL, not OSI.** FSL-1.1-ALv2, converting to Apache-2 two years after each release [FSL](https://powersync.com/legal/fsl), [fair source](https://powersync.com/blog/powersync-supports-fair-source). Postgres bucket storage is in beta [announcement](https://releases.powersync.com/announcements/introducing-postgres-for-sync-bucket-storage). An edition-3 bug let Sync Stream auth filters be ignored (fixed 1.23.3) [release](https://releases.powersync.com/announcements/powersync-service).
- **LiveStore** v0.4.0 (2026-06-02) is still beta. Its Cloudflare sync provider uses Durable Objects with DO SQLite by default, and it also offers S2 and Electric providers [changelog](https://docs.livestore.dev/changelog/), [CF provider](https://docs.livestore.dev/sync-providers/cloudflare/). Apache-2.0 (GitHub).
- **Jazz** has shifted to a v2 alpha "local-first relational database". The self-host server uses file/RocksDB storage [jazz.tools](https://jazz.tools/), [server setup](https://jazz.tools/docs/getting-started/server-setup). MIT.
- **Triplit** was acquired by Supabase, which says it is "not to directly integrate Triplit" [Supabase blog](https://supabase.com/blog/triplit-joins-supabase). AGPL-3.0; no release since Jul 2025.
- **Cloudflare primitives:** Containers GA on Workers Paid (2026-04-13) [changelog](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/). Hyperdrive pools Postgres for Workers and is on the Free plan too [docs](https://developers.cloudflare.com/hyperdrive/). Yjs on DO: [y-durableobjects](https://github.com/napolab/y-durableobjects).
- **CRDTs:** Automerge 3 (10x less memory) [blog](https://automerge.org/blog/automerge-3/). The Postgres adapter for automerge-repo is stale. Loro 1.16.3 (Sep 2026), MIT [GitHub](https://github.com/loro-dev/loro).

## Gotchas

- **Every Postgres-replication engine (Electric, Zero, PowerSync) needs a long-running stateful service** next to Postgres. That breaks "easy self-host" (an extra container, logical replication, WAL retention) and fits Cloudflare badly. Containers have ephemeral disk, so replicas rebuild on every cold start.
- **Offline writes are the filter.** Zero fails outright. Electric leaves writes to you, so you still hand-roll the op log and only save the read path.
- **Proposals and Snapshots are domain concepts, not sync features.** No engine gives them to you. They are cheapest when the op log is yours.
- **LiveStore/Jazz keep the canonical history outside Postgres.** Postgres would become a projection, which contradicts the given that "the backend persists to Postgres".
- **Per-Graph auth over logical replication** means translating roles into shape/stream filters. PowerSync's 2026 leak shows how subtle that is. With your own op log, auth is one `graph_id` + role check per push/pull.
- **Hand-rolling costs you:** conflict policy, idempotent op IDs, rebase of pending local ops, and schema migrations of ops. The domain keeps these small: it has few entity types, and the ops are mostly field-level LWW on Concepts/Relationships.

## Recommendation

**Hand-roll a per-Graph operation log.** Use SQLite locally (Electron) and Postgres on the server. Use a Replicache-style push/pull protocol, and put a Durable Object per Graph on Cloudflare for phase-2 live fan-out.

- **Local:** SQLite in Electron. It holds the materialized tables plus a `pending_ops` queue. The app reads and writes locally, and sync is optional.
- **Ops:** `{op_id (uuid/ULID), graph_id, actor, client_seq, kind, payload}`. Examples are `concept.upsert` / `concept.setField` / `relationship.add` / `relType.define`. Ops use field-level last-writer-wins, and deletes are tombstones.
- **Server:** `push` validates role on `graph_id`, assigns a monotonically increasing `server_seq` per Graph, appends to `graph_ops`, and updates the materialized tables in one Postgres transaction. `pull?since=seq` returns the ops. Clients rebase their pending ops.
- **Cloudflare:** a Worker + Hyperdrive → Postgres. In phase 2, a Durable Object per Graph serializes pushes and broadcasts over WebSocket. A self-hosted Node server runs the same logic without DO.
- **Snapshot** = a named `(graph_id, server_seq)`, with an optional materialized copy for fast view and compare. **Restore** = new ops that write that state (history stays append-only).
- **Proposal** = an op batch stored with `status=pending` (and `source=llm|mcp`). Accepting it pushes the batch as normal ops. Auto-Snapshot runs before bulk accepts.
- **Phase-2 rich text:** if Concept markdown needs character-level co-editing, embed a **Loro** (or Yjs) doc *only* in the Concept `content` field. Sync its updates as a special op kind or through the Graph's DO. Graph structure stays relational.

**Runner-up to watch: LiveStore.** Its event-sourcing model and first-party Durable Objects provider match this design almost exactly. Revisit it at 1.0 if a Postgres-backed sync provider appears. **Rejected:** Zero (no offline writes), Electric (read-only, still needs the op log), PowerSync (FSL + extra stateful service + weak CF fit), Jazz (v2 alpha, no Postgres), and Triplit (dormant).
