// A View that couldn't be built (spec §3.5): the plain reason, then Retry,
// Try another View or Remove. Also for a View the build stopped before
// ("Not built": cancelled or stopped at the spending cap). Other Views are
// untouched. Only owners and editors get the actions.
import * as React from "react"
import {
  ChevronDownIcon,
  RotateCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { Button } from "@seply/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@seply/ui/components/dropdown-menu"
import type { ViewTypeId } from "@seply/domain"
import type { ViewRow } from "@seply/sync"

import { VIEW_TYPE_META, viewTypeMeta } from "@/expedition/labels.ts"

export function FailedViewCard({
  view,
  status,
  reason,
  canEdit,
  onRetry,
  onTryAnother,
  onRemove,
}: {
  view: ViewRow
  status: "failed" | "stopped"
  reason: string
  canEdit: boolean
  /** Starts the build again; undefined when nothing can be retried. */
  onRetry?: () => Promise<unknown>
  onTryAnother: (viewType: ViewTypeId) => Promise<unknown>
  onRemove: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const name = view.label || viewTypeMeta(view.viewType).name
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true)
    fn().finally(() => setBusy(false))
  }
  const others = (Object.keys(VIEW_TYPE_META) as ViewTypeId[]).filter(
    (t) => t !== view.viewType
  )

  return (
    <div className="flex size-full items-center justify-center p-6 pt-21">
      <Card data-testid="failed-view" className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlertIcon
              aria-hidden
              className={
                status === "failed"
                  ? "size-4 text-destructive"
                  : "size-4 text-muted-foreground"
              }
            />
            {status === "failed"
              ? `Couldn't build ${name}`
              : `${name} wasn't built`}
          </CardTitle>
          <CardDescription data-testid="failed-reason">
            {reason}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The other Views are unaffected.
        </CardContent>
        {canEdit && (
          <CardFooter className="flex-wrap gap-2">
            <Button
              disabled={!onRetry || busy}
              onClick={() => onRetry && run(onRetry)}
            >
              <RotateCwIcon />
              Retry
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={busy}
                render={<Button variant="outline" />}
              >
                Try another View
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {others.map((t) => {
                  const meta = VIEW_TYPE_META[t]
                  const Icon = meta.icon
                  return (
                    <DropdownMenuItem
                      key={t}
                      onClick={() => run(() => onTryAnother(t))}
                    >
                      <Icon />
                      {meta.name}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" disabled={busy} onClick={onRemove}>
              <Trash2Icon />
              Remove
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}
