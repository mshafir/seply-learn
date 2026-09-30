// The Source viewer (spec §3.7, §5.2): a provenance badge ("From the chat,
// turn 14") opens the Source at that segment. A dialog over the Expedition
// screen, so closing it returns to the panel as it was. Chats read as turns
// (who said it, "Turn 14"), documents as sections, PDFs as pages; the cited
// segment is highlighted and scrolled into view. Segments come from the
// server (GET /api/sources/:expedition/:source); Sources aren't kept for
// offline reading (spec §2.9).
import * as React from "react"
import { DownloadIcon, FileTextIcon, MessagesSquareIcon } from "lucide-react"

import type { Segment, SegmentsDoc } from "@seply/domain"
import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Badge } from "@seply/ui/components/badge"
import { Button, buttonVariants } from "@seply/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import { ScrollArea } from "@seply/ui/components/scroll-area"
import { Skeleton } from "@seply/ui/components/skeleton"
import { cn } from "@seply/ui/lib/utils"
import type { SourceRow } from "@seply/sync"

import { Prose } from "@/expedition/prose.tsx"
import {
  assistantName,
  conversationStart,
  initialWindow,
  segmentLabel,
  sourceSummary,
  targetIds,
  WINDOW_STEP,
} from "@/expedition/source-reading.ts"
import { ApiError, getSourceSegments, sourceFileHref } from "@/lib/api.ts"

/** Where a provenance link points: a Source and one of its segments. */
export type SourceTarget = { sourceId: string; segment: string | null }

type Load =
  | { status: "loading" }
  | { status: "ready"; doc: SegmentsDoc }
  | { status: "error"; message: string }

function useSegments(expeditionId: string, sourceId: string | null): Load {
  const [load, setLoad] = React.useState<{ id: string | null; load: Load }>({
    id: null,
    load: { status: "loading" },
  })
  React.useEffect(() => {
    if (!sourceId) return
    const abort = new AbortController()
    getSourceSegments(expeditionId, sourceId, abort.signal).then(
      ({ segments }) =>
        setLoad({ id: sourceId, load: { status: "ready", doc: segments } }),
      (err: unknown) => {
        if (abort.signal.aborted) return
        const message =
          err instanceof ApiError && err.status === 0
            ? "Sources can't be opened offline."
            : err instanceof ApiError && err.status === 404
              ? "This Source's text isn't stored here (it may have come from an imported file)."
              : "The Source couldn't be loaded."
        setLoad({ id: sourceId, load: { status: "error", message } })
      }
    )
    return () => abort.abort()
  }, [expeditionId, sourceId])
  return load.id === sourceId ? load.load : { status: "loading" }
}

