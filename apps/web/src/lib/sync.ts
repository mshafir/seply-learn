// Opens the sync client (@seply/sync) for one Expedition and keeps it for as
// long as the screen is mounted. Pending ops live in IndexedDB, so an edit
// made offline survives a reload and is pushed once the server is reachable.
//
// `openSyncClient` pulls before it resolves, so opening needs the server. When
// it can't reach it, the hook retries with backoff (1 s doubling to 30 s) and
// `retry()` tries again at once; the saved pending ops stay untouched until
// then.
//
// Offline reading (spec §2.9): once open, the client's confirmed state is
// saved to the offline cache (lib/offline.ts), again a moment after each
// change. When opening can't reach the server and this device has a saved
// copy, the hook serves that copy instead ("cached": read-only, as of when it
// was saved) and keeps retrying; once the server answers, the live client
// replaces it.
//
// Until the live relay (WP-4.1) pushes other people's and other tabs' edits,
// an open client pulls every few seconds while the page is visible, and at
// once when it becomes visible again.
import * as React from "react"
import {
  fetchTransport,
  IndexedDbPendingStore,
  openCachedClient,
  openSyncClient,
  SyncHttpError,
  type PendingScope,
  type PendingSnapshot,
  type PendingStore,
  type SyncClient,
} from "@seply/sync"

import { offlineCache, saveForOffline } from "@/lib/offline.ts"

/** One IndexedDB store for the page; pending ops are scoped by Expedition and user. */
let sharedStore: IndexedDbPendingStore | null = null
function idbStore(): IndexedDbPendingStore {
  sharedStore ??= new IndexedDbPendingStore({
    onError: (e) => console.error("sync: saving pending edits failed", e),
  })
  return sharedStore
}

/** A PendingStore that also reports how many ops are pending. */
class CountingStore implements PendingStore {
  constructor(
    private readonly inner: PendingStore,
    private readonly onCount: (pending: number) => void
  ) {}
  async load(scope: PendingScope): Promise<PendingSnapshot> {
    const snapshot = await this.inner.load(scope)
    this.onCount(snapshot.ops.length)
    return snapshot
  }
  save(scope: PendingScope, snapshot: PendingSnapshot): void {
    this.inner.save(scope, snapshot)
    this.onCount(snapshot.ops.length)
  }
  flush(): Promise<void> {
    return this.inner.flush()
  }
}

export type SyncState =
  | { status: "opening"; attempt: number }
  | { status: "ready"; client: SyncClient }
  /** Offline, reading this device's saved copy (read-only), as of `savedAt`. */
  | { status: "cached"; client: SyncClient; savedAt: number; attempt: number }
  | { status: "failed"; error: unknown; attempt: number }

export type SyncHealth = {
  /** Edits not yet confirmed by the server. */
  pending: number
  /** The last push or pull failed (cleared by the next success). */
  offline: boolean
}

/** Refusals (403, 404) are final; anything else is worth retrying. */
export function isRetryable(error: unknown): boolean {
  return !(
    error instanceof SyncHttpError &&
    (error.status === 403 || error.status === 404)
  )
}

let clientCount = 0

/** How often an open client pulls while the page is visible (no relay yet). */
export const POLL_MS = 3000

/** How long after a change the offline copy is saved again. */
const OFFLINE_SAVE_MS = 1500

/**
 * Keeps the offline copy of an open client's confirmed state: now (as just
 * opened), and a moment after each change. Returns a stop function that
 * saves any change still waiting.
 */
function keepOffline(actor: string, client: SyncClient): () => void {
  const save = (opened: boolean) =>
    saveForOffline(
      actor,
      { state: client.engine.confirmed, headSeq: client.engine.headSeq },
      opened
    ).catch((e) => console.warn("offline: saving a copy failed", e))
  void save(true)
  let timer: ReturnType<typeof setTimeout> | null = null
  let savedSeq = client.engine.headSeq
  const unsubscribe = client.engine.subscribe(() => {
    if (client.engine.headSeq === savedSeq || timer) return
    timer = setTimeout(() => {
      timer = null
      savedSeq = client.engine.headSeq
      void save(false)
    }, OFFLINE_SAVE_MS)
  })
  return () => {
    unsubscribe()
    if (timer) {
      clearTimeout(timer)
      void save(false)
    }
  }
}

