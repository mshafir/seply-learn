// The live embed (spec §9.3; WP-7.5): /e/:id/embed?view=<viewId>&theme=…
// renders one View of a Public Expedition, read-only, for other sites to
// frame. The server answers this path only for Public Expeditions (with its
// own frame-ancestors), so this page never sees a private or unlisted one.
//
// It reads like any anonymous reader (spec §3.11): a pull with no
// credentials (the visitor's session never widens what an embed shows), then
// the live room, so edits arrive as they happen. Nothing is stored: pending
// ops live in memory and are never pushed. A kick (the Expedition went
// private) shows "not available". The View itself loads lazily.
import * as React from "react"
import {
  fetchTransport,
  MemoryPendingStore,
  openSyncClient,
  SyncHttpError,
  type SyncClient,
} from "@seply/sync"

import { Skeleton } from "@seply/ui/components/skeleton"

import { useRoom } from "@/expedition/use-room.ts"
import type { EmbedParams, EmbedTheme } from "./params.ts"

const EmbedView = React.lazy(() => import("./embed-view.tsx"))

/** Embeds read as nobody: they never push. */
const ANONYMOUS_ACTOR = "anonymous"

/** Never sends the visitor's cookies: an embed reads only what anyone may. */
const anonymousFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "omit" })

type EmbedState =
  | { status: "opening" }
  | { status: "ready"; client: SyncClient }
  | { status: "gone" }
  | { status: "failed" }

let clientCount = 0

function useEmbedClient(expeditionId: string) {
  const [state, setState] = React.useState<EmbedState>({ status: "opening" })
  React.useEffect(() => {
    let cancelled = false
    let client: SyncClient | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    const open = async () => {
      try {
        const opened = await openSyncClient({
          expeditionId,
          actor: ANONYMOUS_ACTOR,
          transport: fetchTransport({ fetch: anonymousFetch }),
          store: new MemoryPendingStore(),
          autoPush: false,
          collections: { id: `seply-embed:${expeditionId}:${++clientCount}` },
          onError: (e) => console.warn("embed: sync", e),
        })
        if (cancelled) return opened.dispose()
        client = opened
        setState({ status: "ready", client: opened })
      } catch (error) {
        if (cancelled) return
        if (
          error instanceof SyncHttpError &&
          (error.status === 403 || error.status === 404)
        )
          return setState({ status: "gone" })
        attempt += 1
        setState({ status: "failed" })
        timer = setTimeout(open, Math.min(1000 * 2 ** (attempt - 1), 30_000))
      }
    }
    void open()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      client?.dispose()
    }
  }, [expeditionId])
  return { state, gone: () => setState({ status: "gone" }) }
}

/** `?theme=` wins; otherwise follow the system as it changes (embed.html sets the first paint). */
function useEmbedTheme(theme: EmbedTheme) {
  React.useEffect(() => {
    const root = document.documentElement
    const apply = (dark: boolean) => {
      root.classList.toggle("dark", dark)
      root.style.colorScheme = dark ? "dark" : "light"
    }
    if (theme !== "system") return apply(theme === "dark")
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    apply(query.matches)
    const onChange = () => apply(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [theme])
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="embed-message"
      className="flex h-svh items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  )
}

const Loading = () => (
  <div className="h-svh bg-background p-3">
    <Skeleton data-testid="embed-loading" className="size-full rounded-xl" />
  </div>
)

export function EmbedScreen({ params }: { params: EmbedParams | null }) {
  useEmbedTheme(params?.theme ?? "system")
  if (!params) return <Message>This Expedition isn't available.</Message>
  return <LiveEmbed {...params} />
}

function LiveEmbed({ expeditionId, viewId }: EmbedParams) {
  const { state, gone } = useEmbedClient(expeditionId)
  if (state.status === "opening") return <Loading />
  if (state.status === "gone")
    return <Message>This Expedition isn't available.</Message>
  if (state.status === "failed")
    return <Message>Can't reach Seply Learn. Trying again…</Message>
  return (
    <Live
      expeditionId={expeditionId}
      client={state.client}
      viewId={viewId}
      onGone={gone}
    />
  )
}

function Live({
  expeditionId,
  client,
  viewId,
  onGone,
}: {
  expeditionId: string
  client: SyncClient
  viewId: string | null
  onGone: () => void
}) {
  useRoom({ expeditionId, client, enabled: true, onKicked: onGone })
  return (
    <React.Suspense fallback={<Loading />}>
      <EmbedView
        expeditionId={expeditionId}
        collections={client.collections}
        viewId={viewId}
      />
    </React.Suspense>
  )
}
