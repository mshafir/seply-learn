// The History panel's list of Changes (GET /api/history), newest first. It
// loads when the panel opens and again a moment after the log moves (an
// edit, a pull, an undo), keeping any older pages already shown.
import * as React from "react"
import type { SyncClient } from "@seply/sync"

import { getHistory, type ChangeSummary } from "@/lib/api.ts"

/** How long after the log moves the list is fetched again. */
const REFRESH_MS = 400

export type HistoryList = {
  changes: ChangeSummary[]
  /** Older Changes remain on the server. */
  more: boolean
  loading: boolean
  error: unknown
  loadOlder: () => void
}

export function useHistory(
  expeditionId: string,
  client: SyncClient,
  enabled: boolean
): HistoryList {
  const [state, setState] = React.useState<{
    changes: ChangeSummary[]
    more: boolean
    loading: boolean
    error: unknown
  }>({ changes: [], more: false, loading: true, error: null })
  const [head, setHead] = React.useState(client.engine.headSeq)

  // Follow the confirmed log's head.
  React.useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = client.engine.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setHead(client.engine.headSeq), REFRESH_MS)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [client, enabled])

  // The newest page, again whenever the head moves; older pages stay.
  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getHistory(expeditionId).then(
      (page) => {
        if (cancelled) return
        setState((s) => {
          const fresh = new Set(page.changes.map((c) => c.id))
          const oldest = page.changes.at(-1)?.firstSeq ?? Infinity
          const older = s.changes.filter(
            (c) => !fresh.has(c.id) && c.firstSeq < oldest
          )
          return {
            changes: [...page.changes, ...older],
            more: older.length ? s.more : page.more,
            loading: false,
            error: null,
          }
        })
      },
      (error) => {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error }))
      }
    )
    return () => {
      cancelled = true
    }
  }, [expeditionId, enabled, head])

  const oldest = state.changes.at(-1)?.firstSeq
  const loadOlder = React.useCallback(() => {
    if (oldest === undefined) return
    getHistory(expeditionId, oldest).then(
      (page) =>
        setState((s) => ({
          ...s,
          changes: [
            ...s.changes,
            ...page.changes.filter(
              (c) => !s.changes.some((have) => have.id === c.id)
            ),
          ],
          more: page.more,
        })),
      (error) => setState((s) => ({ ...s, error }))
    )
  }, [expeditionId, oldest])

  return { ...state, loadOlder }
}
