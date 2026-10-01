// The Expedition screen (spec §3.6): header, then three panes. The Views
// rail (272 px), the canvas (as wide as possible, with the floating View
// button) and the side panel (440 px, opened by a selection; a Sheet on
// narrow windows). Everything reads the sync client's live collections, and
// the reader's own state (Reading status, personal View settings, position)
// from the reader client (lib/reader.ts).
//
// Signed out, a public or unlisted Expedition opens read-only; a private one
// is "not found", with a way to sign in.
//
// Building (spec §3.5, WP-3.7): the rail shows each View's build status, a
// View still building shows its skeleton (view-skeleton.tsx) and a failed one
// its card (failed-view-card.tsx); the first View to finish opens by itself
// (opened without a View in the URL, the screen shows the best View once it
// is ready, else the first ready one; `startViewOf`); a toast announces each View as it
// finishes; the header's activity indicator (build-activity.tsx) holds
// Cancel and "Leave it building"; the spending cap pauses with Continue or
// Stop. Builds come from the room (use-builds.ts); signed out or offline
// there are none, and Views show their logged status only.
//
// Live (spec §2.4, WP-4.1): every reader online is in the Expedition's room
// (use-room.ts), which brings other people's edits as they are made.
// Collaborators also see each other: avatars in the header and cursors on
// the canvas (presence-avatars.tsx, live-cursors.tsx), and send their View,
// selection and pointer.
//
// Offline (spec §2.9), an Expedition saved on this device opens from that
// copy, read-only, with an "Offline, as of …" chip; without a copy the
// screen says it can't reach the server. Either way it keeps retrying.
import * as React from "react"
import { CirclePauseIcon, RotateCwIcon, SearchXIcon } from "lucide-react"
import { Link, useLocation } from "wouter"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@seply/ui/components/alert"
import { Button, buttonVariants } from "@seply/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@seply/ui/components/empty"
import { Skeleton } from "@seply/ui/components/skeleton"
import { toast } from "@seply/ui/components/toast"
import {
  keyBetween,
  parseSharedSettings,
  ulid,
  VIEW_TYPES,
  type BuildEvent,
  type ViewTypeId,
} from "@seply/domain"
import { SyncHttpError, type SyncClient, type ViewRow } from "@seply/sync"
import type { ViewStatusChip } from "@seply/views"

