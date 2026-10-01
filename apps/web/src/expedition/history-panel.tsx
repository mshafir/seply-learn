// The History panel (spec §3.9, WP-4.2), opened from the header's History
// button (owners and editors): the Expedition's Changes, newest first, each
// with its author, label and time ("Accepted 12 suggestions · Ana · 2h ago"),
// and three actions:
//
// - **Undo**: reverts the fields that still hold that Change's value, as a
//   new Change; a toast reports edits it kept ("1 edit kept: changed since
//   by Ana").
// - **View as of here**: the canvas shows the Expedition as it was right
//   after that Change, read-only, with a banner to go back (or restore).
// - **Restore to here**: appends the ops that bring everything back to that
//   point, as a new Change. Nothing is lost: it can be undone too.
//
// The newest Change has only Undo: viewing or restoring it is the present.
import { EyeIcon, HistoryIcon, Undo2Icon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@seply/ui/components/avatar"
import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@seply/ui/components/empty"
import { ScrollArea } from "@seply/ui/components/scroll-area"
import { SheetDescription } from "@seply/ui/components/sheet"
import { Skeleton } from "@seply/ui/components/skeleton"
import { cn } from "@seply/ui/lib/utils"

import { changeMeta } from "@/expedition/history.ts"
import { PanelHeader } from "@/expedition/panel-header.tsx"
import type { HistoryList } from "@/expedition/use-history.ts"
import type { ChangeSummary } from "@/lib/api.ts"
import { initials } from "@/screens/library-sections.ts"

export type HistoryPanelProps = {
  history: HistoryList
  /** The reader's user id ("You"). */
  me: string | null
  /** The Change the canvas shows the Expedition as of, or null (the latest). */
  asOfId: string | null
  /** An undo or restore is running: the actions wait. */
  busy: boolean
  onUndo: (change: ChangeSummary) => void
  onViewAsOf: (change: ChangeSummary) => void
  onRestore: (change: ChangeSummary) => void
}

export function HistoryPanel({
  onClose,
  inline,
  history,
  me,
  asOfId,
  busy,
  onUndo,
  onViewAsOf,
  onRestore,
}: HistoryPanelProps & { onClose: () => void; inline: boolean }) {
  const Description = inline ? "p" : SheetDescription
  const { changes, loading, error, more, loadOlder } = history
  return (
    <>
      <PanelHeader
        eyebrow="History"
        title="Changes"
        onClose={onClose}
        inline={inline}
      >
        <Description className="text-sm text-muted-foreground">
          Undo any Change, or see the Expedition as it was. Restoring adds a new
          Change, so nothing is lost.
        </Description>
      </PanelHeader>
      <ScrollArea className="min-h-0 flex-1">
        {loading && !changes.length ? (
          <div className="flex flex-col gap-3 px-6 py-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : error && !changes.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Couldn't load the History</EmptyTitle>
              <EmptyDescription>
                {error instanceof Error ? error.message : String(error)}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol data-testid="history-list" className="flex flex-col py-2">
            {changes.map((change, i) => (
              <ChangeItem
                key={change.id}
                change={change}
                me={me}
                latest={i === 0}
                viewing={change.id === asOfId}
                busy={busy}
                onUndo={() => onUndo(change)}
                onViewAsOf={() => onViewAsOf(change)}
                onRestore={() => onRestore(change)}
              />
            ))}
            {more && (
              <li className="px-6 py-3">
                <Button variant="outline" size="sm" onClick={loadOlder}>
                  Show older Changes
                </Button>
              </li>
            )}
          </ol>
        )}
      </ScrollArea>
    </>
  )
}

function ChangeItem({
  change,
  me,
  latest,
  viewing,
  busy,
  onUndo,
  onViewAsOf,
  onRestore,
}: {
  change: ChangeSummary
  me: string | null
  latest: boolean
  viewing: boolean
  busy: boolean
  onUndo: () => void
  onViewAsOf: () => void
  onRestore: () => void
}) {
  return (
    <li
      data-testid="change"
      data-change-id={change.id}
      aria-current={viewing || undefined}
      className={cn(
        "flex gap-3 border-l-2 border-transparent px-6 py-3",
        viewing && "border-primary bg-accent/50"
      )}
    >
      <Avatar size="sm" className="mt-0.5" title={change.author.name}>
        {change.author.image && (
          <AvatarImage src={change.author.image} alt="" />
        )}
        <AvatarFallback className="bg-secondary font-semibold text-secondary-foreground">
          {initials(change.author.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <span
            data-testid="change-label"
            className="min-w-0 flex-1 text-sm font-medium break-words"
          >
            {change.label}
          </span>
          {latest && <Badge variant="secondary">Latest</Badge>}
          {viewing && <Badge variant="outline">Viewing</Badge>}
        </div>
        <span
          data-testid="change-meta"
          className="text-xs text-muted-foreground"
        >
          {changeMeta(change, me)}
        </span>
        <div className="-ml-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="xs" disabled={busy} onClick={onUndo}>
            <Undo2Icon />
            Undo
          </Button>
          {!latest && (
            <>
              <Button
                variant="ghost"
                size="xs"
                disabled={viewing}
                onClick={onViewAsOf}
              >
                <EyeIcon />
                View as of here
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={onRestore}
              >
                <HistoryIcon />
                Restore to here
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
