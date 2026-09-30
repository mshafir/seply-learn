// Offline reading (spec §2.9): the page's one offline cache (@seply/sync's
// OfflineCache over IndexedDB, database "seply-offline"). The Expedition
// screen saves what it reads (lib/sync.ts); the Library lists what is kept
// and pins Expeditions ("Keep available offline"). The service worker only
// caches the app itself; Expeditions live here.
import * as React from "react"
import {
  fetchSnapshot,
  fetchTransport,
  IndexedDbOfflineCacheStore,
  OfflineCache,
  type OfflineEntry,
} from "@seply/sync"

let shared: OfflineCache | null = null
/** The page's offline cache (null where IndexedDB is missing). */
export function offlineCache(): OfflineCache | null {
  if (typeof indexedDB === "undefined") return null
  shared ??= new OfflineCache({ store: new IndexedDbOfflineCacheStore() })
  return shared
}

// The Library re-reads the list when the cache changes in this page.
const listeners = new Set<() => void>()
function changed() {
  for (const fn of listeners) fn()
}

/** Saves (and, when `opened`, moves to the front) an Expedition's state. */
export async function saveForOffline(
  actor: string,
  snapshot: Parameters<OfflineCache["save"]>[1],
  opened: boolean
): Promise<void> {
  await offlineCache()?.save(actor, snapshot, { opened })
  changed()
}

/**
 * "Keep available offline": pins the Expedition and, if it isn't saved on
 * this device yet, downloads it now. Unpinning may drop it from the cache.
 */
export async function setKeptOffline(
  actor: string,
  expedition: { id: string; title: string },
  keep: boolean
): Promise<void> {
  const cache = offlineCache()
  if (!cache) return
  await cache.setPinned(actor, expedition.id, keep, expedition.title)
  changed()
  if (keep && !(await cache.get(actor, expedition.id))) {
    const snapshot = await fetchSnapshot(fetchTransport(), expedition.id)
    await cache.save(actor, snapshot, { opened: false })
    changed()
  }
}

/** Forgets a user's saved Expeditions (on sign-out: a shared device). */
export async function clearOffline(actor: string): Promise<void> {
  await offlineCache()?.clear(actor)
  changed()
}

/** The user's saved and pinned Expeditions, live within this page. */
export function useOfflineEntries(actor: string | null): OfflineEntry[] {
  const [entries, setEntries] = React.useState<OfflineEntry[]>([])
  React.useEffect(() => {
    const cache = offlineCache()
    if (!actor || !cache) return
    let cancelled = false
    const load = () =>
      cache.list(actor).then(
        (list) => {
          if (!cancelled) setEntries(list)
        },
        () => {}
      )
    listeners.add(load)
    void load()
    return () => {
      cancelled = true
      listeners.delete(load)
    }
  }, [actor])
  return actor ? entries : []
}

const subscribeOnline = (fn: () => void) => {
  window.addEventListener("online", fn)
  window.addEventListener("offline", fn)
  return () => {
    window.removeEventListener("online", fn)
    window.removeEventListener("offline", fn)
  }
}

/** The browser's idea of whether it is online. */
export function useOnline(): boolean {
  return React.useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  )
}

const asOf = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

/** "Sep 29, 2026, 9:14 PM": when a saved copy was taken. */
export const formatAsOf = (ms: number) => asOf.format(new Date(ms))
