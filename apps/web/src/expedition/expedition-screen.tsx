// The Expedition screen (spec §3.6): header, then three panes. The Views
// rail (272 px), the canvas (as wide as possible, with the floating View
// button) and the side panel (440 px, opened by a selection; a Sheet on
// narrow windows). Everything reads the sync client's live collections, and
// the reader's own state (Reading status, personal View settings, position)
// from the reader client (lib/reader.ts).
//
// Signed out, a public or unlisted Expedition opens read-only; a private one
// is "not found", with a way to sign in.
import * as React from "react"
import { RotateCwIcon, SearchXIcon } from "lucide-react"
import { Link, useLocation } from "wouter"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@umbel/ui/components/alert"
import { Button, buttonVariants } from "@umbel/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@umbel/ui/components/empty"
import { SidebarProvider } from "@umbel/ui/components/sidebar"
import { Skeleton } from "@umbel/ui/components/skeleton"
import { SyncHttpError, type SyncClient } from "@umbel/sync"
import type { ViewStatusChip } from "@umbel/views"

import { CanvasSlot } from "@/expedition/canvas-slot.tsx"
import { ConceptSearch } from "@/expedition/concept-search.tsx"
import { resumeFrom, samePlace, type Place } from "@/expedition/continue.ts"
import { ExpeditionHeader } from "@/expedition/expedition-header.tsx"
import { kindLabel } from "@/expedition/labels.ts"
import {
  HEADER_HEIGHT,
  INLINE_PANEL_QUERY,
  RAIL_WIDTH,
} from "@/expedition/layout.ts"
import type { ConceptReading } from "@/expedition/concept-panel.tsx"
import {
  back,
  openConcept,
  pruneStack,
  push,
  type BackStack,
} from "@/expedition/reading.ts"
import { SidePanel, type PanelContent } from "@/expedition/side-panel.tsx"
import { StatusChip } from "@/expedition/status-chip.tsx"
import { useExpeditionData } from "@/expedition/use-expedition-data.ts"
import { ViewButton } from "@/expedition/view-button.tsx"
import { ViewsRail } from "@/expedition/views-rail.tsx"
import { listExpeditions, type Role } from "@/lib/api.ts"
import { usePersonalViewSettings } from "@/lib/personal-view-settings.ts"
import {
  useCovered,
  useReader,
  useReaderPersonalStore,
  useReaderState,
  useReaderSync,
} from "@/lib/reader.ts"
import { matchConcepts } from "@/lib/search.ts"
import { useSession } from "@/lib/session.ts"
import { useSyncClient, type SyncHealth } from "@/lib/sync.ts"
import { useMediaQuery } from "@/lib/use-media-query.ts"

const frameStyle = {
  "--sidebar-width": RAIL_WIDTH,
  "--header-height": HEADER_HEIGHT,
} as React.CSSProperties

/** Signed-out readers pull as nobody; they never push. */
const ANONYMOUS_ACTOR = "anonymous"

/** "Sign in" that comes back here. */
const signInHrefFor = (expeditionId: string) =>
  `/sign-in?next=${encodeURIComponent(`/e/${expeditionId}`)}`

export function ExpeditionScreen({
  expeditionId,
  viewId,
}: {
  expeditionId: string
  viewId?: string
}) {
  const { session } = useSession()
  const user = session.status === "signed-in" ? session.user : null
  const actor = user?.id ?? ANONYMOUS_ACTOR
  const { state, health, retry } = useSyncClient(expeditionId, actor)
  const role = useRole(expeditionId, !!user)
  const signInHref = user ? null : signInHrefFor(expeditionId)

  return (
    <SidebarProvider
      style={frameStyle}
      className="h-svh min-h-0 flex-col overflow-hidden"
    >
      {state.status === "ready" ? (
        <ExpeditionFrame
          key={expeditionId}
          expeditionId={expeditionId}
          client={state.client}
          viewId={viewId}
          userId={actor}
          canEdit={role === "owner" || role === "editor"}
          health={health}
          signInHref={signInHref}
        />
      ) : (
        <>
          <ExpeditionHeader
            title=""
            canEdit={false}
            health={health}
            signInHref={signInHref}
          />
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            {state.status === "opening" ? (
              <Skeleton
                data-testid="expedition-loading"
                className="size-full rounded-xl"
              />
            ) : state.error instanceof SyncHttpError &&
              state.error.status === 404 ? (
              <NotFound signInHref={signInHref} />
            ) : (
              <Alert className="max-w-lg" data-testid="expedition-offline">
                <AlertTitle>Can't reach the server</AlertTitle>
                <AlertDescription>
                  {health.pending > 0
                    ? "Your edits are saved on this device and will be sent when the connection is back. "
                    : ""}
                  Trying again…
                </AlertDescription>
                <AlertAction>
                  <Button size="sm" variant="outline" onClick={retry}>
                    <RotateCwIcon />
                    Retry
                  </Button>
                </AlertAction>
              </Alert>
            )}
          </div>
        </>
      )}
    </SidebarProvider>
  )
}

