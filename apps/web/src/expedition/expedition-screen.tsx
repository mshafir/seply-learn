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
//
// History (spec §3.9, WP-4.2): owners and editors open the History panel
// from the header. Undo and Restore to here go through the sync client and
// toast what they did; "View as of here" swaps the canvas and panels to a
// read-only replay of the log (a cached-style client over that state), with
// a banner to go back to the latest or restore.
//
// Suggestions (spec §3.8, WP-4.3): owners and editors online see the
// pending suggestions' count in the header, which opens the Suggestions tab.
// While it is open (and while reading a Concept opened from it), the canvas
// and panels read a preview: the live state with every pending item applied
// (use-proposals.ts), drawn dashed, read-only. Each accept is one Change
// (the server appends it; we pull it), with Undo in its toast and in
// History; undoing it makes its items pending again. A new MCP Proposal
// arrives with a toast.
//
// Grow (spec §3.8, §5.5, WP-4.4): owners and editors online ask the curator
// agent from the Ask tab (the header's Ask opens it) or a Concept action.
// The side panel's Grow tabs are Ask, Suggestions and Activity; each ask
// streams its suggestions (use-asks.ts) into the Suggestions list and, while
// the panel is open, dashed onto the canvas. "Write the article" is one of
// the Concept actions, and its ask shows in Ask and Activity too.
import * as React from "react"
import {
  CirclePauseIcon,
  HistoryIcon,
  RotateCwIcon,
  SearchXIcon,
} from "lucide-react"
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
  higherReadingState,
  isLive,
  keyBetween,
  parseSharedSettings,
  ulid,
  VIEW_TYPES,
  type BuildEvent,
  type OpBody,
  type ViewTypeId,
} from "@seply/domain"
import {
  openCachedClient,
  SyncHttpError,
  type SyncClient,
  type ViewRow,
} from "@seply/sync"
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
import {
  changeMeta,
  keptMessage,
  restoreLabel,
  undoLabel,
} from "@/expedition/history.ts"
import { OfflineChip } from "@/expedition/offline-chip.tsx"
import { kindLabel, VIEW_TYPE_META, viewTypeMeta } from "@/expedition/labels.ts"
import {
  HEADER_HEIGHT,
  INLINE_PANEL_QUERY,
  VIEWS_BAR_HEIGHT,
} from "@/expedition/layout.ts"
import type { ConceptReading } from "@/expedition/concept-panel.tsx"
import type { Editing } from "@/expedition/concept-editing.tsx"
import { refused } from "@/expedition/refused.ts"
import { VocabularyButton } from "@/expedition/vocabulary-dialog.tsx"
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
import { useHistory } from "@/expedition/use-history.ts"
import { ViewButton } from "@/expedition/view-button.tsx"
import { ViewsBar } from "@/expedition/views-bar.tsx"
import {
  groupPending,
  itemsPhrase,
  planAccept,
  proposalBy,
  suggestionsCount,
  type AcceptPlan,
} from "@/expedition/suggestions.ts"
import { usePreview, useProposals } from "@/expedition/use-proposals.ts"
import { useAsks } from "@/expedition/use-asks.ts"
import {
  actionRationale,
  askStatus,
  costCopy,
  isAsking,
  type SessionAsk,
} from "@/expedition/asks.ts"
import type { GrowTab } from "@/expedition/grow-panel.tsx"
import {
  ApiError,
  estimateArticle,
  listExpeditions,
  reopenProposals,
  reviewProposals,
  startJob,
  type ChangeSummary,
  type ProposalView,
  type Role,
} from "@/lib/api.ts"
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

/** What the side panel shows: a Concept (with its back stack), the View, History or Suggestions. */
type Panel =
  | { type: "concept"; stack: BackStack }
  | { type: "view" }
  | { type: "history" }
  | { type: "suggestions"; tab?: GrowTab }
  | null

/** "View as of here": a read-only client over the replayed state. */
type AsOf = { change: ChangeSummary; client: SyncClient }

