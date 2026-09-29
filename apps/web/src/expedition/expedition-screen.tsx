// The Expedition screen (spec §3.6): header, then three panes. The Views
// rail (272 px), the canvas (as wide as possible, with the floating View
// button) and the side panel (440 px, opened by a selection; a Sheet on
// narrow windows). Everything reads the sync client's live collections.
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
import { useUser } from "@/lib/session.ts"
import { useSyncClient, type SyncHealth } from "@/lib/sync.ts"
import { useMediaQuery } from "@/lib/use-media-query.ts"
import { usePersonalViewSettings } from "@/lib/personal-view-settings.ts"

const frameStyle = {
  "--sidebar-width": RAIL_WIDTH,
  "--header-height": HEADER_HEIGHT,
} as React.CSSProperties

export function ExpeditionScreen({
  expeditionId,
  viewId,
}: {
  expeditionId: string
  viewId?: string
}) {
  const user = useUser()
  const { state, health, retry } = useSyncClient(expeditionId, user.id)
  const role = useRole(expeditionId)

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
          userId={user.id}
          canEdit={role === "owner" || role === "editor"}
          health={health}
        />
      ) : (
        <>
          <ExpeditionHeader title="" canEdit={false} health={health} />
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            {state.status === "opening" ? (
              <Skeleton
                data-testid="expedition-loading"
                className="size-full rounded-xl"
              />
            ) : state.error instanceof SyncHttpError &&
              state.error.status === 404 ? (
              <NotFound />
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

function NotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>Expedition not found</EmptyTitle>
        <EmptyDescription>
          It doesn't exist, or it isn't shared with you.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href="/" className={buttonVariants()}>
          Back to the Library
        </Link>
      </EmptyContent>
    </Empty>
  )
}

/** My role on this Expedition (from the Library list), or null. */
function useRole(expeditionId: string): Role | null {
  const [role, setRole] = React.useState<Role | null>(null)
  React.useEffect(() => {
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
  }, [expeditionId])
  return role
}

/** What the side panel shows: a Concept (with its back stack) or the View. */
type Panel = { type: "concept"; stack: BackStack } | { type: "view" } | null

function ExpeditionFrame({
  expeditionId,
  client,
  viewId,
  userId,
  canEdit,
  health,
}: {
  expeditionId: string
  client: SyncClient
  viewId?: string
  userId: string
  canEdit: boolean
  health: SyncHealth
}) {
  const [, navigate] = useLocation()
  const data = useExpeditionData(client.collections)
  const inlinePanel = useMediaQuery(INLINE_PANEL_QUERY)
  const [panel, setPanel] = React.useState<Panel>(null)
  const [settledViewId, setSettledViewId] = React.useState<string | null>(null)

  const expedition = data.expedition
  // The URL's View, else the best View, else the first.
  const view =
    data.views.find((v) => v.id === viewId) ??
    data.views.find((v) => v.id === expedition?.bestViewId) ??
    data.views[0] ??
    null

  const personal = usePersonalViewSettings(userId, view)
  // The View's status chip, as it reports it (null: none).
  const [status, setStatus] = React.useState<ViewStatusChip | null>(null)

  const conceptById = React.useMemo(
    () => new Map(data.concepts.map((c) => [c.id, c])),
    [data.concepts]
  )
  // The back stack, without places whose Concept has gone (deleted, merged).
  const stack =
    panel?.type === "concept"
      ? pruneStack(panel.stack, (id) => conceptById.has(id))
      : []
  const place = stack[stack.length - 1]
  const selectedConcept = place ? conceptById.get(place.conceptId) : undefined
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
      />
      <div className="flex min-h-0 flex-1">
        <ViewsRail
          views={data.views}
          selectedViewId={view?.id ?? null}
          onSelectView={(id) => navigate(`/e/${expeditionId}/${id}`)}
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
