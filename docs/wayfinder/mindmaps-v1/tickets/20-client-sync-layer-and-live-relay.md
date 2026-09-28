---
id: 20
title: Client sync layer and live relay
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: [08]
---

## Question

The per-Expedition op log stays the source of truth ([Core data model and operation log](08-core-data-model-and-operations.md)). Research what sits around it:

1. **Client store and sync layer** for the web app (Cloudflare first) and the Electron app (local-first, offline). It needs optimistic field-level ops, a pending-op queue, rebase on pull, live reactive queries across Views, and undo per Change. Compare:
   - **TanStack DB** fed by our own op-log sync (custom collection sync, optimistic mutations, offline transactions, and persistence to SQLite in Electron or IndexedDB/OPFS on the web)
   - **TinyBase** (MergeableStore, Durable Object synchronizer, persisters), and whether it can sit on top of our log without losing history
   - a **hand-rolled** store (e.g. Replicache-style over SQLite/wa-sqlite)
   Cover maturity, licence, bundle size, React 19 fit, and how each materializes the Drizzle schema.
2. **v1 live relay.** Presence and live cursors are v1 (canvas decision 18), so the Expedition's Durable Object relay moves from phase 2 into v1. Specify its protocol: op fan-out after push, presence, and View build progress. Also specify the **self-hosted Node equivalent** (the plan said Hocuspocus, which is Yjs-specific), including a WebSocket relay in the Hono/Node app and multi-instance fan-out (Postgres LISTEN/NOTIFY?).
3. **Text co-editing (phase 2):** recheck Loro vs Yjs for per-field text (overview, article section) inside this model, and whether picking one now changes the v1 schema.

Recommend one option per part.

## Resolution (2026-09-25)

Findings: [Client sync layer and live relay](../research/client-sync-layer-and-live-relay.md).

- **Client store:** our own shared **op engine** is the store of record. It holds confirmed ops, `pending_ops`, rebase on pull, undo per Change, View as of, and Proposal preview. It materializes the Drizzle schema with the shared op-apply code: SQLite in the Electron main process, and memory (plus IndexedDB for pending ops) on the web in v1.
- **TanStack DB** (MIT, 0.9.x, pre-1.0) is the reactive query layer on top. It has one collection per table, fed by row diffs through its custom `sync` (`begin/write/commit`). UI edits become field-level ops in the `mutationFn`. Row types come from `drizzle-zod`. Its alpha SQLite persistence and `offline-transactions` outbox are skipped for Expedition data, because they duplicate the op engine.
- **Rejected:** TinyBase (MIT, v10, mature), because its MergeableStore is a competing per-cell CRDT with no op history; as a plain projection it offers weaker joins. Also a fully hand-rolled reactive layer (no incremental joins) and Replicache (in maintenance, archived).
- **Live relay:** one WebSocket room per Expedition. Push stays HTTP; Postgres assigns `server_seq`, then the server calls the room, which fans out `ops` (or a `poke` for large batches or gaps). The room also carries presence and cursors (~10–20 Hz), live View build progress, agent-via-MCP presence (with a TTL) and `kick`. None of it is logged.
- **Cloudflare:** a hand-written **hibernating Durable Object** that never touches Postgres. Presence lives in socket attachments (16 KB limit), and outgoing messages are free. The client uses `partysocket` for reconnect.
- **Self-hosted Node:** the same `Relay` interface, with in-process rooms on `@hono/node-server` + `ws`. Multi-instance fan-out uses Postgres **LISTEN/NOTIFY** (fires on commit; 8,000-byte payloads; needs a dedicated direct connection). Hocuspocus is not needed.
- **Text co-editing (phase 2):** lean **Yjs** (~28 KB gz, pure JS, widest editor bindings) over Loro (~1 MB gz WASM). The final pick follows the markdown editor choice. **No v1 schema change:** `md`/`overview` stay plain columns, and phase 2 adds a CRDT state column plus a `text.update` op kind.
- **Prototype first:** check that TanStack DB's optimistic layer doesn't flicker when the op engine emits its diff before the `mutationFn` resolves.
