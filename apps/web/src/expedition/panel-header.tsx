// The side panel's header: an eyebrow, a close button and the title, with
// whatever the panel adds under it. Shared by the Concept and View panels.
import type * as React from "react"
import { XIcon } from "lucide-react"

import { Button } from "@umbel/ui/components/button"
import { SheetTitle } from "@umbel/ui/components/sheet"

export function PanelHeader({
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
