// "Offline, as of …" (spec §2.9): the Expedition is this device's saved copy,
// read-only until the connection is back. An outline Badge with a ghost icon
// Button, like the View status chip (DIVERGENCES.md, "Also listed").
import { CloudOffIcon, RotateCwIcon } from "lucide-react"

import { Badge } from "@umbel/ui/components/badge"
import { Button } from "@umbel/ui/components/button"

import { formatAsOf } from "@/lib/offline.ts"

export function OfflineChip({
  savedAt,
  onRetry,
}: {
  savedAt: number
  onRetry: () => void
}) {
  return (
    <Badge
      variant="outline"
      role="status"
      data-testid="offline-chip"
      className="h-7 shrink-0 gap-1.5 rounded-full bg-card pr-0.5 pl-2.5 text-sm"
    >
      <CloudOffIcon className="size-3.5 text-muted-foreground" />
      <span className="truncate">
        Offline, as of {formatAsOf(savedAt)}
        <span className="text-muted-foreground"> · read-only</span>
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="rounded-full"
        aria-label="Retry"
        onClick={onRetry}
      >
        <RotateCwIcon />
      </Button>
    </Badge>
  )
}
