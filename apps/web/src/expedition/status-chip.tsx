// View-specific status, floating on the canvas (spec §3.6): e.g. "Path to
// MLA · 7 of 11 read", with a clear button. The View reports it (the
// `onStatus` prop of @umbel/views); clearing hands back to the View. An
// outline Badge with a ghost icon Button (DIVERGENCES.md, "Also listed").
import { XIcon } from "lucide-react"

import { Badge } from "@umbel/ui/components/badge"
import { Button } from "@umbel/ui/components/button"
import { cn } from "@umbel/ui/lib/utils"
import type { ViewStatusChip } from "@umbel/views"

export function StatusChip({
  status,
  className,
}: {
  status: ViewStatusChip
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      role="status"
      data-testid="view-status"
      className={cn(
        "h-8 gap-1 rounded-full bg-card pr-1 pl-3 text-sm shadow-md",
        className
      )}
    >
      <span className="truncate">{status.text}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="rounded-full"
        aria-label="Clear"
        onClick={status.clear}
      >
        <XIcon />
      </Button>
    </Badge>
  )
}
