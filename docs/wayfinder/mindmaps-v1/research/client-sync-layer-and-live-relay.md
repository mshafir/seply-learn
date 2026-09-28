# Client sync layer and live relay

Ticket: [20 — Client sync layer and live relay](../tickets/20-client-sync-layer-and-live-relay.md). Researched 2026-09-25.

Builds on [Local-first sync engine](local-first-sync-engine.md) (hand-rolled op log, Replicache-style push/pull) and [Backend runtime](backend-runtime-cloudflare-and-selfhost.md) (one Hono app, Workers + Node, Hyperdrive → Postgres). The op log and schema are fixed by [Core data model and operation log](../tickets/08-core-data-model-and-operations.md). This file does not revisit them.

## TL;DR

1. **Client store:** our own **op engine** owns the log, the pending queue, rebase and undo. It materializes the shared Drizzle schema into local SQLite (Electron) or memory (web). **TanStack DB** sits on top as the reactive query layer, fed through a custom collection sync. Don't use TanStack's own persistence or offline-transactions packages for Expedition data; our op engine already does that job.
2. **Live relay:** one WebSocket room per Expedition. Push stays HTTP; after the Postgres commit the server tells the room, and the room fans out the ops. The room also carries presence, cursors and View build progress, none of it logged. On Cloudflare the room is a **hibernating Durable Object**. Self-hosted, it is an **in-process room in the Node app**, with **Postgres LISTEN/NOTIFY** for multi-instance fan-out. No Hocuspocus in v1.
3. **Text CRDT (phase 2):** lean **Yjs** over Loro for per-field text. The docs are small, Yjs is ~28 KB gzipped against Loro's ~1 MB gzipped WASM, and Yjs has the most editor bindings. **Neither choice changes the v1 schema.**

## Part 1: client store and sync layer

### What the store must do

