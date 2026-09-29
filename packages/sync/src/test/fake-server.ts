// Test tooling: an in-memory server with the WP-1.2 push/pull semantics
// (packages/server/src/oplog.ts): all-or-nothing pushes applied with
// @umbel/domain's `apply`, idempotent by op id, 409 naming the op that
// doesn't apply, gap-free server_seq, Changes with one author. Each client
// gets its own SyncTransport, which can be taken offline.
import {
  apply,
  ApplyError,
  makeOps,
  ulidSequence,
  type DomainState,
  type LoggedOp,
  type OpBody,
} from "@umbel/domain"
import type { ChangeMeta } from "../engine.ts"
import {
  SyncHttpError,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncTransport,
} from "../transport.ts"

export type ServerChange = ChangeMeta & { author: string }

export class FakeServer {
  readonly log: LoggedOp[] = []
  readonly changes = new Map<string, ServerChange>()
  state: DomainState
  pushes = 0

  constructor(base: DomainState) {
    this.state = base
  }

  /** Server-side ops (e.g. the first build), logged as one Change. */
  seed(bodies: OpBody[], author = "owner"): void {
    // Distinct, increasing op ids: one millisecond per op logged so far.
    const startMs = Date.parse("2026-09-01T00:00:00Z") + this.log.length
    const ops = makeOps(bodies, {
      expeditionId: this.state.expedition.id,
      actor: author,
      changeId: `seed-${this.log.length}`,
      nextOpId: ulidSequence(startMs),
    })
    for (const op of ops) {
      this.state = apply(this.state, op)
      this.log.push({ ...op, serverSeq: this.log.length + 1 })
    }
  }

  push(actor: string, req: PushRequest): PushResponse {
    this.pushes++
    const known = new Map(this.log.map((op) => [op.opId, op.serverSeq]))
    let state = this.state
    const fresh: LoggedOp[] = []
    for (const op of req.ops) {
      if (op.actor !== actor)
        throw new SyncHttpError(400, { error: "invalid op", opId: op.opId })
      if (known.has(op.opId)) continue
      const prev = this.changes.get(op.changeId)
      if (prev && prev.author !== actor)
        throw new SyncHttpError(409, {
          error: "Change belongs to another author",
        })
      try {
        state = apply(state, op)
      } catch (e) {
        if (!(e instanceof ApplyError)) throw e
        throw new SyncHttpError(409, {
          error: "op does not apply",
          opId: op.opId,
          message: e.message,
        })
      }
      fresh.push({ ...op, serverSeq: this.log.length + fresh.length + 1 })
    }
    this.state = state
    this.log.push(...fresh)
    const metas = new Map((req.changes ?? []).map((c) => [c.id, c]))
    for (const op of fresh) {
      const prev = this.changes.get(op.changeId)
      const meta = metas.get(op.changeId)
      this.changes.set(op.changeId, {
        id: op.changeId,
        author: actor,
        origin: prev?.origin ?? meta?.origin ?? "human",
        label: meta?.label ?? prev?.label ?? "Edited",
      })
    }
    const seqOf = new Map(this.log.map((op) => [op.opId, op.serverSeq]))
    return {
      headSeq: this.log.length,
      results: req.ops.map((op) => ({
        opId: op.opId,
        serverSeq: seqOf.get(op.opId)!,
      })),
    }
  }

  pull(since: number, limit = 1000): PullResponse {
    const ops = this.log.filter((op) => op.serverSeq > since).slice(0, limit)
    const last = ops.at(-1)?.serverSeq ?? since
    return { headSeq: this.log.length, ops, more: last < this.log.length }
  }

  /** A client's transport. `offline` makes every call fail like a dropped connection. */
  transport(actor: string, opts: { pullLimit?: number } = {}) {
    const t = {
      offline: false as boolean,
      push: async (req: PushRequest) => {
        await Promise.resolve()
        if (t.offline) throw new TypeError("Failed to fetch")
        return structuredClone(this.push(actor, structuredClone(req)))
      },
      pull: async (req: { since: number }) => {
        await Promise.resolve()
        if (t.offline) throw new TypeError("Failed to fetch")
        return structuredClone(this.pull(req.since, opts.pullLimit))
      },
    } satisfies SyncTransport & { offline: boolean }
    return t
  }
}
