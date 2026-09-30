// Spike tooling (WP-0.5): a simulated server and clients, so tests and the
// harness page can control exactly when pushes reach the server and when
// confirmed ops (echo or another client's) reach each client.
import {
  apply,
  ApplyError,
  ulidSequence,
  type DomainState,
  type LoggedOp,
  type Op,
} from "@seply/domain"
import {
  createEngineCollections,
  type EngineCollections,
  type EngineCollectionsOptions,
} from "../collections.ts"
import { OpEngine } from "../engine.ts"

export class SimServer {
  readonly log: LoggedOp[] = []
  private readonly inboxes = new Map<string, LoggedOp[]>()
  state: DomainState

  constructor(base: DomainState) {
    this.state = base
  }

  connect(clientId: string): void {
    this.inboxes.set(clientId, [])
  }

  /** Validates and appends ops in order; returns the ids it refused. */
  push(ops: readonly Op[]): { accepted: LoggedOp[]; rejected: string[] } {
    const accepted: LoggedOp[] = []
    const rejected: string[] = []
    for (const op of ops) {
      if (this.log.some((l) => l.opId === op.opId)) continue // idempotent
      try {
        this.state = apply(this.state, op)
      } catch (e) {
        if (!(e instanceof ApplyError)) throw e
        rejected.push(op.opId)
        continue
      }
      const logged = { ...op, serverSeq: this.log.length + 1 }
      this.log.push(logged)
      accepted.push(logged)
    }
    for (const inbox of this.inboxes.values()) inbox.push(...accepted)
    return { accepted, rejected }
  }

  /** Takes up to `n` undelivered ops for a client (all by default). */
  take(clientId: string, n = Infinity): LoggedOp[] {
    const inbox = this.inboxes.get(clientId) ?? []
    return inbox.splice(0, n)
  }

  undelivered(clientId: string): number {
    return this.inboxes.get(clientId)?.length ?? 0
  }
}

export class SimClient {
  readonly engine: OpEngine
  readonly collections: EngineCollections
  private readonly sent = new Set<string>()

  constructor(
    readonly id: string,
    readonly server: SimServer,
    base: DomainState,
    opts: EngineCollectionsOptions & { startMs?: number } = {}
  ) {
    server.connect(id)
    // Distinct, increasing op ids per client (the time part separates clients).
    this.engine = new OpEngine(base, {
      actor: id,
      nextOpId: ulidSequence(
        opts.startMs ?? Date.parse("2026-09-01T00:00:00Z")
      ),
    })
    this.collections = createEngineCollections(this.engine, {
      ...opts,
      id: `${opts.id ?? "sim"}:${id}`,
    })
  }

  /** Pending ops not yet pushed. */
  unsent(): Op[] {
    return this.engine.pending.filter((op) => !this.sent.has(op.opId))
  }

  /** Pushes every unsent pending op; refused ones are dropped locally. */
  push(): void {
    const ops = this.unsent()
    for (const op of ops) this.sent.add(op.opId)
    const { rejected } = this.server.push(ops)
    if (rejected.length) this.engine.reject(rejected)
  }

  /** Delivers up to `n` confirmed ops from the server to this client. */
  pull(n = Infinity): void {
    const ops = this.server.take(this.id, n)
    if (ops.length) this.engine.receive(ops)
  }

  dispose(): void {
    this.collections.dispose()
  }
}
