// The side panel (spec §3.6): 440 px on the right, opened by a selection; a
// Sheet on narrow windows. It holds the Concept panel (reading arrives with
// WP-1.7) or the View panel (a stub until the View renderers own settings).
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

import { viewTypeMeta } from "@/expedition/labels.ts"

export type PanelContent =
  | { type: "concept"; concept: ConceptRow; kindLabel: string }
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
  // Inside a Sheet the title and description label the dialog.
  const Title = inline ? "h2" : SheetTitle
  const Description = inline ? "p" : SheetDescription

  const eyebrow =
    content.type === "view"
      ? `View · ${viewTypeMeta(content.view.viewType).name}`
      : content.kindLabel
  const title =
    content.type === "view"
      ? content.view.label || viewTypeMeta(content.view.viewType).name
      : content.concept.title
  const sub =
    content.type === "view" ? content.view.question : content.concept.summary

  return (
    <>
      <div className="flex flex-col gap-1.5 border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tracking-wider text-primary uppercase">
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
        <Title className="font-reading text-2xl leading-tight font-medium text-foreground">
          {title}
        </Title>
        {sub && (
          <Description
            className={
              content.type === "view"
                ? "font-reading text-lg text-muted-foreground"
                : "text-base text-muted-foreground"
            }
          >
            {sub}
          </Description>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-6 py-4">
          {content.type === "concept" ? (
            content.concept.overview ? (
              <p className="font-reading text-base leading-relaxed">
                {content.concept.overview}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No overview yet.
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              This View's description and settings appear here.
            </p>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