/** Pulls now and then, while the page is visible. Returns a stop function. */
function pollWhileVisible(client: SyncClient): () => void {
  const visible = () =>
    typeof document === "undefined" || document.visibilityState === "visible"
  const pull = () => {
    // A failed poll changes nothing; the next one tries again.
    if (visible()) client.pull().catch(() => {})
  }
  const timer = setInterval(pull, POLL_MS)
  document.addEventListener("visibilitychange", pull)
  return () => {
    clearInterval(timer)
    document.removeEventListener("visibilitychange", pull)
  }
}

export function useSyncClient(
  expeditionId: string,
  actor: string
): { state: SyncState; health: SyncHealth; retry: () => void } {
  const [state, setState] = React.useState<SyncState>({
    status: "opening",
    attempt: 0,
  })
  const [health, setHealth] = React.useState<SyncHealth>({
    pending: 0,
    offline: false,
  })
  const [nonce, setNonce] = React.useState(0)
  const retry = React.useCallback(() => setNonce((n) => n + 1), [])

  React.useEffect(() => {
    let cancelled = false
    let client: SyncClient | null = null
    let cached: { client: SyncClient; savedAt: number } | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopPolling: (() => void) | null = null
    let stopKeeping: (() => void) | null = null
    let attempt = 0
    let inFlight = false

    const store = new CountingStore(idbStore(), (pending) => {
      if (!cancelled)
        setHealth((h) => ({
          pending,
          // A save after a successful push clears the ops; stay "offline"
          // only while something is still waiting.
          offline: pending > 0 && h.offline,
        }))
    })

    /** This device's saved copy as a read-only client, or null. */
    const openCached = async (): Promise<typeof cached> => {
      const saved = await offlineCache()
        ?.get(actor, expeditionId)
        .catch(() => null)
      if (!saved || cancelled) return null
      // Count the edits still waiting on this device (the header shows them).
      await store.load({ expeditionId, actor }).catch(() => undefined)
      const c = openCachedClient(
        {
          expeditionId,
          actor,
          collections: { id: `seply:${expeditionId}:${++clientCount}` },
        },
        { state: saved.state, headSeq: saved.entry.headSeq }
      )
      if (cancelled) {
        c.dispose()
        return null
      }
      cached = { client: c, savedAt: saved.entry.savedAt ?? Date.now() }
      return cached
    }

    const open = async () => {
      if (!cached) setState({ status: "opening", attempt })
      inFlight = true
      try {
        const opened = await openSyncClient({
          expeditionId,
          actor,
          transport: fetchTransport(),
          store,
          // Unique per client: StrictMode and remounts briefly overlap two.
          collections: { id: `seply:${expeditionId}:${++clientCount}` },
          onError: (e) => {
            if (cancelled) return
            console.warn("sync:", e)
            if (!(e instanceof SyncHttpError))
              setHealth((h) => ({ ...h, offline: true }))
          },
        })
        if (cancelled) {
          opened.dispose()
          return
        }
        client = opened
        cached?.client.dispose()
        cached = null
        stopPolling = pollWhileVisible(opened)
        stopKeeping = keepOffline(actor, opened)
        setHealth((h) => ({ ...h, offline: false }))
        setState({ status: "ready", client: opened })
      } catch (error) {
        if (cancelled) return
        attempt += 1
        const unreachable = !(error instanceof SyncHttpError)
        const copy = cached ?? (unreachable ? await openCached() : null)
        if (cancelled) return
        if (copy) setState({ status: "cached", ...copy, attempt })
        else setState({ status: "failed", error, attempt })
        setHealth((h) => ({ ...h, offline: unreachable }))
        if (isRetryable(error))
          timer = setTimeout(open, Math.min(1000 * 2 ** (attempt - 1), 30_000))
      } finally {
        inFlight = false
      }
    }
    void open()
    // Back online: try again now, not at the next backoff.
    const onOnline = () => {
      if (client || cancelled || inFlight) return
      if (timer) clearTimeout(timer)
      timer = null
      void open()
    }
    window.addEventListener("online", onOnline)

    return () => {
      cancelled = true
      window.removeEventListener("online", onOnline)
      if (timer) clearTimeout(timer)
      stopPolling?.()
      stopKeeping?.()
      client?.dispose()
      cached?.client.dispose()
    }
  }, [expeditionId, actor, nonce])

  return { state, health, retry }
}
