// The side panel (spec §3.6): on the right, opened by a selection, sliding
// open and shut; 520 px by default, wider (860 px) while reading a full
// article, and resizable by dragging its edge (each width kept per browser).
// A Sheet on narrow windows. It holds the Concept panel (reading, spec §3.7:
// see concept-panel.tsx), the View panel (view-panel.tsx), History
// (history-panel.tsx) or Suggestions (suggestions-panel.tsx).
import * as React from "react"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@seply/ui/components/resizable"
import { ScrollArea } from "@seply/ui/components/scroll-area"
import { cn } from "@seply/ui/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetDescription,
} from "@seply/ui/components/sheet"
import type { ReadingState } from "@seply/domain"
import type { ConceptRow } from "@seply/sync"

import {
  ArticleContents,
  BackBar,
  ConceptArticle,
  ConceptHeaderExtras,
  ConceptOverview,
  ReadingStatusControl,
  type ConceptReading,
} from "@/expedition/concept-panel.tsx"
import {
  HistoryPanel,
  type HistoryPanelProps,
} from "@/expedition/history-panel.tsx"
import { PanelHeader } from "@/expedition/panel-header.tsx"
import {
  SuggestionsPanel,
  type SuggestionsPanelProps,
} from "@/expedition/suggestions-panel.tsx"
import { ViewPanel, type ViewPanelProps } from "@/expedition/view-panel.tsx"
import type { ArticleAction } from "@/expedition/concept-panel.tsx"
import {
  articleSectionsOf,
  conceptEyebrow,
  readingMinutes,
  type PanelDepth,
} from "@/expedition/reading.ts"

export type PanelContent =
  | {
      type: "concept"
      concept: ConceptRow
      depth: PanelDepth
      kindLabel: string
      reading: ConceptReading
      /** The reader's own Reading status of this Concept. */
      status: ReadingState
      onStatus: (state: ReadingState) => void
      /** Anonymous and has marked something: where "Sign in" goes. */
      signInHref: string | null
      /** "Write the article" (editors, online, no article yet); absent otherwise. */
      articleAction?: ArticleAction
    }
  | ({ type: "view" } & ViewPanelProps)
  | ({ type: "history" } & HistoryPanelProps)
  | ({ type: "suggestions" } & SuggestionsPanelProps)

/** The panel's widths, per mode: reading, and the wider full article. */
const DEFAULT_WIDTH = { reading: 520, article: 860 } as const
type WidthMode = keyof typeof DEFAULT_WIDTH
const MIN_WIDTH = 320
/** The canvas always keeps at least this much. */
const MIN_CANVAS_WIDTH = 360
/** Open, close and widen take this long (the CSS transition below). */
const SLIDE_MS = 280
/** The reader's own widths, per browser. Storage failures read as defaults. */
const widthKey = (mode: WidthMode) =>
  mode === "reading"
    ? "seply:side-panel-width"
    : "seply:side-panel-width:article"

function savedWidth(mode: WidthMode) {
  try {
    const n = Number(localStorage.getItem(widthKey(mode)))
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : DEFAULT_WIDTH[mode]
  } catch {
    return DEFAULT_WIDTH[mode]
  }
}

function saveWidth(mode: WidthMode, px: number) {
  try {
    localStorage.setItem(widthKey(mode), String(Math.round(px)))
  } catch {
    // Not saved: the next open starts at the default.
  }
}

const modeOf = (content: PanelContent | null): WidthMode =>
  content?.type === "concept" && content.depth === "article"
    ? "article"
    : "reading"

/**
 * The canvas with the side panel beside it: inline and resizable on wide
 * windows, a modal Sheet on narrow ones. The canvas stays mounted as the
 * panel opens and closes.
 *
 * Inline, the panel is always mounted, collapsed when nothing is selected.
 * Opening, closing and switching to the full article (which reads wider)
 * slide: the panels' flex-grow transitions for a moment around each change
 * the app makes, and never while the reader drags the edge. Dragging below
 * the minimum closes the panel.
 */
