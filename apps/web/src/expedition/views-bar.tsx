// The Views bar (spec §3.6): a row of tabs under the header, one per View,
// each its View Type's icon and the View's name. Hovering (or focusing) a
// tab shows a card with the View's question, what its View Type is, and its
// build status. Tabs that don't fit go into a "More" menu, which shows the
// same content at full length.
//
// While an Expedition builds (spec §3.5), each tab also shows its build
// status: queued, building (with the step and a progress bar), ready or
// failed (with the reason); "Not built" when the build stopped before it.
import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@seply/ui/components/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@seply/ui/components/hover-card"
import { Progress } from "@seply/ui/components/progress"
import { cn } from "@seply/ui/lib/utils"
import type { ViewRow } from "@seply/sync"

import type { ViewBuild } from "@/expedition/build-state.ts"
import { viewTypeMeta } from "@/expedition/labels.ts"
import { Prose } from "@/expedition/prose.tsx"
import { viewTypeDoc } from "@/expedition/view-type-docs.ts"

/** Room kept for the "More" button when some tabs don't fit. */
const MORE_WIDTH = 136
const GAP = 4

export function ViewsBar({
  views,
  selectedViewId,
  onSelectView,
  buildOf,
}: {
  views: ViewRow[]
  selectedViewId: string | null
  onSelectView: (viewId: string) => void
  /** Each View's build status (default: ready). */
  buildOf?: (view: ViewRow) => ViewBuild
}) {
  const build = (view: ViewRow): ViewBuild =>
    buildOf?.(view) ?? { status: "ready" }
  const { containerRef, measureRef, shownIds } = useFit(views)
  const shown = shownIds(selectedViewId)
  const visible = views.filter((v) => shown.has(v.id))
  const overflow = views.filter((v) => !shown.has(v.id))

  return (
    <nav
      aria-label="Views"
      data-testid="views-bar"
      data-views={views.length}
      className="relative flex h-(--views-bar-height) shrink-0 items-center border-b bg-card px-2"
    >
      {/* Every tab, laid out off screen, to measure what fits. */}
      <div
        ref={measureRef}
        aria-hidden
        inert
        className="pointer-events-none invisible absolute top-0 left-0 flex gap-1"
      >
        {views.map((view) => (
          <ViewTab key={view.id} view={view} build={build(view)} measuring />
        ))}
      </div>
      <div
        ref={containerRef}
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        {visible.map((view) => (
          <ViewTab
            key={view.id}
            view={view}
            build={build(view)}
            selected={view.id === selectedViewId}
            onSelect={() => onSelectView(view.id)}
          />
        ))}
        {overflow.length > 0 && (
          <MoreViews
            views={overflow}
            build={build}
            onSelectView={onSelectView}
          />
        )}
      </div>
    </nav>
  )
}

/** How many tabs fit: measures each tab once, then the bar on resize. */
function useFit(views: ViewRow[]) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const measureRef = React.useRef<HTMLDivElement>(null)
  const [widths, setWidths] = React.useState<number[]>([])
  const [available, setAvailable] = React.useState(Infinity)

  React.useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    setWidths(
      Array.from(el.children, (c) => (c as HTMLElement).offsetWidth + GAP)
    )
  }, [views])

  React.useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setAvailable(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const shownIds = (selectedId: string | null) => {
    const total = widths.reduce((a, b) => a + b, 0)
    if (widths.length !== views.length || total <= available)
      return new Set(views.map((v) => v.id))
    let used = MORE_WIDTH
    let count = 0
    while (count < views.length && used + widths[count]! <= available)
      used += widths[count++]!
    const shown = views.slice(0, count).map((v) => v.id)
    // The open View keeps its tab: it takes the last place that fits.
    const selectedAt = views.findIndex((v) => v.id === selectedId)
    if (selectedAt >= count && selectedId) {
      while (shown.length > 0 && used + widths[selectedAt]! > available + 0.5) {
        const dropped = views.findIndex((v) => v.id === shown.at(-1))
        used -= widths[dropped]!
        shown.pop()
      }
      shown.push(selectedId)
    }
    return new Set(shown)
  }

  return { containerRef, measureRef, shownIds }
}

