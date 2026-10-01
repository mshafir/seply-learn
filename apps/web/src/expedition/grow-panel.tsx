// Grow in the side panel (spec §3.8, canvas 05; WP-4.4): three tabs, Ask,
// Suggestions · N and Activity, for owners and editors. The Suggestions tab
// is suggestions-panel.tsx; this file has the tabs, the Ask tab and Activity.
//
// - **Ask:** "Ask about this Expedition". Each ask this tab started (or a
//   Concept action) shows what it asked, where it stands and what it has
//   suggested so far, as the items stream in (dashed on the canvas too, while
//   the panel is open). Stop keeps what streamed; at the per-ask cap it
//   pauses with Continue or Stop. Under the box: whose AI it uses and what an
//   ask costs (the estimate, and the cap that stops it). The chat itself
//   isn't kept: reloading leaves only Activity.
// - **Activity:** every ask, with who asked, when, and what came of it.
import * as React from "react"
import {
  CheckIcon,
  CirclePauseIcon,
  SendHorizontalIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { Link } from "wouter"

import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@seply/ui/components/empty"
import { ScrollArea } from "@seply/ui/components/scroll-area"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import { Tabs, TabsList, TabsTrigger } from "@seply/ui/components/tabs"
import { Textarea } from "@seply/ui/components/textarea"
import type { DomainState, ProposalView } from "@seply/domain"

import {
  activityItems,
  askStatus,
  costCopy,
  isAsking,
  keyCopy,
  type SessionAsk,
} from "@/expedition/asks.ts"
import { relativeTime } from "@/expedition/history.ts"
import { PanelHeader } from "@/expedition/panel-header.tsx"
import { describeItem } from "@/expedition/suggestions.ts"
import { ApiError, type AskEstimate, type AskView } from "@/lib/api.ts"

export type GrowTab = "ask" | "suggestions" | "activity"

/** The tabs, in the header of each of the three. */
export function GrowTabs({
  tab,
  count,
  onTab,
}: {
  tab: GrowTab
  /** Pending suggestions. */
  count: number
  onTab: (tab: GrowTab) => void
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => onTab(v as GrowTab)}
      className="mt-1"
    >
      <TabsList aria-label="Grow" data-testid="grow-tabs">
        <TabsTrigger value="ask" data-testid="tab-ask">
          Ask
        </TabsTrigger>
        <TabsTrigger value="suggestions" data-testid="tab-suggestions">
          Suggestions{count > 0 ? ` · ${count}` : ""}
        </TabsTrigger>
        <TabsTrigger value="activity" data-testid="tab-activity">
          Activity
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

export type AskPanelProps = {
  asks: readonly SessionAsk[]
  /** The newest Proposal each ask streamed, by job id. */
  streamed: Readonly<Record<string, ProposalView>>
  /** The state with pending suggestions applied: names of new Concepts. */
  preview: DomainState
  estimate: AskEstimate | null
  estimateError: unknown
  onAsk: (text: string) => Promise<unknown>
  onStop: (jobId: string) => void
  onContinue: (jobId: string) => void
  onReview: () => void
}

export function AskPanel({
  nav,
  onClose,
  inline,
  asks,
  streamed,
  preview,
  estimate,
  estimateError,
  onAsk,
  onStop,
  onContinue,
  onReview,
}: AskPanelProps & {
  nav: React.ReactNode
  onClose: () => void
  inline: boolean
}) {
  const [text, setText] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const end = React.useRef<HTMLDivElement | null>(null)
  const noKey =
    estimateError instanceof ApiError && estimateError.status === 409
      ? estimateError.body.error === "no-key"
        ? "no-key"
        : "not-configured"
      : null
  const send = async () => {
    const ask = text.trim()
    if (ask.length < 2 || sending || noKey) return
    setSending(true)
    setError(null)
    try {
      await onAsk(ask)
      setText("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }
  const last = asks.at(-1)
  const lastItems = last ? (streamed[last.jobId]?.items.length ?? 0) : 0
  React.useEffect(() => {
    // Only the list scrolls (scrollIntoView could move the page while the
    // panel slides open).
    const viewport = end.current?.closest<HTMLElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [asks.length, last?.status, lastItems])

  return (
    <>
      <PanelHeader
        eyebrow="Ask"
        title="Ask about this Expedition"
        onClose={onClose}
        inline={inline}
      >
        {nav}
      </PanelHeader>
      <ScrollArea className="min-h-0 flex-1">
        {asks.length ? (
          <div data-testid="ask-list" className="flex flex-col">
            {asks.map((a) => (
              <AskCard
                key={a.jobId}
                ask={a}
                proposal={streamed[a.jobId]}
                preview={preview}
                onStop={() => onStop(a.jobId)}
                onContinue={() => onContinue(a.jobId)}
                onReview={onReview}
              />
            ))}
            <div ref={end} />
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle>Grow this Expedition</EmptyTitle>
              <EmptyDescription>
                Ask for what's missing, examples or what to read next. What
                comes back is suggested, dashed, until someone accepts it.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </ScrollArea>
      <form
        data-testid="ask-form"
        className="flex flex-col gap-2 border-t px-6 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <Textarea
          aria-label="Ask about this Expedition"
          placeholder="Ask about this Expedition, e.g. “What would I need to understand QLoRA?”"
          value={text}
          rows={2}
          maxLength={2000}
          disabled={!!noKey}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="flex items-start gap-3">
          <p
            data-testid="ask-cost"
            className="flex-1 text-xs text-muted-foreground"
          >
            {noKey === "no-key" ? (
              <>
                No AI key: <Link href="/settings">add one in Settings</Link>.
              </>
            ) : noKey ? (
              "This server has no AI configured."
            ) : estimate ? (
              <>
                {keyCopy(estimate.keySource)} · {costCopy(estimate)}.
                Suggestions stay dashed until someone accepts them.
              </>
            ) : (
              "Suggestions stay dashed until someone accepts them."
            )}
          </p>
          <Button
            type="submit"
            size="sm"
            data-testid="ask-submit"
            disabled={text.trim().length < 2 || sending || !!noKey}
          >
            {sending ? <Spinner /> : <SendHorizontalIcon />}
            Ask
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </>
  )
}

function AskCard({
  ask,
  proposal,
  preview,
  onStop,
  onContinue,
  onReview,
}: {
  ask: SessionAsk
  proposal: ProposalView | undefined
  preview: DomainState
  onStop: () => void
  onContinue: () => void
  onReview: () => void
}) {
  const items = proposal?.items ?? []
  const pending = items.filter((i) => i.status === "pending").length
  const asking = isAsking(ask.status)
  return (
    <section
      data-testid="ask"
      data-job-id={ask.jobId}
      data-status={ask.status}
      aria-label={ask.rationale}
      className="flex flex-col gap-2 border-b px-6 py-4"
    >
      <p className="self-end rounded-lg bg-muted px-3 py-2 font-reading text-base leading-snug">
        {ask.rationale}
      </p>
      <p
        data-testid="ask-status"
        role="status"
        className={
          ask.status === "failed"
            ? "flex items-center gap-1.5 text-sm text-muted-foreground"
            : "flex items-center gap-1.5 text-sm text-suggested-text"
        }
      >
        {asking ? (
          <Spinner className="size-3.5" />
        ) : ask.status === "paused" ? (
          <CirclePauseIcon className="size-3.5" />
        ) : null}
        {askStatus(ask, items.length)}
      </p>
      {items.length > 0 && (
        <ul data-testid="ask-items" className="flex flex-col gap-1">
          {items.map((item) => {
            const d = describeItem(preview, item)
            return (
              <li
                key={item.id}
                data-testid="ask-item"
                data-status={item.status}
                className="flex items-start gap-2 rounded-md border border-dashed border-suggested/60 px-2.5 py-1.5 text-sm data-[status=accepted]:border-solid data-[status=accepted]:border-border data-[status=dismissed]:opacity-60"
              >
                {item.status === "accepted" ? (
                  <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
                ) : item.status === "dismissed" ? (
                  <XIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-suggested-text" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="text-xs text-muted-foreground">
                    {d.label}
                  </span>{" "}
                  <span className="font-medium break-words">{d.title}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {asking && (
          <Button
            size="sm"
            variant="outline"
            data-testid="ask-stop"
            onClick={onStop}
          >
            <SquareIcon />
            Stop
          </Button>
        )}
        {ask.status === "paused" && (
          <>
            <Button size="sm" data-testid="ask-continue" onClick={onContinue}>
              Continue
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="ask-stop"
              onClick={onStop}
            >
              Stop
            </Button>
          </>
        )}
        {pending > 0 && !asking && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="ask-review"
            onClick={onReview}
          >
            Review {pending === 1 ? "it" : `all ${pending}`} in Suggestions
          </Button>
        )}
      </div>
    </section>
  )
}

export type ActivityPanelProps = {
  activity: readonly AskView[] | null
  error: unknown
  me: string | null
  onStop: (jobId: string) => void
}

const STATUS_BADGE: Record<
  AskView["status"],
  { label: string; variant: "progress" | "queued" | "success" | "outline" }
> = {
  queued: { label: "Starting", variant: "queued" },
  running: { label: "Asking", variant: "progress" },
  paused: { label: "At the cap", variant: "outline" },
  complete: { label: "Done", variant: "success" },
  failed: { label: "Nothing added", variant: "outline" },
  cancelled: { label: "Stopped", variant: "outline" },
}

export function ActivityPanel({
  nav,
  onClose,
  inline,
  activity,
  error,
  me,
  onStop,
}: ActivityPanelProps & {
  nav: React.ReactNode
  onClose: () => void
  inline: boolean
}) {
  return (
    <>
      <PanelHeader
        eyebrow="Activity"
        title="Asks"
        onClose={onClose}
        inline={inline}
      >
        <p className="text-sm text-muted-foreground">
          Who asked what, and what came of it. The chats aren't kept.
        </p>
        {nav}
      </PanelHeader>
      <ScrollArea className="min-h-0 flex-1">
        {activity === null && !error ? (
          <div className="flex flex-col gap-3 px-6 py-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !activity?.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle>
                {error ? "Couldn't load Activity" : "No asks yet"}
              </EmptyTitle>
              <EmptyDescription>
                {error
                  ? error instanceof Error
                    ? error.message
                    : String(error)
                  : "Asks made here, and their authors, show up in this list."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul data-testid="activity-list" className="flex flex-col">
            {activity.map((a) => {
              const badge = STATUS_BADGE[a.status]
              return (
                <li
                  key={a.jobId}
                  data-testid="activity-ask"
                  data-job-id={a.jobId}
                  data-status={a.status}
                  className="flex flex-col gap-1 border-b px-6 py-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-reading text-base leading-snug">
                      {a.rationale}
                    </span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.author.id === me ? "You" : a.author.name} ·{" "}
                    {relativeTime(a.createdAt)} · {activityItems(a.items)}
                  </p>
                  {a.status === "failed" && a.error && (
                    <p className="text-xs text-muted-foreground">{a.error}</p>
                  )}
                  {isAsking(a.status) && (
                    <div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onStop(a.jobId)}
                      >
                        <SquareIcon />
                        Stop
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </>
  )
}
