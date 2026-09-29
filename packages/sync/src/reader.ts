// The reader client (spec §1.7): one reader's own state, across Expeditions.
// Reading status, personal View settings and the reader's position are not
// ops: they never enter the op log, never join a Change, and nobody else sees
// them. Each is a "mark" whose newest write wins (by `at`).
//
// - Signed in: marks are saved through the reader API (`/api/reader`). Every
//   mark goes to the browser's store first, flagged pending, so marks made
//   offline survive a reload and are saved on reconnect (the offline mark
//   queue). `refresh(expeditionId)` fetches the reader's state from the
//   server (other devices' marks); the rest is kept as a cache for reading
//   offline.
// - Anonymous (reading a public or unlisted Expedition, signed out): marks
//   stay in the browser only. Once signed in, `adoptAnonymous()` moves them
//   into the account's queue and saves them, newest winning, then clears
//   them from the browser.
// - The reader channel: other tabs of this browser hear every mark on a
//   BroadcastChannel. Other devices get it on their next refresh (on load
//   and when the tab comes back into view); the live relay's reader channel
//   (M4) will push it.
import {
  applyMarks,
  emptyReaderBatch,
  emptyReaderState,
  isNewer,
  READER_BATCH_LIMIT,
  type PositionMark,
  type ReaderBatch,
  type ReaderState,
  type ReadingMark,
  type ReadingState,
  type ViewSettingsMark,
} from "@umbel/domain"
import { recordKey, type MarkRecord, type ReaderStore } from "./reader-store.ts"
import { SyncHttpError, type FetchTransportOptions } from "./transport.ts"

/** The scope an anonymous reader's marks are kept under. */
export const ANONYMOUS_SCOPE = "anon"

export type ReaderSnapshot = {
  reading: ReadingMark[]
  viewSettings: ViewSettingsMark[]
  position: PositionMark | null
}

export type ReaderSaveResult = {
  saved: { reading: number; viewSettings: number; positions: number }
  /** Expeditions whose marks the server skipped (not viewable, or gone). */
  skipped: string[]
}

/** The reader API as an interface (packages/server README, "/reader"). */
export interface ReaderTransport {
  load(expeditionId: string): Promise<ReaderSnapshot>
  save(batch: ReaderBatch): Promise<ReaderSaveResult>
}

export function fetchReaderTransport(
  opts: FetchTransportOptions = {}
): ReaderTransport {
  const base = (opts.baseUrl ?? "/api").replace(/\/$/, "")
  const doFetch = opts.fetch ?? ((...args) => globalThis.fetch(...args))
  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      credentials: "include",
      ...init,
      headers: { ...opts.headers?.(), ...(init.headers as object) },
    })
    const body = (await res.json().catch(() => ({}))) as T
    if (!res.ok)
      throw new SyncHttpError(res.status, body as SyncHttpError["body"])
    return body
  }
  return {
    load: (expeditionId) =>
      call(`/reader/expeditions/${encodeURIComponent(expeditionId)}`, {
        method: "GET",
      }),
    save: (batch) =>
      call("/reader", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
      }),
  }
}

export type PositionInput = {
  viewId: string | null
  focusConceptId: string | null
  step?: number | null
  panelDepth?: PositionMark["panelDepth"]
}

/** A cross-tab channel: BroadcastChannel in the browser, anything alike in tests. */
export type ReaderChannel = {
  postMessage(message: unknown): void
  addEventListener(type: "message", fn: (e: { data: unknown }) => void): void
  removeEventListener(
    type: "message",
    fn: (e: { data: unknown }) => void
  ): void
  close(): void
}

export type ReaderClientOptions = {
  /** The signed-in user, or null for an anonymous reader. */
  userId: string | null
  /** Needed when signed in. */
  transport?: ReaderTransport
  store: ReaderStore
  /** Other tabs (default: a BroadcastChannel when there is one; null for none). */
  channel?: ReaderChannel | null
  /** Wait this long after a mark before saving, to batch clicks (default 300 ms). */
  saveDelayMs?: number
  /** First retry after a failed save; doubles up to a minute (default 2 s). */
  retryMs?: number
  now?: () => number
  onError?: (error: unknown) => void
}

type Message = { scope: string; records: MarkRecord[] }

const CHANNEL_NAME = "umbel-reader"

function defaultChannel(): ReaderChannel | null {
  return typeof BroadcastChannel === "undefined"
    ? null
    : (new BroadcastChannel(CHANNEL_NAME) as unknown as ReaderChannel)
}

