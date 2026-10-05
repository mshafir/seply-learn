// The floating View button (spec §3.6): icon, name and a settings icon, over
// the canvas's top-left corner. It opens the View panel, which carries the
// question and description. An outline Button.
import { SlidersHorizontalIcon } from "lucide-react"

import { Button } from "@seply/ui/components/button"
import { cn } from "@seply/ui/lib/utils"
import type { ViewRow } from "@seply/sync"

import { viewTypeMeta } from "@/expedition/labels.ts"

export function ViewButton({
  view,
  open,
  onClick,
  className,
}: {
  view: ViewRow
  open: boolean
  onClick: () => void
  className?: string
}) {
  const meta = viewTypeMeta(view.viewType)
  const Icon = meta.icon
  const name = view.label || meta.name

  return (
    <Button
      variant="outline"
      aria-label={`${name}: View settings`}
      aria-expanded={open}
      data-testid="view-button"
      onClick={onClick}
      className={cn(
        "h-auto max-w-[calc(100%-2rem)] gap-3 bg-card py-2 pr-3 pl-2 shadow-md dark:bg-card",
        open && "border-primary ring-1 ring-primary dark:border-primary",
        className
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-5!" />
      </span>
      <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
      <span className="ml-1 flex items-center self-stretch border-l pl-3 text-muted-foreground">
        <SlidersHorizontalIcon />
      </span>
    </Button>
  )
}
