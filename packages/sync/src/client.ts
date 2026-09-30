// The sync client: one Expedition, one user. It owns the op engine, mirrors
// its pending ops to a PendingStore (IndexedDB in the browser), pushes them
// and pulls confirmed ops through a SyncTransport, and exposes the TanStack DB
// collections.
//
// Opening: load the saved pending ops, pull the log from the start, then
// rebase the saved ops on top (so ops the server already has are skipped, and
// ops that no longer apply are dropped), then push what is left. If the first
// pull fails, `openSyncClient` rejects and the saved ops stay untouched.
//
// Push: pending ops in order, at most PUSH_LIMIT per request. A push is all or
// nothing on the server. When the server refuses an op:
//   409 (doesn't apply): we are probably behind. Pull (the rebase drops ops
//        that no longer apply) and retry; if the same op is refused again,
//        drop it.
//   400 naming an op: drop that op (it can never succeed).
//   403 / 404: drop the batch (we may not edit this Expedition).
// Anything else (network, 5xx, 401) keeps the ops pending and retries later.
import {
  emptyState,
  type DomainState,
  type LoggedOp,
  type Op,
} from "@seply/domain"
import {
  createEngineCollections,
  type EngineCollections,
  type EngineCollectionsOptions,
} from "./collections.ts"
import { OpEngine, type EngineOptions } from "./engine.ts"
import type { PendingStore } from "./store.ts"
import { SyncHttpError, type SyncTransport } from "./transport.ts"

/** The most ops one push carries (the server's limit). */
export const PUSH_LIMIT = 1000

export type SyncClientOptions = {
  expeditionId: string
  /** The signed-in user's id (every op's actor). */
  actor: string
  transport: SyncTransport
  store: PendingStore
  /** Push automatically after local edits (default true). */
  autoPush?: boolean
  /** Wait this long after an edit before pushing, to batch typing (default 200 ms). */
  pushDelayMs?: number
  /** First retry after a failed push; doubles up to a minute (default 2 s). */
  retryMs?: number
  /** Something went wrong syncing (ops stay pending unless they were refused). */
  onError?: (error: unknown) => void
  collections?: EngineCollectionsOptions
} & Pick<
  EngineOptions,
  "nextOpId" | "nextChangeId" | "now" | "coalesceWindowMs" | "onDropped"
>

export type SyncStatus = {
  pending: number
  headSeq: number
  pushing: boolean
  lastError: unknown
}

export async function openSyncClient(
  opts: SyncClientOptions
): Promise<SyncClient> {
  const scope = { expeditionId: opts.expeditionId, actor: opts.actor }
  const saved = await opts.store.load(scope)
  const client = new SyncClient(opts, emptyState(opts.expeditionId))
  await client.pull()
  client.engine.restore(saved) // from here on, pending changes are saved
  client.start()
  return client
}

export class SyncClient {
  readonly engine: OpEngine
  readonly collections: EngineCollections
  private started = false
  private disposed = false
  private pushing: Promise<void> | null = null
  private pushAgain = false
  private pulling: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private retryDelay: number
  private lastError: unknown = null

  constructor(
    private readonly opts: SyncClientOptions,
    base: DomainState,
    baseSeq = 0
  ) {
    this.retryDelay = opts.retryMs ?? 2000
    const scope = { expeditionId: opts.expeditionId, actor: opts.actor }
    let pendingCount = 0
    this.engine = new OpEngine(
      base,
      {
        actor: opts.actor,
        nextOpId: opts.nextOpId,
        nextChangeId: opts.nextChangeId,
        now: opts.now,
        coalesceWindowMs: opts.coalesceWindowMs,
        onDropped: opts.onDropped,
        // Nothing changes pending ops before `restore` (openSyncClient only
        // pulls first), so the saved ops are never overwritten half-loaded.
        onPendingChange: (snapshot) => {
          opts.store.save(scope, snapshot)
          // A local edit adds pending ops: push soon.
          if (snapshot.ops.length > pendingCount)
            this.schedulePush(opts.pushDelayMs ?? 200)
          pendingCount = snapshot.ops.length
        },
      },
      baseSeq
    )
    this.collections = createEngineCollections(this.engine, {
      id: `seply:${opts.expeditionId}`,
      ...opts.collections,
    })
  }

