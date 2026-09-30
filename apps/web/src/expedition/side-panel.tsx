// The side panel (spec §3.6): 440 px on the right by default and resizable
// by dragging its edge, opened by a selection; a Sheet on narrow windows. It holds the Concept panel (reading, spec §3.7:
// see concept-panel.tsx) or the View panel (view-panel.tsx).
import * as React from "react"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@seply/ui/components/resizable"
import { ScrollArea } from "@seply/ui/components/scroll-area"
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
import { PanelHeader } from "@/expedition/panel-header.tsx"
import { ViewPanel, type ViewPanelProps } from "@/expedition/view-panel.tsx"
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
    }
  | ({ type: "view" } & ViewPanelProps)

const DEFAULT_WIDTH = 440
const MIN_WIDTH = 320
/** The canvas always keeps at least this much. */
const MIN_CANVAS_WIDTH = 360
/** The reader's own width, per browser. Storage failures read as the default. */
const WIDTH_KEY = "seply:side-panel-width"

function savedWidth() {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function saveWidth(px: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(px)))
  } catch {
    // Not saved: the next open starts at the default.
  }
}

/**
 * The canvas with the side panel beside it: inline and resizable on wide
 * windows, a modal Sheet on narrow ones. The canvas stays mounted as the
 * panel opens and closes.
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
  const [width] = React.useState(savedWidth)
  return (
    <>
      <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
        <ResizablePanel id="canvas-panel" minSize={MIN_CANVAS_WIDTH}>
          {canvas}
        </ResizablePanel>
        {open && (
          <>
            {/* Zero-width, so the panel's border is the only line and the
                panel stays 440 px; the grab area overlaps both sides. */}
            <ResizableHandle
              id="side-panel-handle"
              aria-label="Resize the side panel"
              className="z-10 w-0 after:w-2"
            />
            <ResizablePanel
              id="side-panel-frame"
              defaultSize={width}
              minSize={MIN_WIDTH}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size, _id, prev) => {
                if (prev) saveWidth(size.inPixels)
              }}
            >
              <aside
                data-testid="side-panel"
                aria-label={content.type === "view" ? "View" : "Concept"}
                className="flex h-full flex-col border-l bg-card text-card-foreground"
              >
                <PanelBody content={content} onClose={onClose} inline />
              </aside>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {!inline && (
        <Sheet open={!!content} onOpenChange={(o) => !o && onClose()}>
          <SheetContent
            side="right"
            data-testid="side-panel"
            showCloseButton={false}
            className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-110"
          >
            {content && <PanelBody content={content} onClose={onClose} />}
          </SheetContent>
        </Sheet>
      )}
    </>
  )
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
  const { concept, depth, kindLabel, reading, status, onStatus, signInHref } =
    content
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
            />
          ) : (
            <ConceptArticle reading={reading} sections={sections} />
          )}
        </div>
      </ScrollArea>
    </>
  )
}
