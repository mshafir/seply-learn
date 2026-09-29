// The side panel (spec §3.6): 440 px on the right, opened by a selection; a
// Sheet on narrow windows. It holds the Concept panel (reading, spec §3.7:
// see concept-panel.tsx) or the View panel (a stub until the View renderers
// own settings).
import * as React from "react"
import { XIcon } from "lucide-react"

import { Button } from "@umbel/ui/components/button"
import { ScrollArea } from "@umbel/ui/components/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@umbel/ui/components/sheet"
import type { ConceptRow, ViewRow } from "@umbel/sync"

import {
  ArticleContents,
  BackBar,
  ConceptArticle,
  ConceptHeaderExtras,
  ConceptOverview,
  type ConceptReading,
} from "@/expedition/concept-panel.tsx"
import { viewTypeMeta } from "@/expedition/labels.ts"
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
  | { type: "view"; view: ViewRow }

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
  return content.type === "view" ? (
    <ViewBody view={content.view} onClose={onClose} inline={inline} />
  ) : (
    <ConceptBody content={content} onClose={onClose} inline={inline} />
  )
}

function PanelHeader({
  eyebrow,
  title,
  onClose,
  inline,
  children,
}: {
  eyebrow: string
  title: string
  onClose: () => void
  inline: boolean
  children?: React.ReactNode
}) {
  // Inside a Sheet the title labels the dialog.
  const Title = inline ? "h2" : SheetTitle
  return (
    <div className="flex flex-col gap-1.5 border-b px-6 py-4">
      <div className="flex items-center gap-2">
        <span
          data-testid="panel-eyebrow"
          className="font-mono text-xs tracking-wider text-primary uppercase"
        >
          {eyebrow}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <Title
        data-testid="panel-title"
        className="font-reading text-2xl leading-tight font-medium text-foreground"
      >
        {title}
      </Title>
      {children}
    </div>
  )
}

function ViewBody({
  view,
  onClose,
  inline,
}: {
  view: ViewRow
  onClose: () => void
  inline: boolean
}) {
  const Description = inline ? "p" : SheetDescription
  const meta = viewTypeMeta(view.viewType)
  return (
    <>
      <PanelHeader
        eyebrow={`View · ${meta.name}`}
        title={view.label || meta.name}
        onClose={onClose}
        inline={inline}
      >
        {view.question && (
          <Description className="font-reading text-lg text-muted-foreground">
            {view.question}
          </Description>
        )}
      </PanelHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-6 py-4">
          <p className="text-sm text-muted-foreground">
            This View's description and settings appear here.
          </p>
        </div>
      </ScrollArea>
    </>
  )
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
