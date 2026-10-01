// The Expedition's pending Proposals (GET /api/expeditions/:id/proposals),
// for owners and editors online, and the preview overlay that draws them
// dashed on the canvas (WP-4.3).
//
// - The list loads when the screen opens, again when the window regains
//   focus, every POLL_MS while visible, and whenever `refresh` is called
//   (after a review, an undo, an article ask finishing, or a room `poke`:
//   the server pokes the room whenever Proposals change). A new MCP
//   Proposal arriving after the first load calls `onNewMcp` (the toast).
// - `ingest` merges a Proposal from elsewhere: WP-4.4's Grow asks stream
//   `data-proposal` parts (a `ProposalView`, keyed by id; a later part
//   replaces an earlier one), so items appear while the ask runs.
// - `usePreview` is the View-as-of pattern: the live state with every
//   pending item applied (`previewProposals`), as a read-only client the
//   canvas and panels read, plus which Concepts and Relationships to dash.
import * as React from "react"
import { previewProposals, type Suggested } from "@seply/domain"
import { openCachedClient, type SyncClient } from "@seply/sync"

import { listProposals, type ProposalView } from "@/lib/api.ts"
import { pendingPool } from "@/expedition/suggestions.ts"

/** How often the list is fetched again while the window is visible. */
export const POLL_MS = 30_000

export type ProposalList = {
  /** The Proposals with pending items, oldest first. */
  proposals: ProposalView[]
  /** Pending items across them (the header's count). */
  count: number
  loading: boolean
  error: unknown
  refresh: () => Promise<void>
  /** Merges a Proposal streamed or fetched elsewhere (replaces by id). */
  ingest: (p: ProposalView) => void
}

export function useProposals({
  expeditionId,
  enabled,
  onNewMcp,
}: {
  expeditionId: string
  enabled: boolean
  /** A Proposal from an MCP agent appeared after the first load. */
  onNewMcp?: (p: ProposalView) => void
}): ProposalList {
  const [state, setState] = React.useState<{
    proposals: ProposalView[]
    loading: boolean
    error: unknown
  }>({ proposals: [], loading: true, error: null })
  // Proposal ids seen so far (null until the first load).
  const seen = React.useRef<Set<string> | null>(null)
  const onNew = React.useRef(onNewMcp)
  React.useEffect(() => {
    onNew.current = onNewMcp
  })

  const refresh = React.useCallback(async () => {
    if (!enabled) return
    try {
      const proposals = await listProposals(expeditionId)
      const known = seen.current
      if (known)
        for (const p of proposals)
          if (!known.has(p.id) && p.origin === "mcp") onNew.current?.(p)
      seen.current = new Set([...(known ?? []), ...proposals.map((p) => p.id)])
      setState({ proposals, loading: false, error: null })
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }))
    }
  }, [expeditionId, enabled])

  React.useEffect(() => {
    if (!enabled) return
    void refresh()
    const onFocus = () => void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, POLL_MS)
    window.addEventListener("focus", onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [enabled, refresh])

  const ingest = React.useCallback((p: ProposalView) => {
    seen.current?.add(p.id)
    setState((s) => {
      const rest = s.proposals.filter((q) => q.id !== p.id)
      const open = p.items.some((i) => i.status === "pending")
      return {
        ...s,
        proposals: open
          ? [...rest, p].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          : rest,
      }
    })
  }, [])

  const proposals = enabled ? state.proposals : NONE
  return {
    proposals,
    count: React.useMemo(() => pendingPool(proposals).length, [proposals]),
    loading: enabled && state.loading,
    error: state.error,
    refresh,
    ingest,
  }
}

const NONE: ProposalView[] = []

/** Waits this long after the live state changes before redrawing the preview. */
const PREVIEW_DEBOUNCE_MS = 150

let previewCount = 0

export type Preview = {
  /** A read-only client over the live state with the pending items applied. */
  client: SyncClient
  suggested: Suggested
  /** Items that don't apply to the live state any more (not drawn). */
  skipped: string[]
}

/**
 * The preview overlay while `enabled` and something is pending; null
 * otherwise. Rebuilt when the items or the live state change.
 */
export function usePreview(
  client: SyncClient,
  proposals: readonly ProposalView[],
  enabled: boolean
): Preview | null {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = client.engine.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setVersion((v) => v + 1), PREVIEW_DEBOUNCE_MS)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [client, enabled])

  const items = React.useMemo(() => pendingPool(proposals), [proposals])
  const preview = React.useMemo(() => {
    void version
    if (!enabled || !items.length) return null
    const { engine } = client
    const p = previewProposals(engine.state, items)
    const expeditionId = engine.expeditionId
    return {
      client: openCachedClient(
        {
          expeditionId,
          actor: engine.actor,
          collections: {
            id: `seply:${expeditionId}:preview:${++previewCount}`,
          },
        },
        { state: p.state, headSeq: engine.headSeq }
      ),
      suggested: p.suggested,
      skipped: p.skipped,
    }
  }, [client, items, enabled, version])
  React.useEffect(() => () => preview?.client.dispose(), [preview])
  return preview
}