- Optimistic field-level ops, with a pending-op queue that survives restarts (Electron).
- Rebase: on pull, apply the server's ops to confirmed state, then re-apply our pending ops.
- Live reactive queries across Views (Concepts + Relationships + Tags + Kinds joined, filtered, sorted).
- Undo per Change (revert only fields still holding that Change's value).
- Materialize the one Drizzle schema, and use the same op-apply code as the server.

### Options compared

| | **TanStack DB** on our op log | **TinyBase** | **Hand-rolled** (Replicache-style over SQLite) |
|---|---|---|---|
| Version (Sep 2026) | `@tanstack/db` 0.9.2, `@tanstack/react-db` 0.4.1 (both 2026-09-14). **Pre-1.0.** Persistence packages are 0.1–0.2 and called "alpha" | `tinybase` 10.0.1 (2026-09-24). Mature, long 1.x→10.x history | n/a. Replicache itself (15.3.0, Jul 2025) is in maintenance and its repo was archived 2026-06-10 |
| Licence | MIT | MIT | Ours. (Replicache: free, under Rocicorp's own terms, not OSI) |
| Bundle (min+gz, my esbuild measure, rough) | ~83 KB for `db` + `react-db` core | ~20 KB for store + queries + `ui-react` | Smallest JS. Web offline needs wa-sqlite WASM anyway |
| React 19 | `react-db` peer `react >=16.8`, `useLiveQuery` | `ui-react` peer `react ^19.3` | Ours (`useSyncExternalStore`) |
| Custom sync | **Yes.** `sync({begin, write, commit, markReady, truncate})` in a collection options creator | Custom persisters and synchronizers exist, but its sync model is its own | Native |
| Optimistic writes + rebase | Built in: optimistic layer over synced state, dropped when the mutation handler resolves | Plain Store has no optimistic layer. MergeableStore merges by per-cell timestamp | We write it (the pattern is well known) |
| Conflict model | None of its own; takes whatever sync writes | **MergeableStore is its own CRDT** (per-cell LWW with hybrid logical clocks). It would compete with our log | Ours (field LWW per 08) |
| History / Changes | None | Checkpoints (local undo only). MergeableStore keeps state, **not an op history** | Ours |
| Live queries | Differential-dataflow engine (`db-ivm`): incremental joins, filters, order, includes | TinyQL queries, relationships, indexes. Joins supported, less expressive | Re-run SQL on table-level invalidation. No incremental joins |
| Offline persistence | SQLite adapters for browser (wa-sqlite + OPFS in a worker, multi-tab via Web Locks + BroadcastChannel), Electron (better-sqlite3 in main, IPC bridge), Node, RN, Tauri, Capacitor, DOs. **Alpha.** Stores collection rows, not our tables | Many persisters (IndexedDB, SQLite incl. `node:sqlite`/better-sqlite3, pg, DO storage). Stores its own tables | Our Drizzle tables in SQLite |
| Durable Object story | DO SQLite persistence adapter | `WsServerDurableObject` + DO storage persister, syncing MergeableStores | Our DO relay |
| Drizzle schema fit | Collections take a Standard Schema. Generate Zod per table with `drizzle-zod` (0.8.3), so row types match the Drizzle types. One collection per table | TablesSchema, via its Zod schematizer. Cells are primitives or (since v8) objects/arrays. Composite keys need synthetic string ids | Direct: the same Drizzle tables, locally |

### Key facts

- **TanStack DB custom sync.** A collection's `sync` receives `begin()`, `write()`, `commit()`, `markReady()` and `markError()`. Writes are buffered until `commit()`, which applies them atomically. Optimistic state stays until the mutation handler resolves; the docs tell handlers to "coordinate sync internally (via await)", e.g. `awaitTxId`. ([custom collection guide](https://tanstack.com/db/latest/docs/guides/collection-options-creator))
- **TanStack DB 0.6 added persistence** (Mar 2026): SQLite adapters for browser, RN/Expo, Node, Electron, Tauri, Capacitor and Durable Objects. "The server remains authoritative." It is "the first alpha release of persistence". Changing `schemaVersion` clears persisted synced collections. They are "working toward v1", with SSR the main open gap. ([TanStack blog](https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes), [Electric blog](https://electric-sql.com/blog/2026/03/25/tanstack-db-0.6-app-ready-with-persistence-and-includes))
- **Browser persistence** is `@tanstack/browser-db-sqlite-persistence` 0.2.23: "wa-sqlite + OPFS", run in a dedicated Web Worker, peer `@journeyapps/wa-sqlite`. Multi-tab is opt-in: a leader tab is elected with Web Locks, and followers forward writes over BroadcastChannel. (package README, npm)
- **Electron persistence** is `@tanstack/electron-db-sqlite-persistence` 0.1.35: better-sqlite3 in the main process, exposed to the renderer over `ipcMain`/`ipcRenderer`. (package README, npm)
- **`@tanstack/offline-transactions`** 1.0.56 is an outbox: it persists the mutation to IndexedDB (localStorage fallback), applies it optimistically, then replays FIFO with retry. Only the leader tab gets offline support; other tabs run online-only. (package README, npm) It overlaps with our `pending_ops` queue, so we don't need it.
- **TinyBase** v10 (Sep 2026) added TinyJoin, SQL Server and libSQL persisters and dropped CR-SQLite, sqlite3 and ElectricSQL persisters. v9.3 lets several synchronizers share one WebSocket. v9.6 added `pg`, better-sqlite3 and Supabase persisters. ([releases](https://tinybase.org/guides/releases/)) MergeableStore "acts as a native CRDT". ([mergeable-store](https://tinybase.org/api/mergeable-store/), [DO integration](https://tinybase.org/guides/integrations/cloudflare-durable-objects/))
- **Replicache** is in maintenance; Rocicorp moved to Zero. The issues repo was archived on 2026-06-10. ([GitHub](https://github.com/rocicorp/replicache)) Zero has no offline writes (see the earlier research).

### Can TinyBase sit on our log without losing history?

Only as a plain `Store` fed by our op engine, i.e. as a reactive projection. Then its synchronizers, MergeableStore and DO integration go unused, because they sync store state with their own clocks, not our ops. If MergeableStore were the sync layer, the log would no longer be the source of truth: per-cell timestamps would decide conflicts, and Changes, per-Change undo and Proposals would be lost. So TinyBase's distinctive features are exactly the ones we can't use. What is left is a smaller, mature reactive store with weaker joins than TanStack DB.

### Recommendation: our op engine + TanStack DB as the query layer

Split the job in two:

**1. Op engine (ours, shared package).** It is the client-side store of record, and it is the same code the server runs.
- Holds confirmed ops up to `head_seq`, plus `pending_ops` (client ULID, `client_seq`, `change_id`).
- `apply(op)` uses the shared Drizzle op-apply code on the local database:
  - **Electron:** SQLite in the main process (better-sqlite3 or `node:sqlite`), with the full Drizzle schema, FTS5 search, and `pending_ops` durable on disk.
  - **Web (v1):** in memory, loaded by pull on open. The web app is online-first; pending ops also go to IndexedDB so a reload doesn't lose them. Offline web later means swapping memory for wa-sqlite + OPFS in a worker (TanStack's browser package proves that stack works) with no protocol change.
- **Push/pull:** Replicache-style, per the earlier research. Pull `since=seq`, then rebase: roll back pending ops, apply the server ops, re-apply pending ops that weren't acknowledged, and emit the row diffs.
- **Undo per Change**, **View as of**, and **Proposal preview** are op-engine functions (inverse ops, replay to a seq, apply a batch to a scratch copy).
- **Emits row diffs** (`insert | update | delete` per table row) after each apply or rebase.

**2. TanStack DB collections (one per table: concepts, relationships, concept_tags, kind_defs, …).**
- Each collection's `sync` subscribes to the op engine's row diffs: `begin` → `write` each diff → `commit`. After the first load, `markReady`.
- UI writes go through `collection.update(id, draft => …)` inside a transaction whose `mutationFn` turns `mutation.changes` into field-level ops (`concept.set` per changed field, `tag.add/remove` for sets). The mutationFn hands the ops to the op engine and resolves once they are applied locally. So TanStack's optimistic layer lives for milliseconds. Durability, retry and rebase stay in the op engine.
- Views use `useLiveQuery` with joins across collections. Row types come from `drizzle-zod` schemas, so the UI types are the Drizzle types.
- In Electron the op engine runs in the main process and sends diffs to the renderer over IPC. In the web app it runs in the page (or a worker).

**Why this split.** TanStack DB gives us incremental live joins and React hooks, which is the costly part to hand-roll. Its pre-1.0 status and alpha persistence are contained, because it holds no data of record: if it churns, only the view layer changes. We skip TanStack persistence because it stores its own collection rows, not our Drizzle tables, and it would be a second outbox beside `pending_ops`.

**Risks.**
- TanStack DB is 0.x with frequent releases (0.6 in March, 0.9.2 now). Pin versions and wrap it behind a thin `useExpeditionQuery` layer.
- Rebase of a large pending queue emits many diffs. Batch them into one `begin/commit` per rebase.
- Uncertain: whether TanStack's optimistic layer handles a mutationFn that resolves before a separate sync write lands, without a flicker. The docs imply you await your sync write inside the handler; the op engine should emit the diff before resolving. Prototype this first.

## Part 2: v1 live relay

### Cloudflare facts

- **Hibernation API:** `ctx.acceptWebSocket()` plus `webSocketMessage()`/`webSocketClose()` handlers. While hibernated, "Billable Duration (GB-s) charges do not accrue", and "in-memory state is reset". `serializeAttachment` holds up to **16,384 bytes** per socket, which survives hibernation. Alarms, in-flight requests, `setTimeout` and `setInterval` prevent hibernation. ([DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/))
- **Billing:** incoming WebSocket messages are billed at a **20:1** ratio; **outgoing messages and protocol pings are free**. Paid includes 1M requests and 400,000 GB-s a month. SQLite-backed DOs are on the Free plan too. ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/))
- **Limits:** received message max 32 MiB; soft limit of 1,000 requests/s per object; CPU 30 s per invocation by default. ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/))
- **Helpers:** PartyServer (`partyserver` 0.5.10, ISC) wraps DOs with rooms and hibernation. `partysocket` 1.3.0 (MIT) is a reconnecting WebSocket client that works against any server. ([cloudflare/partykit](https://github.com/cloudflare/partykit))

### Protocol

**Transport.** `GET /api/expeditions/:id/live` upgrades to a WebSocket. The Hono app authenticates the session and checks the role, then forwards to the room (on CF: `env.ROOM.idFromName(expeditionId)`). The room stores `{userId, name, colour, clientId, role}` in the socket attachment and tags the socket with `userId`. Signed-in viewers can connect (read-only). Anonymous public-link readers can subscribe to `ops` but send no presence (a proposal; confirm in the spec).

**Push stays HTTP.** `POST /api/expeditions/:id/push` runs one Postgres transaction:
1. Lock the Expedition row and take `head_seq`.
2. Assign `server_seq`s, append the ops, apply them to the materialized tables, and write the Change row.
3. Commit.

Postgres is the serializer, so Workers, Node, MCP and the build pipeline all push the same way. After commit, the server calls `room.published({from, to, ops})` (a DO RPC, in `waitUntil`). The DO never touches Postgres, which keeps it tiny and hibernation-friendly, and matches 08's "the DO is only the live relay".

**Messages** (JSON; one envelope `{t, …}`):

| Direction | `t` | Payload | Notes |
|---|---|---|---|
| S→C | `hello` | `headSeq`, `presence[]`, `builds[]` | On connect. Client pulls if `headSeq` is ahead of its own |
| S→C | `ops` | `from`, `to`, `ops[]` | After each push. If the batch is large (say > 64 KB, e.g. a build's Change), send `poke {headSeq}` instead and let the client pull |
| S→C | `poke` | `headSeq` | Client pulls `since=` its seq. Also the fallback when a client sees a gap (`from ≠ its seq + 1`) |
| C→S | `presence` | `view`, `cursor {x,y}` in flow coords, `selection[]`, `editing?` | Client throttles to ~10–20 Hz. The room rebroadcasts to others and keeps the last state in the attachment |
| S→C | `presence` / `leave` | `clientId`, `user`, state | Leave comes from `webSocketClose` |
| S→C | `build` | `viewId`, `step`, `progress`, `streamingNodes?` | Live-only build progress (08). The build runner calls `room.build(evt)`. The room keeps the latest event per View in memory for late joiners; after hibernation, clients fall back to the logged `status` |
| S→C | `kick` | `reason` | Role removed or Expedition deleted. The server calls `room.kick(userId)`, which uses `getWebSockets(userId)` |
| C→S | `ping` | | Use `setWebSocketAutoResponse` so pings don't wake the DO |

**Agent presence.** An agent acting through MCP shows as a participant (canvas decision 18). The stateless MCP handler calls `room.agentPresence({userId, label: "agent via MCP", ttl})` on each tool call. The room expires it with a DO alarm. Proposals it writes arrive as a `poke` or an app-level notification, not as log ops.

**Why not push over the socket?** HTTP push is idempotent by `op_id`, works offline-then-online from the op engine's queue, and is identical on both runtimes. Pushing over the socket can come later as an optimisation.

### Self-hosted Node equivalent

- **One interface, two implementations:** `Relay { published(exp, batch); build(exp, evt); kick(exp, user); agentPresence(...); handleUpgrade(...) }`. On CF it forwards to the DO; on Node it uses in-process rooms (`Map<expeditionId, Set<socket>>`).
- **WebSockets in Hono on Node:** `@hono/node-ws` is deprecated; WebSocket support is now in `@hono/node-server` (2.1.1) with the `ws` package (8.21.3). `upgradeWebSocket()` covers Workers, Node, Bun and Deno. ([Hono WebSocket helper](https://hono.dev/docs/helpers/websocket)) On CF, though, the upgrade is handed to the DO, not handled by the Worker.
- **Single instance (the default self-host):** in-process fan-out. Nothing else to run.
- **Multi-instance:** Postgres **LISTEN/NOTIFY**.
  - The push transaction does `NOTIFY exp_ops, '{"exp":…,"from":…,"to":…}'`. Notifications are delivered only on commit, in commit order, which is exactly the "after push" signal. Each instance then reads the ops (or sends a `poke`) to its local sockets.
  - Presence and build events go on a second channel, `exp_live`. Keep payloads small: the default payload cap is **8,000 bytes**, and the queue is 8 GB. ([NOTIFY docs](https://www.postgresql.org/docs/current/sql-notify.html))
  - LISTEN needs one **dedicated direct connection** per instance, not a transaction-mode pooler. (Hyperdrive doesn't support LISTEN/NOTIFY either, which is fine because CF uses the DO.)
  - Cursor traffic at 10–20 Hz per user through NOTIFY is acceptable for small teams. If it isn't, route each Expedition to one instance (sticky by id) or add Redis pub/sub. Uncertain where the limit is; measure before adding Redis.
- **Hocuspocus is not needed.** It is a Yjs document server (v4 runs on Node, Bun, Deno and Workers via crossws; `@hocuspocus/server` 4.7.0, MIT) ([release notes](https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release)). Our relay carries ops and presence, not Yjs docs. Phase-2 text updates go through the same room (see Part 3).

### Recommendation

A **hand-written hibernating DO room** (roughly one small class) on Cloudflare and **in-process rooms + LISTEN/NOTIFY** on Node, behind one `Relay` interface. Use **`partysocket`** on the client for reconnect and backoff. Push stays HTTP through Postgres. PartyServer is a fine alternative for the DO side, but it only helps on CF, and our protocol is small enough to own.

## Part 3: text co-editing (phase 2)

### Compared

| | **Yjs** | **Loro** |
|---|---|---|
| Version | `yjs` 13.6.33 (2026-09-23), MIT | `loro-crdt` 1.16.3 on npm (2026-09-21), MIT. The GitHub page shows a higher 1.x number, probably the Rust crate (uncertain) |
| Size | ~28 KB gz (bundlephobia) | JS glue plus a **3.3 MB WASM, ~1.08 MB gzipped** (measured from the npm tarball) |
| Text algorithm | YATA-family | Fugue (less interleaving), rich text, movable tree/list |
| Editor bindings | y-prosemirror, y-codemirror, Tiptap Collaboration, BlockNote, many more | `loro-prosemirror` 0.4.4, loro-codemirror; no official Tiptap extension found |
| Presence / cursors | y-protocols awareness; relative positions | EphemeralStore; stable Cursor positions (per loro-prosemirror) |
| Server | Pure JS; runs on Workers and Node | WASM; runs on Workers (size counts toward the bundle) and Node |
| History | GC'd; UndoManager per session | Built-in version vectors, time travel, shallow snapshots |

Sources: [Loro GitHub](https://github.com/loro-dev/loro), [Loro benchmarks](https://www.loro.dev/docs/performance), [loro-prosemirror](https://github.com/loro-dev/loro-prosemirror), [Yjs vs Loro thread](https://discuss.yjs.dev/t/yjs-vs-loro-new-crdt-lib/2567), [PkgPulse comparison](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026) (secondary source).

### Recommendation: lean Yjs, decide in phase 2

Loro's advantages (speed on huge docs, built-in time travel) matter little here: each text doc is one overview or one article section, and history already comes from our op log. Yjs is ~40x smaller to ship, pure JS on both runtimes, and has the widest editor support. The markdown editor isn't chosen yet, and that choice should settle this. If it is ProseMirror/Tiptap, Yjs is the default. Loro is still fine if we later want its rich-text or tree types.

### Does picking now change the v1 schema? No.

- Keep `concepts.overview` and `article_sections.md` as **plain markdown columns**. They stay the source for reads, FTS and exports.
- Phase 2 adds (1) a nullable CRDT state column or a side table `text_docs(target, field, state)`, and (2) an op kind `text.update {target, field, update(base64)}`. The server applies the update to the doc and rewrites the `md` column in the same transaction.
- v1 `*.set` ops on those fields stay valid: in phase 2 they mean "replace the whole text", applied to the doc as a replace. Old logs replay unchanged.
- Live keystrokes go through the same room as a `text` message (relay only). The client batches them into `text.update` ops at Change-coalescing boundaries, so the log doesn't get one op per keystroke. Undo per Change on text works through inverse text updates. This is the part that needs design work in phase 2.
- The one thing to keep in v1: `ops.value` must accept an opaque string payload (it is JSON already), and the op-kind registry must allow new kinds with `schema_v` upgrades. Both are already in 08.

## Sources

- TanStack DB: [0.6 blog (persistence, offline)](https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes) · [Electric's 0.6 post](https://electric-sql.com/blog/2026/03/25/tanstack-db-0.6-app-ready-with-persistence-and-includes) · [custom collection / sync guide](https://tanstack.com/db/latest/docs/guides/collection-options-creator) · [overview](https://tanstack.com/db/latest/docs/overview) · npm READMEs of `@tanstack/browser-db-sqlite-persistence` 0.2.23, `@tanstack/electron-db-sqlite-persistence` 0.1.35, `@tanstack/offline-transactions` 1.0.56 · versions from the npm registry, 2026-09-25
- TinyBase: [releases](https://tinybase.org/guides/releases/) · [MergeableStore](https://tinybase.org/api/mergeable-store/) · [Durable Objects integration](https://tinybase.org/guides/integrations/cloudflare-durable-objects/) · [synchronization guide](https://tinybase.org/guides/synchronization/)
- Replicache: [GitHub (archived 2026-06-10)](https://github.com/rocicorp/replicache)
- Cloudflare: [DO WebSockets and hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) · [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) · [PartyServer / partysocket](https://github.com/cloudflare/partykit)
- Node: [Hono WebSocket helper](https://hono.dev/docs/helpers/websocket) · [Postgres NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html) · [Hocuspocus 4 stable](https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release) · [Hocuspocus v4 release notes](https://github.com/ueberdosis/hocuspocus/blob/main/RELEASE_NOTES_V4.md)
- CRDTs: [Loro](https://github.com/loro-dev/loro) · [Loro benchmarks](https://www.loro.dev/docs/performance) · [loro-prosemirror](https://github.com/loro-dev/loro-prosemirror) · [Yjs vs Loro discussion](https://discuss.yjs.dev/t/yjs-vs-loro-new-crdt-lib/2567)
- Bundle sizes: TanStack DB and TinyBase were measured by me with esbuild (minified, gzipped, React external), so they are rough. Yjs is from bundlephobia. Loro's WASM size is from the npm tarball.