const expeditionOf = (r: MarkRecord) => r.mark.expeditionId

export class ReaderClient {
  readonly scope: string
  readonly anonymous: boolean
  /** Resolves once the browser's saved marks are loaded. */
  readonly ready: Promise<void>

  private readonly records = new Map<string, MarkRecord>()
  private readonly states = new Map<string, ReaderState>()
  private readonly listeners = new Set<() => void>()
  private readonly channel: ReaderChannel | null
  private lastAt = 0
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay: number
  private saving: Promise<void> | null = null
  private disposed = false

  constructor(private readonly opts: ReaderClientOptions) {
    this.anonymous = !opts.userId
    this.scope = opts.userId ? `user:${opts.userId}` : ANONYMOUS_SCOPE
    this.retryDelay = opts.retryMs ?? 2000
    this.channel =
      opts.channel === undefined ? defaultChannel() : opts.channel
    this.channel?.addEventListener("message", this.onMessage)
    this.ready = opts.store.load(this.scope).then(
      (saved) => {
        this.merge(saved)
        this.scheduleSave(0)
      },
      (e) => this.opts.onError?.(e)
    )
  }

  // --- reading ---------------------------------------------------------------

  /** One Expedition's state (the same object until it changes). */
  getState(expeditionId: string): ReaderState {
    let st = this.states.get(expeditionId)
    if (!st) {
      st = emptyReaderState()
      const batch = this.batchOf(
        [...this.records.values()].filter(
          (r) => expeditionOf(r) === expeditionId
        )
      )
      st = applyMarks(st, batch, expeditionId)
      this.states.set(expeditionId, st)
    }
    return st
  }

  /** Called after any change to any Expedition's state. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Marks not yet saved on the server (for an anonymous reader: every mark). */
  get pendingCount(): number {
    let n = 0
    for (const r of this.records.values()) if (r.pending) n++
    return n
  }

  /** How many Concepts this reader has marked, in any Expedition. */
  get readingCount(): number {
    let n = 0
    for (const r of this.records.values()) if (r.kind === "reading") n++
    return n
  }

  // --- marking ---------------------------------------------------------------

  markReading(expeditionId: string, conceptId: string, state: ReadingState) {
    this.local({
      kind: "reading",
      mark: { expeditionId, conceptId, state, at: this.at() },
      pending: true,
    })
  }

  /** The reader's own values for a View's personal settings; `{}` resets them. */
  setViewSettings(
    expeditionId: string,
    viewId: string,
    settings: Record<string, unknown>
  ) {
    this.local({
      kind: "viewSettings",
      mark: { expeditionId, viewId, settings, at: this.at() },
      pending: true,
    })
  }

  setPosition(expeditionId: string, pos: PositionInput) {
    this.local({
      kind: "position",
      mark: {
        expeditionId,
        viewId: pos.viewId,
        focusConceptId: pos.focusConceptId,
        step: pos.step ?? null,
        panelDepth: pos.panelDepth ?? null,
        at: this.at(),
      },
      pending: true,
    })
  }

  // --- the server ------------------------------------------------------------

  /** Fetches this reader's state in one Expedition (other devices' marks). */
  async refresh(expeditionId: string): Promise<void> {
    await this.ready
    const t = this.opts.transport
    if (this.anonymous || !t || this.disposed) return
    const snap = await t.load(expeditionId)
    const incoming: MarkRecord[] = [
      ...snap.reading.map((mark) => ({
        kind: "reading" as const,
        mark,
        pending: false,
      })),
      ...snap.viewSettings.map((mark) => ({
        kind: "viewSettings" as const,
        mark,
        pending: false,
      })),
      ...(snap.position
        ? [{ kind: "position" as const, mark: snap.position, pending: false }]
        : []),
    ]
    const changed = this.merge(incoming)
    await this.opts.store.put(this.scope, changed)
  }

  /** Saves every pending mark now (signed in only). Resolves when done or failed. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (this.anonymous || !this.opts.transport || this.disposed)
      return Promise.resolve()
    this.saving ??= this.saveAll().finally(() => {
      this.saving = null
    })
    return this.saving
  }

  /**
   * Moves the anonymous reader's marks (kept in this browser before sign-in)
   * into this account: newest wins against what this browser knows, and the
   * server keeps the newest of those and what it has. The anonymous marks are
   * cleared once they are safely queued. Returns how many marks were moved.
   */
  async adoptAnonymous(): Promise<number> {
    await this.ready
    if (this.anonymous || this.disposed) return 0
    const anon = await this.opts.store.load(ANONYMOUS_SCOPE)
    if (!anon.length) return 0
    const accepted = this.merge(anon.map((r) => ({ ...r, pending: true })))
    await this.opts.store.put(this.scope, accepted)
    await this.opts.store.clear(ANONYMOUS_SCOPE)
    this.channel?.postMessage({
      scope: this.scope,
      records: accepted,
    } satisfies Message)
    this.channel?.postMessage({
      scope: ANONYMOUS_SCOPE,
      records: [],
      cleared: true,
    })
    await this.flush()
    return anon.length
  }