let asOfCount = 0

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
  // "View as of here" shows a replay instead of the live client, read-only.
  const [asOf, setAsOf] = React.useState<AsOf | null>(null)
  React.useEffect(() => () => asOf?.client.dispose(), [asOf])
  // A Concept picked in global search arrives as ?concept=<id>.
  const [conceptParam] = React.useState(() =>
    new URLSearchParams(window.location.search).get("concept")
  )
  const [panel, setPanel] = React.useState<Panel>(() =>
    conceptParam ? { type: "concept", stack: openConcept(conceptParam) } : null
  )

  // Suggestions: owners and editors, online. A new MCP Proposal gets a toast.
  const canReview = canEdit && offlineSince === null && signInHref === null
  const proposals = useProposals({
    expeditionId,
    enabled: canReview,
    onNewMcp: (p: ProposalView) =>
      toast.add({
        title: `${proposalBy(p, userId)} suggested ${itemsPhrase(
          client.engine.state,
          p.items.filter((i) => i.status === "pending")
        )}`,
        description: p.rationale,
        actionProps: {
          children: "Review",
          onClick: () => setPanel({ type: "suggestions", tab: "suggestions" }),
        },
      }),
  })
  const refreshProposals = React.useRef(proposals.refresh)
  React.useEffect(() => {
    refreshProposals.current = proposals.refresh
  })
  // The preview: on with the Suggestions tab, and kept while reading a
  // Concept opened from it (a new Concept exists only there).
  const [previewing, setPreviewing] = React.useState(false)
  const panelType = panel?.type ?? null
  if (panelType === "suggestions" && !previewing) setPreviewing(true)
  if (previewing && panelType !== "suggestions" && panelType !== "concept")
    setPreviewing(false)
  const preview = usePreview(
    client,
    proposals.proposals,
    previewing && canReview && !asOf
  )

  const shown = asOf?.client ?? preview?.client ?? client
  const editable = canEdit && !asOf && !preview
  const canViewHistory = canEdit && client.hasHistory
  const data = useExpeditionData(shown.collections)
  const inlinePanel = useMediaQuery(INLINE_PANEL_QUERY)
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
  // Proposals changed elsewhere (another tab reviewed, an ask wrote): the
  // server pokes the room, and the Suggestions list is fetched again.
  React.useEffect(() => {
    if (!room || !canReview) return
    return room.subscribe((msg) => {
      if (msg.t === "poke") void refreshProposals.current()
    })
  }, [room, canReview])
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
    (evt: BuildEvent) => {
      // An article ask that finished has a new suggestion waiting.
      if (!evt.viewId && evt.kind === "article" && evt.status === "complete")
        void refreshProposals.current()
      announce(evt, latest.current, (id) =>
        navigate(`/e/${expeditionId}/${id}`)
      )
    },
    [expeditionId, navigate]
  )
  const builds = useBuilds({
    expeditionId,
    room,
    enabled: offlineSince === null && signInHref === null,
    onEvent: onBuildEvent,
  })
  const buildOf = (v: ViewRow) => viewBuild(v, builds.log)

  // Grow: this tab's asks, each streaming its Proposal into the list.
  const growTab: GrowTab | null =
    panel?.type === "suggestions" ? (panel.tab ?? "suggestions") : null
  const growTabRef = React.useRef(growTab)
  React.useEffect(() => {
    growTabRef.current = growTab
  })
  const asks = useAsks({
    expeditionId,
    enabled: canReview,
    me: signInHref === null ? userId : null,
    onProposal: proposals.ingest,
    onJob: builds.track,
    onEnded: (ask: SessionAsk) => {
      void refreshProposals.current()
      // The article's own toast says it (announce); a Grow ask's, unless its tab is open.
      if (ask.kind !== "grow" || growTabRef.current === "ask") return
      toast.add({
        title: ask.rationale,
        description: askStatus(ask, 0),
        actionProps: {
          children: "Review",
          onClick: () => setPanel({ type: "suggestions", tab: "ask" }),
        },
      })
    },
  })
  const { loadEstimate, refreshActivity } = asks
  React.useEffect(() => {
    if (growTab === "ask") loadEstimate()
    if (growTab === "activity") void refreshActivity()
  }, [growTab, loadEstimate, refreshActivity])
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

  // Editing in place (spec §3.7, WP-4.5): owners and editors, online.
  const live = editable && offlineSince === null && signInHref === null
  const commit = (ops: readonly OpBody[], label: string, origin?: "merge") => {
    if (!ops.length) return true
    try {
      client.engine.propose(ops, { label, origin, coalesce: false })
      return true
    } catch (e) {
      refused("Couldn't save that", e)
      return false
    }
  }
  const editing: Editing | undefined = live
    ? {
        client,
        data,
        view: view ?? undefined,
        commit,
        onMerged: (survivor, loser) => {
          // Every reader's status follows on the server; ours, at once.
          const mine = readerState.reading[survivor]?.state ?? "unread"
          const next = higherReadingState(
            mine,
            readerState.reading[loser]?.state
          )
          if (next !== mine) reader?.markReading(expeditionId, survivor, next)
          setPanel({ type: "concept", stack: openConcept(survivor) })
        },
      }
    : undefined

  // History: the list, and what its actions do.
  const history = useHistory(
    expeditionId,
    client,
    canViewHistory && (panel?.type === "history" || !!asOf)
  )
  const [historyBusy, setHistoryBusy] = React.useState(false)
  const nameOf = (id: string) =>
    id === userId
      ? "you"
      : (history.changes.find((c) => c.author.id === id)?.author.name ?? null)
  const historyFailed = (title: string) => (e: unknown) =>
    toast.add({
      title,
      description: e instanceof Error ? e.message : String(e),
      type: "error",
    })
  const undoChange = (change: Pick<ChangeSummary, "id" | "label">) => {
    setHistoryBusy(true)
    client
      .undo(change.id, { label: undoLabel(change) })
      .then((r) => {
        const kept = keptMessage(r.kept, nameOf)
        toast.add(
          r.ops.length
            ? {
                title: `Undid “${change.label}”`,
                description: kept ?? undefined,
                type: "success",
              }
            : {
                title: "Nothing to undo",
                description: kept ?? "It has already been undone.",
              }
        )
        // Undoing an accept makes its suggestions pending again.
        if (r.ops.length && canReview)
          reopenProposals(expeditionId, { changeId: change.id })
            .then((ids) => {
              if (ids.length) void proposals.refresh()
            })
            .catch(historyFailed("Couldn't bring the suggestions back"))
      }, historyFailed("Couldn't undo"))
      .finally(() => setHistoryBusy(false))
  }
  const viewAsOf = (change: ChangeSummary) => {
    try {
      const replay = openCachedClient(
        {
          expeditionId,
          actor: userId,
          collections: { id: `seply:${expeditionId}:as-of:${++asOfCount}` },
        },
        { state: client.stateAsOf(change.lastSeq), headSeq: change.lastSeq }
      )
      setAsOf({ change, client: replay })
    } catch (e) {
      historyFailed("Couldn't show that point")(e)
    }
  }
  const restoreChange = (change: ChangeSummary) => {
    setHistoryBusy(true)
    client
      .restoreTo(change.lastSeq, { label: restoreLabel(change) })
      .then((r) => {
        setAsOf(null)
        toast.add(
          r.ops.length
            ? {
                title: `Restored to “${change.label}”`,
                description: "Restoring is a Change too: undo it in History.",
                type: "success",
              }
            : {
                title: "Nothing to restore",
                description: "Nothing changed since.",
              }
        )
      }, historyFailed("Couldn't restore"))
      .finally(() => setHistoryBusy(false))
  }

  // Suggestions: each review action is one request (and at most one Change).
  const [reviewBusy, setReviewBusy] = React.useState(false)
  const liveState = client.engine.state
  const acceptSuggestions = (plan: AcceptPlan) => {
    if (!plan.ids.length) return
    setReviewBusy(true)
    reviewProposals(expeditionId, {
      accept: plan.ids,
      overwrite: plan.stale.length > 0,
    })
      .then(async (r) => {
        // Bring the new Change in before the preview drops the items.
        await client.pull().catch(() => {})
        await proposals.refresh()
        const n = r.accepted.length
        toast.add({
          title: r.label ?? `Accepted ${suggestionsCount(n)}`,
          description: r.included.length
            ? `Including ${suggestionsCount(r.included.length)} ${r.included.length === 1 ? "it" : "they"} needed.`
            : undefined,
          type: "success",
          actionProps: r.changeId
            ? {
                children: "Undo",
                onClick: () =>
                  undoChange({
                    id: r.changeId!,
                    label: r.label ?? "Accepted suggestions",
                  }),
              }
            : undefined,
        })
      }, failedReview("Couldn't accept"))
      .finally(() => setReviewBusy(false))
  }
  const dismissSuggestions = (ids: string[]) => {
    setReviewBusy(true)
    reviewProposals(expeditionId, { dismiss: ids })
      .then(async () => {
        await proposals.refresh()
        toast.add({
          title: `Dismissed ${suggestionsCount(ids.length)}`,
          actionProps: {
            children: "Undo",
            onClick: () =>
              reopenProposals(expeditionId, { itemIds: ids }).then(
                () => proposals.refresh(),
                failed("Couldn't bring them back")
              ),
          },
        })
      }, failedReview("Couldn't dismiss"))
      .finally(() => setReviewBusy(false))
  }
  const failedReview = (title: string) => (e: unknown) => {
    failed(title)(e)
    void proposals.refresh()
  }

  const content: PanelContent | null =
    panel?.type === "suggestions" && canReview
      ? {
          type: "suggestions",
          groups: groupPending(liveState, proposals.proposals),
          count: proposals.count,
          loading: proposals.loading,
          error: proposals.error,
          me: userId,
          live: liveState,
          preview: preview?.client.engine.state ?? liveState,
          busy: reviewBusy,
          plan: (ids) => planAccept(liveState, proposals.proposals, ids),
          onAccept: acceptSuggestions,
          onDismiss: dismissSuggestions,
          tab: growTab ?? "suggestions",
          onTab: (tab) => setPanel({ type: "suggestions", tab }),
          ask: {
            asks: asks.asks,
            streamed: asks.streamed,
            preview: preview?.client.engine.state ?? liveState,
            estimate: asks.estimate,
            estimateError: asks.estimateError,
            onAsk: (text) =>
              asks.ask({ ask: text, ...(view && { viewId: view.id }) }, text),
            onStop: (jobId) =>
              void asks.stop(jobId).catch(failed("Couldn't stop the ask")),
            onContinue: (jobId) =>
              void asks
                .resume(jobId)
                .catch(failed("Couldn't continue the ask")),
            onReview: () =>
              setPanel({ type: "suggestions", tab: "suggestions" }),
          },
          activity: {
            activity: asks.activity,
            error: asks.activityError,
            me: userId,
            onStop: (jobId) =>
              void asks.stop(jobId).catch(failed("Couldn't stop the ask")),
          },
        }
      : panel?.type === "history" && canViewHistory
        ? {
            type: "history",
            history,
            me: userId,
            asOfId: asOf?.change.id ?? null,
            busy: historyBusy,
            onUndo: undoChange,
            onViewAsOf: viewAsOf,
            onRestore: restoreChange,
          }
        : panel?.type === "view" && view
          ? {
              type: "view",
              view,
              data,
              collections: shown.collections,
              canEdit: editable,
              personal,
              onDuplicated: (id) => navigate(`/e/${expeditionId}/${id}`),
              editing,
            }
          : selectedConcept && place
            ? {
                type: "concept",
                concept: selectedConcept,
                depth: place.depth,
                kindLabel: kindLabel(selectedConcept.kind, data.kindDefs),
                reading,
                status:
                  readerState.reading[selectedConcept.id]?.state ?? "unread",
                onStatus: (state) =>
                  reader?.markReading(expeditionId, selectedConcept.id, state),
                signInHref: hintHref,
                editing,
                // Asks suggest; they never edit. So they're there while
                // previewing too, for Concepts that exist (not suggested ones).
                ...(canReview &&
                  !asOf &&
                  isLive(liveState.concepts[selectedConcept.id]) && {
                    articleAction: {
                      ask: articleAsk(builds.log, selectedConcept.id),
                      estimate: () => estimateArticle(expeditionId),
                      onWrite: (request) => {
                        startJob(expeditionId, "article", {
                          conceptId: selectedConcept.id,
                          ...request,
                        }).then((job) => {
                          builds.track(job)
                          asks.follow(
                            job,
                            `Write the article for ${selectedConcept.title}`
                          )
                        }, failed("Couldn't start writing the article"))
                      },
                    },
                    growActions: {
                      asking: (action) =>
                        asks.asks.findLast(
                          (a) =>
                            a.action === action &&
                            a.conceptId === selectedConcept.id &&
                            isAsking(a.status)
                        ) ?? null,
                      cost: asks.estimate ? costCopy(asks.estimate) : null,
                      ...(asks.estimateError instanceof ApiError &&
                        asks.estimateError.status === 409 && {
                          noKey:
                            asks.estimateError.body.error === "no-key"
                              ? ("no-key" as const)
                              : ("not-configured" as const),
                        }),
                      loadEstimate: asks.loadEstimate,
                      onAsk: (action) => {
                        asks
                          .ask(
                            {
                              action,
                              conceptId: selectedConcept.id,
                              ...(view && { viewId: view.id }),
                            },
                            actionRationale(action, selectedConcept.title)
                          )
                          .then(
                            () => setPanel({ type: "suggestions", tab: "ask" }),
                            failed("Couldn't ask")
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
        canEdit={editable}
        onRename={rename}
        health={health}
        signInHref={signInHref}
        suggestions={
          canReview
            ? {
                count: proposals.count,
                open: growTab === "suggestions" || growTab === "activity",
                onToggle: () =>
                  setPanel((p) =>
                    p?.type === "suggestions" && p.tab !== "ask"
                      ? null
                      : { type: "suggestions", tab: "suggestions" }
                  ),
              }
            : undefined
        }
        ask={
          canReview
            ? {
                open: growTab === "ask",
                asking: asks.asks.some(
                  (a) => a.kind === "grow" && isAsking(a.status)
                ),
                onToggle: () =>
                  setPanel((p) =>
                    p?.type === "suggestions" && p.tab === "ask"
                      ? null
                      : { type: "suggestions", tab: "ask" }
                  ),
              }
            : undefined
        }
        presence={
          <PresenceAvatars
            avatars={avatars}
            viewName={(id) => {
              const v = data.views.find((x) => x.id === id)
              return v ? v.label || viewTypeMeta(v.viewType).name : undefined
            }}
          />
        }
        history={
          canViewHistory
            ? {
                open: panel?.type === "history",
                onToggle: () =>
                  setPanel((p) =>
                    p?.type === "history" ? null : { type: "history" }
                  ),
              }
            : undefined
        }
        activity={
          <BuildActivity
            summary={summary}
            views={data.views}
            buildOf={buildOf}
            canEdit={editable}
            onCancel={cancelJob}
            onContinue={continueJob}
          />
        }
        search={
          <>
            {offlineSince !== null && (
              <OfflineChip savedAt={offlineSince} onRetry={onRetry} />
            )}
            {editing && <VocabularyButton editing={editing} />}
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
      {asOf && (
        <Alert
          data-testid="as-of-banner"
          role="status"
          className="shrink-0 rounded-none border-x-0 border-t-0 bg-muted px-4"
        >
          <HistoryIcon />
          <AlertTitle>As of “{asOf.change.label}”</AlertTitle>
          <AlertDescription>
            {changeMeta(asOf.change, userId)} · read-only
          </AlertDescription>
          <AlertAction className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={historyBusy}
              onClick={() => restoreChange(asOf.change)}
            >
              Restore to here
            </Button>
            <Button size="sm" onClick={() => setAsOf(null)}>
              Back to latest
            </Button>
          </AlertAction>
        </Alert>
      )}
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
                      canEdit={editable}
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
                    key={asOf?.change.id ?? "latest"}
                    collections={shown.collections}
                    viewId={view.id}
                    viewType={view.viewType}
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
                    suggested={preview?.suggested}
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
                      {editable
                        ? "Continue to spend as much again, or stop and keep the finished Views."
                        : "An editor can continue it."}
                    </AlertDescription>
                    {editable && (
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
  // Grow asks report in the Ask tab (and their own toast, use-asks.ts).
  if (evt.kind === "grow") return
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
