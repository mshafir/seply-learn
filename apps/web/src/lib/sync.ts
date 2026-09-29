// Opens the sync client (@umbel/sync) for one Expedition and keeps it for as
// long as the screen is mounted. Pending ops live in IndexedDB, so an edit
// made offline survives a reload and is pushed once the server is reachable.
//
// `openSyncClient` pulls before it resolves, so opening needs the server. When
// it can't reach it, the hook retries with backoff (1 s doubling to 30 s) and
// `retry()` tries again at once; the saved pending ops stay untouched until
// then.
import * as React from "react"
import {
  fetchTransport,
  IndexedDbPendingStore,
  openSyncClient,
  SyncHttpError,
  type PendingScope,
  type PendingSnapshot,
  type PendingStore,
  type SyncClient,
} from "@umbel/sync"

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
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const store = new CountingStore(idbStore(), (pending) => {
      if (!cancelled)
        setHealth((h) => ({
          pending,
          // A save after a successful push clears the ops; stay "offline"
          // only while something is still waiting.
          offline: pending > 0 && h.offline,
        }))
    })

    const open = async () => {
      setState({ status: "opening", attempt })
      try {
        const opened = await openSyncClient({
          expeditionId,
          actor,
          transport: fetchTransport(),
          store,
          // Unique per client: StrictMode and remounts briefly overlap two.
          collections: { id: `umbel:${expeditionId}:${++clientCount}` },
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
        setHealth((h) => ({ ...h, offline: false }))
        setState({ status: "ready", client: opened })
      } catch (error) {
        if (cancelled) return
        attempt += 1
        setState({ status: "failed", error, attempt })
        setHealth((h) => ({ ...h, offline: !(error instanceof SyncHttpError) }))
        if (isRetryable(error))
          timer = setTimeout(open, Math.min(1000 * 2 ** (attempt - 1), 30_000))
      }
    }
    void open()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      client?.dispose()
    }
  }, [expeditionId, actor, nonce])

  return { state, health, retry }
}