  dispose() {
    this.disposed = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.channel?.removeEventListener("message", this.onMessage)
    this.channel?.close()
    this.listeners.clear()
  }

  // --- internals -------------------------------------------------------------

  /** A strictly increasing ISO time, so two quick marks never tie. */
  private at(): string {
    const now = (this.opts.now ?? Date.now)()
    this.lastAt = Math.max(now, this.lastAt + 1)
    return new Date(this.lastAt).toISOString()
  }

  private local(record: MarkRecord) {
    if (this.disposed) return
    this.merge([record])
    void this.opts.store
      .put(this.scope, [record])
      .catch((e) => this.opts.onError?.(e))
    this.channel?.postMessage({
      scope: this.scope,
      records: [record],
    } satisfies Message)
    this.scheduleSave(this.opts.saveDelayMs ?? 300)
  }

  /** Applies records that are newer than ours; returns those, and notifies. */
  private merge(records: readonly MarkRecord[]): MarkRecord[] {
    const changed: MarkRecord[] = []
    for (const r of records) {
      const key = recordKey(r)
      const cur = this.records.get(key)
      if (!isNewer(r.mark, cur?.mark)) continue
      this.records.set(key, r)
      this.states.delete(expeditionOf(r))
      const t = Date.parse(r.mark.at)
      if (t > this.lastAt) this.lastAt = t
      changed.push(r)
    }
    if (changed.length) for (const l of this.listeners) l()
    return changed
  }

  private onMessage = (e: { data: unknown }) => {
    const msg = e.data as (Message & { cleared?: boolean }) | null
    if (!msg || msg.scope !== this.scope) return
    if (msg.cleared) {
      // Another tab adopted the anonymous marks into an account.
      this.records.clear()
      this.states.clear()
      for (const l of this.listeners) l()
      return
    }
    // The sending tab saves them; here they only update what we show.
    this.merge(msg.records.map((r) => ({ ...r, pending: false })))
  }

  private scheduleSave(ms: number) {
    if (this.anonymous || !this.opts.transport || this.disposed) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), ms)
  }

  private batchOf(records: readonly MarkRecord[]): ReaderBatch {
    const b = emptyReaderBatch()
    for (const r of records)
      if (r.kind === "reading") b.reading.push(r.mark)
      else if (r.kind === "viewSettings") b.viewSettings.push(r.mark)
      else b.positions.push(r.mark)
    return b
  }

  private async saveAll(): Promise<void> {
    const t = this.opts.transport!
    for (;;) {
      if (this.disposed) return
      const pending = [...this.records.values()].filter((r) => r.pending)
      if (!pending.length) {
        this.retryDelay = this.opts.retryMs ?? 2000
        return
      }
      // At most the server's limit of each sort per request.
      const counts = { reading: 0, viewSettings: 0, position: 0 }
      const sent = pending.filter((r) => ++counts[r.kind] <= READER_BATCH_LIMIT)
      try {
        await t.save(this.batchOf(sent))
      } catch (e) {
        this.opts.onError?.(e)
        if (e instanceof SyncHttpError && e.status === 400) {
          // Never valid: drop them rather than block the queue.
          this.acknowledge(sent)
          continue
        }
        const delay = this.retryDelay
        this.retryDelay = Math.min(delay * 2, 60_000)
        this.scheduleSave(delay)
        return
      }
      // Saved (or skipped by the server: an Expedition we can't view).
      this.acknowledge(sent)
    }
  }

  /** Clears the pending flag of records still holding what was sent. */
  private acknowledge(sent: readonly MarkRecord[]) {
    const done: MarkRecord[] = []
    for (const r of sent) {
      const key = recordKey(r)
      const cur = this.records.get(key)
      if (cur && cur.pending && cur.mark.at === r.mark.at) {
        const next = { ...cur, pending: false } as MarkRecord
        this.records.set(key, next)
        done.push(next)
      }
    }
    void this.opts.store
      .put(this.scope, done)
      .catch((e) => this.opts.onError?.(e))
  }
}