function ViewTab({
  view,
  build,
  selected = false,
  onSelect,
  measuring = false,
}: {
  view: ViewRow
  build: ViewBuild
  selected?: boolean
  onSelect?: () => void
  measuring?: boolean
}) {
  const meta = viewTypeMeta(view.viewType)
  const Icon = meta.icon
  const name = view.label || meta.name
  // A click closes the card (it would cover the canvas's corner); it stays
  // closed until the pointer leaves the tab.
  const [cardOpen, setCardOpen] = React.useState(false)
  const [clicked, setClicked] = React.useState(false)
  const tab = (
    <Button
      variant="ghost"
      aria-current={selected ? "page" : undefined}
      data-testid={measuring ? undefined : "view-tab"}
      data-status={build.status}
      className={cn(
        "h-9 shrink-0 gap-2 px-3 text-muted-foreground",
        selected && "bg-accent text-foreground"
      )}
      onClick={() => {
        setClicked(true)
        setCardOpen(false)
        onSelect?.()
      }}
      onPointerLeave={() => setClicked(false)}
    >
      <Icon className={cn("size-4", selected && "text-primary")} />
      <span className="font-medium whitespace-nowrap">{name}</span>
      <BuildMark build={build} />
    </Button>
  )
  if (measuring) return tab
  return (
    <HoverCard
      open={cardOpen}
      onOpenChange={(open) => setCardOpen(open && !clicked)}
    >
      <HoverCardTrigger delay={350} closeDelay={100} render={tab} />
      <HoverCardContent
        align="start"
        sideOffset={6}
        className="w-96 p-4"
        data-testid="view-card"
      >
        <ViewDetails view={view} build={build} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** The Views that don't fit, at full length, in a menu. */
function MoreViews({
  views,
  build,
  onSelectView,
}: {
  views: ViewRow[]
  build: (view: ViewRow) => ViewBuild
  onSelectView: (viewId: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            data-testid="more-views"
            className="h-9 shrink-0 gap-1.5 px-3 text-muted-foreground"
          />
        }
      >
        {views.length} more
        <ChevronDownIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(36rem,var(--available-height))] w-[26rem] p-1.5"
      >
        {views.map((view) => {
          const meta = viewTypeMeta(view.viewType)
          const Icon = meta.icon
          const b = build(view)
          return (
            <DropdownMenuItem
              key={view.id}
              data-testid="view-tab"
              data-status={b.status}
              aria-label={view.label || meta.name}
              className="items-start gap-3 px-3 py-3"
              onClick={() => onSelectView(view.id)}
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {view.label || meta.name}
                  </span>
                  <BuildBadge build={b} />
                </span>
                <BuildDetail view={view} build={b} />
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The hover card: name, View Type, question, what the type is, status. */
function ViewDetails({ view, build }: { view: ViewRow; build: ViewBuild }) {
  const meta = viewTypeMeta(view.viewType)
  const Icon = meta.icon
  const intro = viewTypeDoc(view.viewType)?.intro
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{view.label || meta.name}</span>
            <BuildBadge build={build} />
          </div>
          <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
            {meta.name}
          </span>
        </div>
      </div>
      <BuildDetail view={view} build={build} full />
      {intro && (
        <Prose
          md={intro}
          onConceptLink={() => {}}
          conceptExists={() => false}
          className="border-t pt-3 text-xs leading-relaxed text-muted-foreground"
        />
      )}
    </div>
  )
}

/** A small status mark on the tab itself; the card says the rest. */
function BuildMark({ build }: { build: ViewBuild }) {
  switch (build.status) {
    case "ready":
      return null
    case "building":
      return (
        <span
          data-testid="build-status"
          aria-label="Building"
          className="size-1.5 animate-pulse rounded-full bg-suggested motion-reduce:animate-none"
        />
      )
    case "failed":
      return (
        <span
          data-testid="build-status"
          aria-label="Failed"
          className="size-1.5 rounded-full bg-destructive"
        />
      )
    case "queued":
    case "stopped":
      return (
        <span
          data-testid="build-status"
          aria-label={build.status === "queued" ? "Queued" : "Not built"}
          className="size-1.5 rounded-full bg-muted-foreground/50"
        />
      )
  }
}

function BuildBadge({ build }: { build: ViewBuild }) {
  switch (build.status) {
    case "ready":
      return null
    case "queued":
      return <Badge variant="queued">Queued</Badge>
    case "building":
      return (
        <Badge variant="progress">
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-suggested motion-reduce:animate-none"
          />
          Building
        </Badge>
      )
    case "failed":
      return <Badge variant="destructive">Failed</Badge>
    case "stopped":
      return <Badge variant="queued">Not built</Badge>
  }
}

/** The question, or the build's step or reason while it isn't ready. */
function BuildDetail({
  view,
  build,
  full = false,
}: {
  view: ViewRow
  build: ViewBuild
  full?: boolean
}) {
  const line = cn("text-sm leading-snug", !full && "text-[0.8125rem]")
  const question = view.question && (
    <span className={cn(line, "font-reading text-foreground/90")}>
      {view.question}
    </span>
  )
  switch (build.status) {
    case "ready":
      return question || null
    case "queued":
      return (
        <>
          {question}
          <span className={cn(line, "text-muted-foreground")}>
            {build.step}
          </span>
        </>
      )
    case "building":
      return (
        <>
          {question}
          <span className={cn(line, "text-suggested-text")}>{build.step}</span>
          <Progress
            value={Math.round(build.progress * 100)}
            aria-label={`Building ${view.label || viewTypeMeta(view.viewType).name}`}
            className="**:data-[slot=progress-indicator]:bg-suggested"
          />
        </>
      )
    case "failed":
    case "stopped":
      return (
        <>
          {question}
          <span
            data-testid="build-reason"
            className={cn(
              line,
              build.status === "failed"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {build.reason}
          </span>
        </>
      )
  }
}