export function SidePanel({
  canvas,
  content,
  inline,
  onClose,
}: {
  canvas: React.ReactNode
  content: PanelContent | null
  inline: boolean
  onClose: () => void
}) {
  const open = inline && !!content
  const mode = modeOf(content)
  const panelRef = usePanelRef()
  const [sliding, setSliding] = React.useState(false)
  const slidingRef = React.useRef(false)

  // What the panel shows while it slides shut: the last content it had.
  const [shown, setShown] = React.useState(content)
  if (content && content !== shown) setShown(content)

  React.useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    slidingRef.current = true
    setSliding(true)
    if (open) panel.resize(savedWidth(mode))
    else panel.collapse()
    const done = window.setTimeout(() => {
      slidingRef.current = false
      setSliding(false)
      if (!open) setShown(null)
    }, SLIDE_MS + 40)
    return () => window.clearTimeout(done)
  }, [open, mode, panelRef])

  return (
    <>
      <ResizablePanelGroup
        orientation="horizontal"
        className={cn(
          "min-w-0 flex-1",
          sliding &&
            "[&>[data-panel]]:transition-[flex-grow] [&>[data-panel]]:duration-(--slide-ms) [&>[data-panel]]:ease-out motion-reduce:[&>[data-panel]]:transition-none"
        )}
        style={{ "--slide-ms": `${SLIDE_MS}ms` } as React.CSSProperties}
      >
        <ResizablePanel id="canvas-panel" minSize={MIN_CANVAS_WIDTH}>
          {canvas}
        </ResizablePanel>
        {/* Zero-width, so the panel's border is the only line; the grab
            area overlaps both sides. */}
        <ResizableHandle
          id="side-panel-handle"
          aria-label="Resize the side panel"
          disabled={!open}
          className={cn("z-10 w-0 after:w-2", !open && "invisible")}
        />
        <ResizablePanel
          id="side-panel-frame"
          panelRef={panelRef}
          defaultSize={0}
          collapsible
          collapsedSize={0}
          minSize={MIN_WIDTH}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size, _id, prev) => {
            if (!prev || slidingRef.current || !open) return
            if (size.inPixels === 0) onClose()
            else saveWidth(mode, size.inPixels)
          }}
        >
          {inline && shown && (
            <aside
              data-testid="side-panel"
              data-open={open ? "" : undefined}
              aria-label={PANEL_LABEL[shown.type]}
              aria-hidden={!open || undefined}
              inert={!open}
              className="flex h-full min-w-(--side-panel-min) flex-col border-l bg-card text-card-foreground"
              style={
                { "--side-panel-min": `${MIN_WIDTH}px` } as React.CSSProperties
              }
            >
              <PanelBody content={shown} onClose={onClose} inline />
            </aside>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
      {!inline && (
        <Sheet open={!!content} onOpenChange={(o) => !o && onClose()}>
          <SheetContent
            side="right"
            data-testid="side-panel"
            showCloseButton={false}
            className={cn(
              "gap-0 p-0 transition-[max-width] duration-300 data-[side=right]:w-full",
              mode === "article"
                ? "data-[side=right]:sm:max-w-215"
                : "data-[side=right]:sm:max-w-130"
            )}
          >
            {content && <PanelBody content={content} onClose={onClose} />}
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}

const PANEL_LABEL: Record<PanelContent["type"], string> = {
  concept: "Concept",
  view: "View",
  history: "History",
  suggestions: "Suggestions",
}

function PanelBody({
  content,
  onClose,
  inline = false,
}: {
  content: PanelContent
  onClose: () => void
  inline?: boolean
}) {
  if (content.type === "view") {
    const { type: _type, ...view } = content
    void _type
    return <ViewPanel {...view} onClose={onClose} inline={inline} />
  }
  if (content.type === "history") {
    const { type: _type, ...history } = content
    void _type
    return <HistoryPanel {...history} onClose={onClose} inline={inline} />
  }
  if (content.type === "suggestions") {
    const { type: _type, ...suggestions } = content
    void _type
    return (
      <SuggestionsPanel {...suggestions} onClose={onClose} inline={inline} />
    )
  }
  return <ConceptBody content={content} onClose={onClose} inline={inline} />
}

function ConceptBody({
  content,
  onClose,
  inline,
}: {
  content: Extract<PanelContent, { type: "concept" }>
  onClose: () => void
  inline: boolean
}) {
  const {
    concept,
    depth,
    kindLabel,
    reading,
    status,
    onStatus,
    signInHref,
    articleAction,
  } = content
  const allSections = reading.data.articleSections
  const sections = React.useMemo(
    () => articleSectionsOf(concept.id, allSections),
    [concept.id, allSections]
  )
  const minutes = readingMinutes(sections.map((s) => s.md))
  return (
    <>
      <BackBar reading={reading} concept={concept} />
      <PanelHeader
        eyebrow={conceptEyebrow(concept, kindLabel, depth, minutes)}
        title={concept.title}
        onClose={onClose}
        inline={inline}
      >
        {!inline && (
          <SheetDescription className="sr-only">
            {concept.summary ?? kindLabel}
          </SheetDescription>
        )}
        {depth === "overview" ? (
          <ConceptHeaderExtras concept={concept} />
        ) : (
          <ArticleContents sections={sections} />
        )}
        <ReadingStatusControl
          state={status}
          onChange={onStatus}
          signInHref={signInHref}
        />
      </PanelHeader>
      {/* Keyed by place, so each new place starts at the top. */}
      <ScrollArea key={`${concept.id}:${depth}`} className="min-h-0 flex-1">
        <div className="px-6 py-5">
          {depth === "overview" ? (
            <ConceptOverview
              concept={concept}
              reading={reading}
              sections={sections}
              articleAction={articleAction}
            />
          ) : (
            <ConceptArticle reading={reading} sections={sections} />
          )}
        </div>
      </ScrollArea>
    </>
  )
}
