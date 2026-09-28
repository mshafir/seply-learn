---
id: 05
title: Local-first sync for Electron and Postgres
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

Which approach lets the Electron app work **fully offline** on local storage and **optionally sync** with a self-hosted or Cloudflare backend on Postgres? It must also support v1 multi-editor sharing recorded as operations, and phase-2 real-time co-editing. Candidates:
- ElectricSQL + PGlite
- Zero (Rocicorp)
- PowerSync
- LiveStore
- Jazz
- Triplit
- Yjs / Automerge / Loro CRDTs with a custom Postgres store
- a hand-rolled op log

Compare maturity, license, self-hostability, Cloudflare fit, per-Graph authorization, and how Snapshots and Proposals would map onto each. Recommend.

## Resolution

Recommend a **hand-rolled, per-Graph operation log**: SQLite in Electron (materialized tables + `pending_ops`), Postgres on the server (`graph_ops` with a per-Graph `server_seq`), Replicache-style push/pull.
- Cloudflare: Worker + Hyperdrive → Postgres; phase 2 adds a Durable Object per Graph for real-time fan-out. Self-host runs the same logic in Node.
- Snapshot = named `(graph_id, server_seq)` (+ optional materialized copy); restore appends ops. Proposal = pending op batch; accept = push it.
- Per-Graph auth is a role check on each push/pull. Phase-2 rich text: embed Loro/Yjs only in Concept content.
- Rejected: Zero (no offline writes), Electric (read-path only), PowerSync (FSL + stateful service), Jazz v2 (alpha, no Postgres), Triplit (dormant). Watch LiveStore (beta, great DO fit, but its log isn't in Postgres).
- Details and sources: [../research/local-first-sync-engine.md](../research/local-first-sync-engine.md)