function NotFound({ signInHref }: { signInHref: string | null }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>Expedition not found</EmptyTitle>
        <EmptyDescription>
          {signInHref
            ? "It doesn't exist, or it's private. Sign in to see the ones shared with you."
            : "It doesn't exist, or it isn't shared with you."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {signInHref ? (
          <Link href={signInHref} className={buttonVariants()}>
            Sign in
          </Link>
        ) : (
          <Link href="/" className={buttonVariants()}>
            Back to the Library
          </Link>
        )}
      </EmptyContent>
    </Empty>
  )
}

/** My role on this Expedition (from the Library list), or null. */
function useRole(expeditionId: string, signedIn: boolean): Role | null {
  const [role, setRole] = React.useState<Role | null>(null)
  React.useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    listExpeditions().then(
      (list) => {
        if (!cancelled)
          setRole(list.find((e) => e.id === expeditionId)?.role ?? null)
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [expeditionId, signedIn])
  return signedIn ? role : null
}

/** What the side panel shows: a Concept (with its back stack) or the View. */
type Panel = { type: "concept"; stack: BackStack } | { type: "view" } | null

/** How long the screen waits on a place before saving it as the position. */
const POSITION_DELAY_MS = 800

function ExpeditionFrame({
  expeditionId,
  client,
  viewId,
  userId,
  canEdit,
  health,
  signInHref,
}: {
  expeditionId: string
  client: SyncClient
  viewId?: string
  userId: string
  canEdit: boolean
  health: SyncHealth
  signInHref: string | null
}) {
  const [, navigate] = useLocation()
  const data = useExpeditionData(client.collections)
  const inlinePanel = useMediaQuery(INLINE_PANEL_QUERY)
  // A Concept picked in global search arrives as ?concept=<id>.
  const [conceptParam] = React.useState(() =>
    new URLSearchParams(window.location.search).get("concept")
  )
  const [panel, setPanel] = React.useState<Panel>(() =>
    conceptParam ? { type: "concept", stack: openConcept(conceptParam) } : null
  )
  const [query, setQuery] = React.useState("")
  const [settledViewId, setSettledViewId] = React.useState<string | null>(null)

  const reader = useReader()
  const readerState = useReaderState(expeditionId)
  const covered = useCovered(readerState)
  const { loaded: readerLoaded } = useReaderSync(expeditionId)

  const expedition = data.expedition
  // The URL's View, else the best View, else the first.
  const startView =
    data.views.find((v) => v.id === expedition?.bestViewId) ??
    data.views[0] ??
    null
  const view = data.views.find((v) => v.id === viewId) ?? startView

  // Personal settings live with the reader's other state (per reader, saved
  // through the reader API; an anonymous reader's stay in this browser).
  const personalStore = useReaderPersonalStore(expeditionId)
  const personal = usePersonalViewSettings(userId, view, personalStore)
  // The View's status chip, as it reports it (null: none).
  const [status, setStatus] = React.useState<ViewStatusChip | null>(null)

  const conceptById = React.useMemo(
    () => new Map(data.concepts.map((c) => [c.id, c])),
    [data.concepts]
  )
  const matches = React.useMemo(
    () => matchConcepts(data.concepts, query),
    [data.concepts, query]
  )
  // The back stack, without places whose Concept has gone (deleted, merged).
  const stack =
    panel?.type === "concept"
      ? pruneStack(panel.stack, (id) => conceptById.has(id))
      : []
  const place = stack[stack.length - 1]
  const selectedConcept = place ? conceptById.get(place.conceptId) : undefined

  // Continue reading: opened without a View (or Concept) in the URL, land
  // where the reader left off, once both the data and the reader's state are
  // in. (Adjusting state during render, not in an effect; the URL follows.)
  const [landed, setLanded] = React.useState(false)
  const [resumed, setResumed] = React.useState(false)
  const [resumeView, setResumeView] = React.useState<string | null>(null)
  if (!landed && readerLoaded && data.views.length > 0) {
    setLanded(true)
    const to =
      viewId || conceptParam
        ? null
        : resumeFrom(
            readerState.position,
            (id) => data.views.some((v) => v.id === id),
            (id) => conceptById.has(id)
          )
    if (to) {
      if (to.viewId && to.viewId !== view?.id) setResumeView(to.viewId)
      if (to.stack) setPanel({ type: "concept", stack: to.stack })
      setResumed(true)
    }
  }
  React.useEffect(() => {
    if (resumeView)
      navigate(`/e/${expeditionId}/${resumeView}`, { replace: true })
  }, [resumeView, expeditionId, navigate])

  // Save where the reader is, once they've stayed a moment.
  const here: Place = {
    viewId: view?.id ?? null,
    focusConceptId: selectedConcept?.id ?? null,
    panelDepth: place?.depth ?? null,
  }
  const hereKey = JSON.stringify(here)
  React.useEffect(() => {
    if (!landed || !reader) return
    const at: Place = JSON.parse(hereKey)
    if (!at.viewId || samePlace(readerState.position, at)) return
    const t = setTimeout(
      () => reader.setPosition(expeditionId, at),
      POSITION_DELAY_MS
    )
    return () => clearTimeout(t)
  }, [landed, reader, expeditionId, hereKey, readerState.position])

  const backToStart = () => {
    setResumed(false)
    setPanel(null)
    if (startView) navigate(`/e/${expeditionId}/${startView.id}`)
  }

  const reading: ConceptReading = {
    data,
    conceptById,
    onNavigate: (entry) =>
      setPanel((p) =>
        p?.type === "concept" ? { ...p, stack: push(p.stack, entry) } : p
      ),
    onBack:
      stack.length > 1
        ? () =>
            setPanel((p) =>
              p?.type === "concept"
                ? {
                    ...p,
                    stack: back(
                      pruneStack(p.stack, (id) => conceptById.has(id))
                    ),
                  }
                : p
            )
        : null,
    previous: stack.length > 1 ? stack[stack.length - 2]! : null,
  }

  const markKnown = (conceptId: string) =>
    reader?.markReading(expeditionId, conceptId, "known")
  // Anonymous readers get the hint once they've marked something.
  const hintHref =
    signInHref && reader?.anonymous && reader.readingCount > 0
      ? signInHref
      : null

  const content: PanelContent | null =
    panel?.type === "view" && view
      ? {
          type: "view",
          view,
          data,
          collections: client.collections,
          canEdit,
          personal,
          onDuplicated: (id) => navigate(`/e/${expeditionId}/${id}`),
        }
      : selectedConcept && place
        ? {
            type: "concept",
            concept: selectedConcept,
            depth: place.depth,
            kindLabel: kindLabel(selectedConcept.kind, data.kindDefs),
            reading,
            status: readerState.reading[selectedConcept.id]?.state ?? "unread",
            onStatus: (state) =>
              reader?.markReading(expeditionId, selectedConcept.id, state),
            signInHref: hintHref,
          }
        : null

  const rename = (title: string) => {
    if (!expedition) return
    client.collections.expeditions.update(expedition.id, (draft) => {
      draft.title = title
    })
  }

  return (
    <>
      <ExpeditionHeader
        title={expedition?.title ?? ""}
        canEdit={canEdit}
        onRename={rename}
        health={health}
        signInHref={signInHref}
        search={
          <ConceptSearch
            query={query}
            onQueryChange={setQuery}
            matchCount={matches?.size}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <ViewsRail
          views={data.views}
          selectedViewId={view?.id ?? null}
          onSelectView={(id) => {
            setResumed(false)
            navigate(`/e/${expeditionId}/${id}`)
          }}
        />
        <main
          data-testid="canvas-pane"
          data-settled={view && settledViewId === view.id ? "" : undefined}
          aria-label="Canvas"
          className="relative min-w-0 flex-1 overflow-hidden bg-background"
        >
          {view ? (
            <>
              <CanvasSlot
                collections={client.collections}
                viewId={view.id}
                selectedConceptId={selectedConcept?.id ?? null}
                onSelectConcept={(id) =>
                  setPanel(
                    id ? { type: "concept", stack: openConcept(id) } : null
                  )
                }
                onSettled={() => setSettledViewId(view.id)}
                personal={personal.values}
                onPersonalChange={personal.set}
                onStatus={setStatus}
                matches={matches}
                covered={covered}
                onMarkKnown={markKnown}
              />
              <ViewButton
                view={view}
                open={panel?.type === "view"}
                onClick={() =>
                  setPanel((p) =>
                    p?.type === "view" ? null : { type: "view" }
                  )
                }
                className="absolute top-4 left-4 z-10"
              />
              {status && (
                <StatusChip
                  status={status}
                  className="absolute bottom-4 left-1/2 z-10 max-w-[calc(100%-2rem)] -translate-x-1/2"
                />
              )}
              {resumed && (
                <div className="absolute right-4 bottom-4 z-10">
                  <Alert data-testid="resumed" className="shadow-sm">
                    <AlertTitle>Continuing where you left off</AlertTitle>
                    <AlertDescription>
                      <Button
                        size="xs"
                        variant="link"
                        className="h-auto p-0"
                        onClick={backToStart}
                      >
                        Back to the start
                      </Button>
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </>
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>No Views yet</EmptyTitle>
                <EmptyDescription>
                  This Expedition has {data.concepts.length} Concepts and no
                  Views to read them through.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </main>
        <SidePanel
          content={content}
          inline={inlinePanel}
          onClose={() => setPanel(null)}
        />
      </div>
    </>
  )
}