export function SourceViewer({
  expeditionId,
  sources,
  target,
  onClose,
}: {
  expeditionId: string
  sources: readonly SourceRow[]
  /** Open at this Source and segment; null: closed. */
  target: SourceTarget | null
  onClose: () => void
}) {
  // Keep the last target while the dialog animates closed.
  const [shown, setShown] = React.useState(target)
  if (target && target !== shown) setShown(target)
  const source = sources.find((s) => s.id === shown?.sourceId) ?? null
  const load = useSegments(expeditionId, shown?.sourceId ?? null)

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="source-viewer"
        data-source={shown?.sourceId}
        className="flex h-[min(52rem,calc(100svh-2rem))] w-full flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <DialogHeader className="gap-1 border-b px-6 pt-5 pr-12 pb-4">
          <p className="flex items-center gap-1.5 font-mono text-xs tracking-wider text-muted-foreground uppercase">
            {source?.kind === "chat" ? (
              <MessagesSquareIcon className="size-3.5" />
            ) : (
              <FileTextIcon className="size-3.5" />
            )}
            Source
          </p>
          <DialogTitle className="font-heading text-lg leading-snug">
            {source?.title ?? "Source"}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="source-summary">
              {load.status === "ready"
                ? sourceSummary(load.doc)
                : load.status === "loading"
                  ? "Loading…"
                  : "Not available"}
            </span>
            {shown?.segment && (
              <Badge variant="source" data-testid="source-cited">
                Cited: {segmentLabel(shown.segment)}
              </Badge>
            )}
            {source?.blobKey && shown && (
              <a
                href={sourceFileHref(expeditionId, shown.sourceId)}
                download
                className={cn(
                  buttonVariants({ variant: "link", size: "xs" }),
                  "h-auto p-0"
                )}
              >
                <DownloadIcon />
                Download the file
              </a>
            )}
          </DialogDescription>
        </DialogHeader>
        {load.status === "loading" ? (
          <div className="flex flex-col gap-3 p-6" data-testid="source-loading">
            <Skeleton className="h-16 w-3/4" />
            <Skeleton className="ml-auto h-24 w-5/6" />
            <Skeleton className="h-16 w-2/3" />
          </div>
        ) : load.status === "error" ? (
          <div className="p-6">
            <Alert data-testid="source-unavailable">
              <AlertTitle>Can't show this Source</AlertTitle>
              <AlertDescription>{load.message}</AlertDescription>
            </Alert>
          </div>
        ) : (
          <SegmentList
            // A new target starts afresh (window, scroll).
            key={`${shown?.sourceId}:${shown?.segment}`}
            doc={load.doc}
            segment={shown?.segment ?? null}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

const segmentAnchor = (id: string) => `segment-${id}`

function SegmentList({
  doc,
  segment,
}: {
  doc: SegmentsDoc
  segment: string | null
}) {
  const targets = React.useMemo(() => targetIds(doc, segment), [doc, segment])
  const [range, setRange] = React.useState(() => initialWindow(doc, targets))
  const listRef = React.useRef<HTMLOListElement>(null)

  // Bring the cited segment into view once it is drawn.
  React.useEffect(() => {
    const first = targets[0]
    if (!first) return
    const el = listRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(segmentAnchor(first))}`
    )
    el?.scrollIntoView({ block: "start" })
    // Only on open: "Show more" keeps the reader's place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const segments = doc.segments
  const assistant = assistantName(doc.format)
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 px-6 py-5">
        {segment && targets.length === 0 && (
          <Alert data-testid="segment-missing">
            <AlertTitle>
              {segmentLabel(segment)} isn't in this Source
            </AlertTitle>
            <AlertDescription>
              The Source may have been read differently since it was cited.
            </AlertDescription>
          </Alert>
        )}
        {range.from > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="self-center"
            onClick={() =>
              setRange((r) => ({
                ...r,
                from: Math.max(0, r.from - WINDOW_STEP),
              }))
            }
          >
            Show earlier ({range.from})
          </Button>
        )}
        <ol ref={listRef} className="flex flex-col gap-4" aria-label="Segments">
          {segments.slice(range.from, range.to).map((s, k) => {
            const i = range.from + k
            return (
              <SegmentItem
                key={s.id}
                seg={s}
                kind={doc.kind}
                assistant={assistant}
                cited={targets.includes(s.id)}
                conversation={conversationStart(segments, i, range.from)}
              />
            )
          })}
        </ol>
        {range.to < segments.length && (
          <Button
            variant="outline"
            size="sm"
            className="self-center"
            onClick={() =>
              setRange((r) => ({
                ...r,
                to: Math.min(segments.length, r.to + WINDOW_STEP),
              }))
            }
          >
            Show more ({segments.length - range.to})
          </Button>
        )}
      </div>
    </ScrollArea>
  )
}

function SegmentItem({
  seg,
  kind,
  assistant,
  cited,
  conversation,
}: {
  seg: Segment
  kind: SegmentsDoc["kind"]
  assistant: string
  cited: boolean
  conversation: string | null
}) {
  const who =
    seg.speaker === "user"
      ? "You"
      : seg.speaker === "assistant"
        ? assistant
        : null
  const noLinks = () => false
  return (
    <li
      id={segmentAnchor(seg.id)}
      data-testid="segment"
      data-segment={seg.id}
      data-speaker={seg.speaker}
      data-cited={cited ? "" : undefined}
      aria-current={cited ? "location" : undefined}
      className="flex scroll-mt-4 flex-col gap-2"
    >
      {conversation && (
        <h3 className="mt-2 border-b pb-1 font-heading text-sm font-semibold">
          {conversation}
        </h3>
      )}
      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg border px-4 py-3",
          kind === "chat" && seg.speaker === "user" && "bg-muted/50",
          cited && "border-suggested bg-suggested/10 ring-2 ring-suggested/30"
        )}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {who && <span className="font-semibold text-foreground">{who}</span>}
          {seg.heading && (
            <span className="font-semibold text-foreground">{seg.heading}</span>
          )}
          <span className="font-mono">{segmentLabel(seg.id)}</span>
          {cited && (
            <Badge variant="source" className="ml-auto">
              Cited
            </Badge>
          )}
        </div>
        <Prose
          md={seg.text}
          onConceptLink={() => {}}
          conceptExists={noLinks}
          className="text-sm"
        />
      </div>
    </li>
  )
}
