// The side panel (spec §3.6): 440 px on the right, opened by a selection; a
// Sheet on narrow windows. It holds the Concept panel (reading, spec §3.7:
// see concept-panel.tsx) or the View panel (view-panel.tsx).
import * as React from "react"

import { ScrollArea } from "@umbel/ui/components/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
} from "@umbel/ui/components/sheet"
import type { ConceptRow } from "@umbel/sync"

import {
  ArticleContents,
  BackBar,
  ConceptArticle,
  ConceptHeaderExtras,
  ConceptOverview,
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
    }
  | ({ type: "view" } & ViewPanelProps)

/** Inline beside the canvas on wide windows; a modal Sheet on narrow ones. */
export function SidePanel({
  content,
  inline,
  onClose,
}: {
  content: PanelContent | null
  inline: boolean
  onClose: () => void
}) {
  if (inline) {
    if (!content) return null
    return (
      <aside
        data-testid="side-panel"
        aria-label={content.type === "view" ? "View" : "Concept"}
        className="flex w-110 shrink-0 flex-col border-l bg-card text-card-foreground"
      >
        <PanelBody content={content} onClose={onClose} inline />
      </aside>
    )
  }
  return (
    <Sheet open={!!content} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        data-testid="side-panel"
        showCloseButton={false}
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-110"
      >
        {content && <PanelBody content={content} onClose={onClose} />}
      </SheetContent>
    </Sheet>
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
  const { concept, depth, kindLabel, reading } = content
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