import { BuildActivity } from "@/expedition/build-activity.tsx"
import {
  articleAsk,
  buildSummary,
  retryableJob,
  startViewOf,
  viewBuild,
} from "@/expedition/build-state.ts"
import { FailedViewCard } from "@/expedition/failed-view-card.tsx"
import { useBuilds } from "@/expedition/use-builds.ts"
import { LiveCursors } from "@/expedition/live-cursors.tsx"
import { PresenceAvatars } from "@/expedition/presence-avatars.tsx"
import {
  useCursorSender,
  usePresenceAvatars,
} from "@/expedition/use-presence.ts"
import { useRoom } from "@/expedition/use-room.ts"
import { ViewSkeleton } from "@/expedition/view-skeleton.tsx"
import { CanvasSlot } from "@/expedition/canvas-slot.tsx"
import { ConceptSearch } from "@/expedition/concept-search.tsx"
import { resumeFrom, samePlace, type Place } from "@/expedition/continue.ts"
import { ExpeditionHeader } from "@/expedition/expedition-header.tsx"
import { OfflineChip } from "@/expedition/offline-chip.tsx"
import { kindLabel, VIEW_TYPE_META, viewTypeMeta } from "@/expedition/labels.ts"
import {
  HEADER_HEIGHT,
  INLINE_PANEL_QUERY,
  VIEWS_BAR_HEIGHT,
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
import { SourceViewer, type SourceTarget } from "@/expedition/source-viewer.tsx"
import { StatusChip } from "@/expedition/status-chip.tsx"
import { useExpeditionData } from "@/expedition/use-expedition-data.ts"
import { ViewButton } from "@/expedition/view-button.tsx"
import { ViewsBar } from "@/expedition/views-bar.tsx"
import { ApiError, listExpeditions, startJob, type Role } from "@/lib/api.ts"
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
  "--header-height": HEADER_HEIGHT,
  "--views-bar-height": VIEWS_BAR_HEIGHT,
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
    <div
      style={frameStyle}
      className="flex h-svh min-h-0 flex-col overflow-hidden"
    >
      {state.status === "ready" || state.status === "cached" ? (
        <ExpeditionFrame
          // A new client (the saved copy, then the live one) starts afresh.
          key={`${expeditionId}:${state.status}`}
          expeditionId={expeditionId}
          client={state.client}
          viewId={viewId}
          userId={actor}
          canEdit={
            state.status === "ready" && (role === "owner" || role === "editor")
          }
          health={health}
          signInHref={signInHref}
          offlineSince={state.status === "cached" ? state.savedAt : null}
          onRetry={retry}
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
    </div>
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
  offlineSince,
  onRetry,
}: {
  expeditionId: string
  client: SyncClient
  viewId?: string
  userId: string
  canEdit: boolean
  health: SyncHealth
  signInHref: string | null
  /** Reading this device's saved copy, taken then (ms); null when live. */
  offlineSince: number | null
  onRetry: () => void
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
  // A provenance link opened in a new tab arrives as ?source=<id>&segment=<id>.
  const [sourceTarget, setSourceTarget] = React.useState<SourceTarget | null>(
    () => {
      const params = new URLSearchParams(window.location.search)
      const sourceId = params.get("source")
      return sourceId ? { sourceId, segment: params.get("segment") } : null
    }
  )
  const [query, setQuery] = React.useState("")
  const [settledViewId, setSettledViewId] = React.useState<string | null>(null)

  const reader = useReader()
  const readerState = useReaderState(expeditionId)
  const covered = useCovered(readerState)
  const { loaded: readerLoaded } = useReaderSync(expeditionId)

  const expedition = data.expedition

  // The live room, for every reader while online; kicked, the screen reopens
  // (which checks access again).
  const { room } = useRoom({
    expeditionId,
    client,
    enabled: offlineSince === null,
    onKicked: (reason) => {
      toast.add({ title: "Disconnected", description: reason })
      onRetry()
    },
  })
  const selfUserId = signInHref === null ? userId : null
  const avatars = usePresenceAvatars(room, selfUserId)
  const paneRef = React.useRef<HTMLElement | null>(null)
  useCursorSender(room, paneRef)

  // Builds: live over the room while signed in and online.
  const latest = React.useRef({
    views: data.views,
    viewId: null as string | null,
  })
  const onBuildEvent = React.useCallback(
    (evt: BuildEvent) =>
      announce(evt, latest.current, (id) =>
        navigate(`/e/${expeditionId}/${id}`)
      ),
    [expeditionId, navigate]
  )
  const builds = useBuilds({
    expeditionId,
    room,
    enabled: offlineSince === null && signInHref === null,
    onEvent: onBuildEvent,
  })
  const buildOf = (v: ViewRow) => viewBuild(v, builds.log)
  const summary = buildSummary(data.views, builds.log)

  // The URL's View, else the best View once ready, else the first ready one
  // (so the first View to finish building opens by itself), else the first.
  const startView = startViewOf(
    data.views,
    expedition?.bestViewId,
    (v) => buildOf(v).status === "ready"
  )
  const view = data.views.find((v) => v.id === viewId) ?? startView
  const build = view ? buildOf(view) : null
  React.useEffect(() => {
    latest.current = { views: data.views, viewId: view?.id ?? null }
  })

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

  // This reader's presence: the View they're on and what they've selected.
  const viewIdHere = view?.id ?? null
  const selectedHere = selectedConcept?.id ?? null
  React.useEffect(() => {
    room?.setPresence({
      view: viewIdHere,
      selection: selectedHere ? [selectedHere] : [],
    })
  }, [room, viewIdHere, selectedHere])

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
    onOpenSource: (ref) =>
      setSourceTarget({ sourceId: ref.source, segment: ref.segment }),
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
            ...(canEdit &&
              offlineSince === null &&
              signInHref === null && {
                articleAction: {
                  ask: articleAsk(builds.log, selectedConcept.id),
                  onWrite: () => {
                    startJob(expeditionId, "article", {
                      conceptId: selectedConcept.id,
                    }).then(
                      builds.track,
                      failed("Couldn't start writing the article")
                    )
                  },
                },
              }),
          }
        : null

  const failed = (title: string) => (e: unknown) => {
    toast.add({
      title,
      description: e instanceof ApiError ? e.message : String(e),
      type: "error",
    })
  }
  const job = summary.job
  const cancelJob = () =>
    job
      ? builds.act(job.id, "cancel").then(
          () =>
            toast.add({
              title:
                job.status === "paused" ? "Build stopped" : "Build cancelled",
              description: "The finished Views are kept.",
            }),
          failed("Couldn't stop the build")
        )
      : Promise.resolve()
  const continueJob = () =>
    job
      ? builds
          .act(job.id, "continue")
          .catch(failed("Couldn't continue the build"))
      : Promise.resolve()
  const retryable = retryableJob(builds.log)
  const retryJob = retryable
    ? () =>
        builds
          .act(retryable.id, "retry")
          .catch(failed("Couldn't retry the build"))
    : undefined

  /** Try another View: this one's place and question, another View Type, built next. */
  const tryAnother = async (failedView: ViewRow, viewType: ViewTypeId) => {
    const at = data.views.findIndex((v) => v.id === failedView.id)
    const id = ulid(Date.now())
    const settings = parseSharedSettings(viewType, {})
    try {
      client.collections.views.insert({
        id,
        viewType,
        label: VIEW_TYPE_META[viewType].name,
        ...(failedView.question ? { question: failedView.question } : {}),
        orderKey: keyBetween(
          failedView.orderKey,
          data.views[at + 1]?.orderKey ?? null
        ),
        settings: settings.success ? settings.data : {},
        settingsVersion: VIEW_TYPES[viewType].version,
        status: "queued",
        deletedAt: null,
      })
      client.collections.views.delete(failedView.id)
    } catch (e) {
      failed("Couldn't change the View")(e)
      return
    }
    navigate(`/e/${expeditionId}/${id}`)
    if (retryJob) await retryJob()
  }

  const removeView = (v: ViewRow) => {
    try {
      client.collections.views.delete(v.id)
    } catch (e) {
      failed("Couldn't remove the View")(e)
      return
    }
    toast.add({ title: `Removed ${v.label || viewTypeMeta(v.viewType).name}` })
    navigate(`/e/${expeditionId}`)
  }

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
        presence={
          <PresenceAvatars
            avatars={avatars}
            viewName={(id) => {
              const v = data.views.find((x) => x.id === id)
              return v ? v.label || viewTypeMeta(v.viewType).name : undefined
            }}
          />
        }
        activity={
          <BuildActivity
            summary={summary}
            views={data.views}
            buildOf={buildOf}
            canEdit={canEdit}
            onCancel={cancelJob}
            onContinue={continueJob}
          />
        }
        search={
          <>
            {offlineSince !== null && (
              <OfflineChip savedAt={offlineSince} onRetry={onRetry} />
            )}
            <ConceptSearch
              query={query}
              onQueryChange={setQuery}
              matchCount={matches?.size}
            />
          </>
        }
      />
      <ViewsBar
        views={data.views}
        selectedViewId={view?.id ?? null}
        buildOf={buildOf}
        onSelectView={(id) => {
          setResumed(false)
          navigate(`/e/${expeditionId}/${id}`)
        }}
      />
      <div className="flex min-h-0 flex-1">
        <SidePanel
          content={content}
          inline={inlinePanel}
          onClose={() => setPanel(null)}
          canvas={
            <main
              ref={paneRef}
              data-testid="canvas-pane"
              data-settled={view && settledViewId === view.id ? "" : undefined}
              aria-label="Canvas"
              className="relative h-full overflow-hidden bg-background"
            >
              {view && build && build.status !== "ready" ? (
                <>
                  {build.status === "failed" || build.status === "stopped" ? (
                    <FailedViewCard
                      key={view.id}
                      view={view}
                      status={build.status}
                      reason={build.reason}
                      canEdit={canEdit}
                      onRetry={retryJob}
                      onTryAnother={(t) => tryAnother(view, t)}
                      onRemove={() => removeView(view)}
                    />
                  ) : (
                    <ViewSkeleton
                      view={view}
                      building={build.status === "building"}
                      step={build.step}
                      previewNodes={
                        build.status === "building" ? build.previewNodes : []
                      }
                    />
                  )}
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
                </>
              ) : view ? (
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
              {job?.status === "paused" && (
                <div className="absolute top-4 right-4 z-20 w-[min(26rem,calc(100%-2rem))]">
                  <Alert data-testid="cap-paused" className="shadow-md">
                    <CirclePauseIcon />
                    <AlertTitle>Paused at the spending cap</AlertTitle>
                    <AlertDescription>
                      {job.reason ?? "The build reached its spending cap"}.{" "}
                      {canEdit
                        ? "Continue to spend as much again, or stop and keep the finished Views."
                        : "An editor can continue it."}
                    </AlertDescription>
                    {canEdit && (
                      <AlertAction className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={cancelJob}>
                          Stop
                        </Button>
                        <Button size="sm" onClick={continueJob}>
                          Continue
                        </Button>
                      </AlertAction>
                    )}
                  </Alert>
                </div>
              )}
              <LiveCursors
                room={room}
                paneRef={paneRef}
                viewId={viewIdHere}
                selfUserId={selfUserId}
              />
            </main>
          }
        />
      </div>
      <SourceViewer
        expeditionId={expeditionId}
        sources={data.sources}
        target={sourceTarget}
        onClose={() => setSourceTarget(null)}
      />
    </>
  )
}

/** Toast keys already shown: events can arrive twice (a restart replays). */
const announced = new Set<string>()

/** The toasts for a build event (spec §3.5: each View as it finishes). */
function announce(
  evt: BuildEvent,
  current: { views: ViewRow[]; viewId: string | null },
  open: (viewId: string) => void
) {
  if (!evt.viewId && evt.status === "queued") {
    // A retry or Continue: its Views may finish (or fail) again.
    for (const k of [...announced])
      if (k.startsWith(`${evt.jobId}/`)) announced.delete(k)
    return
  }
  const once = `${evt.jobId}/${evt.viewId ?? ""}/${evt.status}`
  if (announced.has(once)) return
  announced.add(once)
  if (!evt.viewId && evt.kind === "article") {
    if (evt.status === "complete")
      toast.add({
        title: "Article suggested",
        description: "It's waiting for review in Suggestions.",
        type: "success",
      })
    else if (evt.status === "failed")
      toast.add({
        title: "Couldn't write the article",
        description: evt.reason,
        type: "error",
      })
    return
  }
  if (!evt.viewId) {
    // A pause shows on the canvas (Continue, Stop) rather than as a toast.
    if (evt.status === "complete")
      toast.add({ title: "Every View is built", type: "success" })
    return
  }
  const view = current.views.find((v) => v.id === evt.viewId)
  const name = view ? view.label || viewTypeMeta(view.viewType).name : "A View"
  if (evt.status === "ready")
    toast.add({
      title: `${name} is ready`,
      description: view?.question,
      type: "success",
      actionProps:
        current.viewId === evt.viewId
          ? undefined
          : { children: "Open", onClick: () => open(evt.viewId!) },
    })
  else if (evt.status === "failed")
    toast.add({
      title: `Couldn't build ${name}`,
      description: evt.reason,
      type: "error",
    })
}