  /** Starts automatic pushing (openSyncClient calls it). */
  start(): void {
    this.started = true
    if (this.engine.pending.length) this.schedulePush(0)
  }

  get status(): SyncStatus {
    return {
      pending: this.engine.pending.length,
      headSeq: this.engine.headSeq,
      pushing: !!this.pushing,
      lastError: this.lastError,
    }
  }

  /** Pulls every confirmed op after our head and rebases pending ops on them. */
  pull(): Promise<void> {
    this.pulling ??= this.pullAll().finally(() => {
      this.pulling = null
    })
    return this.pulling
  }

  private async pullAll(): Promise<void> {
    for (;;) {
      const res = await this.opts.transport.pull({
        expeditionId: this.opts.expeditionId,
        since: this.engine.headSeq,
      })
      this.engine.receive(res.ops)
      if (!res.more || !res.ops.length) return
    }
  }

  /** Pushes every pending op (and whatever is added meanwhile). */
  push(): Promise<void> {
    if (this.pushing) {
      this.pushAgain = true
      return this.pushing
    }
    this.pushing = (async () => {
      do {
        this.pushAgain = false
        await this.pushPending()
      } while (this.pushAgain && !this.disposed)
    })().finally(() => {
      this.pushing = null
    })
    return this.pushing
  }

  /** Push, then pull. */
  async sync(): Promise<void> {
    await this.push()
    await this.pull()
  }

  private async pushPending(): Promise<void> {
    let refusedOnce: string | null = null
    while (this.engine.pending.length && !this.disposed) {
      const batch = this.engine.pending.slice(0, PUSH_LIMIT)
      try {
        const res = await this.opts.transport.push({
          expeditionId: this.opts.expeditionId,
          ops: batch,
          changes: this.engine.changesFor(batch),
        })
        this.confirm(batch, res)
        refusedOnce = null
        this.lastError = null
        this.retryDelay = this.opts.retryMs ?? 2000
      } catch (e) {
        if (!(e instanceof SyncHttpError)) throw e
        const { status, body } = e
        if (status === 409 && refusedOnce !== (body.opId ?? "")) {
          // Probably behind: catch up (the rebase drops what no longer applies).
          refusedOnce = body.opId ?? ""
          await this.pull()
          continue
        }
        if ((status === 409 || status === 400) && body.opId) {
          this.report(e)
          this.engine.reject([body.opId])
          refusedOnce = null
          continue
        }
        if (
          status === 409 ||
          status === 403 ||
          status === 404 ||
          status === 400
        ) {
          this.report(e)
          this.engine.reject(batch.map((op) => op.opId))
          continue
        }
        throw e
      }
    }
  }

  /**
   * Our pushed ops, now logged. When they sit right after our head with no
   * one else's ops in between, apply them directly; otherwise pull.
   */
  private confirm(
    batch: readonly Op[],
    res: { headSeq: number; results: { opId: string; serverSeq: number }[] }
  ): void {
    const seqOf = new Map(res.results.map((r) => [r.opId, r.serverSeq]))
    const logged = batch
      .map((op) => ({ ...op, serverSeq: seqOf.get(op.opId) ?? -1 }))
      .filter((op) => op.serverSeq > this.engine.headSeq)
      .sort((a, b) => a.serverSeq - b.serverSeq)
    const contiguous =
      logged.every((op, i) => op.serverSeq === this.engine.headSeq + 1 + i) &&
      (logged.at(-1)?.serverSeq ?? this.engine.headSeq) === res.headSeq
    if (contiguous) this.engine.receive(logged satisfies LoggedOp[])
    else void this.pull().catch((e) => this.report(e))
  }

  private schedulePush(delay: number): void {
    if (!this.started || this.disposed || this.opts.autoPush === false) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.push().then(
        () => {
          if (this.engine.pending.length) this.schedulePush(0)
        },
        (e) => {
          this.report(e)
          const delay = this.retryDelay
          this.retryDelay = Math.min(delay * 2, 60_000)
          this.schedulePush(delay)
        }
      )
    }, delay)
  }

  private report(e: unknown): void {
    this.lastError = e
    this.opts.onError?.(e)
  }

  /** Waits for queued pending-op writes (e.g. before a test "reloads"). */
  flush(): Promise<void> {
    return this.opts.store.flush()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.collections.dispose()
  }
}
