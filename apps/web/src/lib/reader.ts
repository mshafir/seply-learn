// The reader's own state (spec §1.7), in context: one @umbel/sync
// ReaderClient for whoever is reading, signed in or not. <ReaderProvider>
// (components/) opens it for the session: a signed-in reader's marks are
// saved through /api/reader (queued in IndexedDB while offline); an anonymous
// reader's stay in this browser until they sign in, when they merge into the
// account.
import * as React from "react"
import {
  coveredConcepts,
  emptyReaderState,
  parsePersonalSettings,
  type ReaderState,
  type ViewTypeId,
} from "@umbel/domain"
import type { ReaderClient } from "@umbel/sync"

export const ReaderContext = React.createContext<ReaderClient | null>(null)

/** The reader client, or null while the session is loading. */
export function useReader(): ReaderClient | null {
  return React.useContext(ReaderContext)
}

const EMPTY = emptyReaderState()

/** One Expedition's reader state, live. */
export function useReaderState(expeditionId: string): ReaderState {
  const reader = useReader()
  const subscribe = React.useCallback(
    (fn: () => void) => reader?.subscribe(fn) ?? (() => {}),
    [reader]
  )
  return React.useSyncExternalStore(subscribe, () =>
    reader ? reader.getState(expeditionId) : EMPTY
  )
}

/** Concepts read or known (the same object until the state changes). */
export function useCovered(state: ReaderState): ReadonlySet<string> {
  return React.useMemo(() => coveredConcepts(state), [state])
}

/**
 * Loads the reader's state for an Expedition from the server (other devices'
 * marks), again whenever the tab comes back into view, and saves anything
 * queued offline when the connection returns. `loaded` turns true once the
 * browser's copy is read and the first fetch has settled (or failed).
 */
export function useReaderSync(expeditionId: string): { loaded: boolean } {
  const reader = useReader()
  const [loaded, setLoaded] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!reader) return
    let cancelled = false
    const refresh = () =>
      reader.refresh(expeditionId).catch((e) => {
        console.warn("reader: refresh failed", e)
      })
    void refresh().finally(() => {
      if (!cancelled) setLoaded(expeditionId)
    })
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    const onOnline = () => {
      void reader.flush()
      void refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", onOnline)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onOnline)
    }
  }, [reader, expeditionId])
  return { loaded: loaded === expeditionId }
}

/** Labels for the personal settings a View Type has (spec §3.6 "your settings"). */
export const PERSONAL_SETTING_LABELS: Record<string, string> = {
  showAllSteps: "Show all steps",
  hideRead: "Hide what I've read",
}

/** The reader's personal settings for a View, with the View Type's defaults. */
export function effectivePersonal(
  viewType: string,
  own: Record<string, unknown> | undefined
): Record<string, unknown> {
  const parsed = parsePersonalSettings(viewType as ViewTypeId, own ?? {})
  if (parsed.success) return parsed.data
  const defaults = parsePersonalSettings(viewType as ViewTypeId, {})
  return defaults.success ? defaults.data : {}
}
