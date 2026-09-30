// The reader's own state (spec §1.7), in context: one @seply/sync
// ReaderClient for whoever is reading, signed in or not. <ReaderProvider>
// (components/) opens it for the session: a signed-in reader's marks are
// saved through /api/reader (queued in IndexedDB while offline); an anonymous
// reader's stay in this browser until they sign in, when they merge into the
// account.
import * as React from "react"
import {
  coveredConcepts,
  emptyReaderState,
  type ReaderState,
} from "@seply/domain"
import type { ReaderClient } from "@seply/sync"

import {
  personalViewSettingsStore,
  type PersonalValues,
  type PersonalViewSettingsStore,
} from "@/lib/personal-view-settings.ts"

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

const NO_SETTINGS: PersonalValues = {}

/**
 * Personal View settings kept with the reader's other state: saved through
 * the reader API (`personal_view_settings`), so they follow the reader across
 * devices; an anonymous reader's stay in this browser. One store per
 * Expedition (marks carry their Expedition). The user id is the reader
 * client's own, so the one passed in is ignored.
 */
export class ReaderPersonalViewSettings implements PersonalViewSettingsStore {
  constructor(
    private readonly reader: ReaderClient,
    private readonly expeditionId: string
  ) {}
  get(_userId: string, viewId: string): PersonalValues {
    return (
      this.reader.getState(this.expeditionId).viewSettings[viewId]?.settings ??
      NO_SETTINGS
    )
  }
  set(_userId: string, viewId: string, values: PersonalValues): void {
    this.reader.setViewSettings(this.expeditionId, viewId, values)
  }
  subscribe(listener: () => void): () => void {
    return this.reader.subscribe(listener)
  }
}

/** The personal settings store for an Expedition: the reader's (this browser's until the session loads). */
export function useReaderPersonalStore(
  expeditionId: string
): PersonalViewSettingsStore {
  const reader = useReader()
  return React.useMemo(
    () =>
      reader
        ? new ReaderPersonalViewSettings(reader, expeditionId)
        : personalViewSettingsStore(),
    [reader, expeditionId]
  )
}
