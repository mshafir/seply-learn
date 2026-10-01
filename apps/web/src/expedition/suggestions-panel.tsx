// The Suggestions tab (spec §3.8, WP-4.3), opened from the header's
// Suggestions count (owners and editors). Pending Proposal items, grouped by
// ask (its rationale and who asked), each in plain words, with Accept and
// Dismiss; each ask has Accept all and Dismiss all, and the header Accept
// all takes everything. While the tab is open the canvas draws them dashed.
//
// - **Dependencies:** accepting an item that needs another (a Relationship
//   to a new Concept) includes it. When an accept brings anything along,
//   overwrites anything, or has to leave something out, a dialog shows it
//   before confirming.
// - **Stale:** an item whose fields changed since it was suggested says
//   "Changed since suggested" with both versions; accepting it is an
//   explicit overwrite. One whose Concept was deleted can only be dismissed.
// - Each review action is one undoable Change (the toast has Undo; so does
//   History). Dismissing changes nothing in the Expedition: its toast's Undo
//   brings the items back.
import * as React from "react"
import {
  ArrowRightLeftIcon,
  CheckIcon,
  FileTextIcon,
  PencilLineIcon,
  SparklesIcon,
  SquareDashedIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@seply/ui/components/empty"
import { ScrollArea } from "@seply/ui/components/scroll-area"
import { SheetDescription } from "@seply/ui/components/sheet"
import { Skeleton } from "@seply/ui/components/skeleton"
import type { DomainState } from "@seply/domain"

import { relativeTime } from "@/expedition/history.ts"
import { PanelHeader } from "@/expedition/panel-header.tsx"
import {
  describeItem,
  proposalBy,
  staleVersions,
  suggestionsCount,
  type AcceptPlan,
  type ItemKind,
  type PendingItem,
  type SuggestionGroup,
} from "@/expedition/suggestions.ts"

export type SuggestionsPanelProps = {
  groups: SuggestionGroup[]
  count: number
  loading: boolean
  error: unknown
  me: string | null
  /** The live state: stale versions and the names of things that exist. */
  live: DomainState
  /** The live state with the pending items applied: names of new Concepts. */
  preview: DomainState
  /** A review is running: the actions wait. */
  busy: boolean
  /** What accepting these items would do (dependencies, stale, left out). */
  plan: (ids: string[]) => AcceptPlan
  /** Accept, as planned (stale items in it are overwritten). */
  onAccept: (plan: AcceptPlan) => void
  onDismiss: (ids: string[]) => void
  /** The Grow tabs (grow-panel.tsx), under the description. */
  nav?: React.ReactNode
}

const KIND_ICON: Record<ItemKind, typeof SparklesIcon> = {
  concept: SquareDashedIcon,
  relationship: ArrowRightLeftIcon,
  article: FileTextIcon,
  edit: PencilLineIcon,
}

export function SuggestionsPanel({
  onClose,
  inline,
  groups,
  count,
  loading,
  error,
  me,
  live,
  preview,
  busy,
  plan,
  onAccept,
  onDismiss,
  nav,
}: SuggestionsPanelProps & { onClose: () => void; inline: boolean }) {
  const Description = inline ? "p" : SheetDescription
  const [confirm, setConfirm] = React.useState<AcceptPlan | null>(null)
  const describe = React.useCallback(
    (item: PendingItem["item"]) => describeItem(preview, item),
    [preview]
  )
  const accept = (ids: string[]) => {
    const p = plan(ids)
    if (p.added.length || p.stale.length || p.skipped.length) setConfirm(p)
    else if (p.ids.length) onAccept(p)
  }
  const byId = new Map(
    groups.flatMap((g) => g.items.map((i) => [i.item.id, i] as const))
  )
  const all = groups.flatMap((g) => g.items.map((i) => i.item.id))
  return (
    <>
      <PanelHeader
        eyebrow="Suggestions"
        title={count ? suggestionsCount(count) : "No suggestions"}
        onClose={onClose}
        inline={inline}
      >
        <Description className="text-sm text-muted-foreground">
          What AI asks and agents suggested, shown dashed on the canvas. Each
          accept is a Change you can undo.
        </Description>
        {nav}
        {groups.length > 1 && (
          <div>
            <Button
              size="sm"
              disabled={busy}
              data-testid="accept-everything"
              onClick={() => accept(all)}
            >
              <CheckIcon />
              Accept all {count}
            </Button>
          </div>
        )}
      </PanelHeader>
      <ScrollArea className="min-h-0 flex-1">
        {loading && !groups.length ? (
          <div className="flex flex-col gap-3 px-6 py-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !groups.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle>
                {error ? "Couldn't load suggestions" : "Nothing to review"}
              </EmptyTitle>
              <EmptyDescription>
                {error
                  ? error instanceof Error
                    ? error.message
                    : String(error)
                  : "When an AI ask or an agent suggests changes, they wait here for you."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div data-testid="suggestions-list" className="flex flex-col">
            {groups.map((g) => (
              <Group
                key={g.proposal.id}
                group={g}
                me={me}
                live={live}
                busy={busy}
                describe={describe}
                onAccept={accept}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      <ConfirmAccept
        plan={confirm}
        live={live}
        byId={byId}
        describe={describe}
        onCancel={() => setConfirm(null)}
        onConfirm={(p) => {
          setConfirm(null)
          onAccept(p)
        }}
      />
    </>
  )
}

function Group({
  group,
  me,
  live,
  busy,
  describe,
  onAccept,
  onDismiss,
}: {
  group: SuggestionGroup
  me: string | null
  live: DomainState
  busy: boolean
  describe: (item: PendingItem["item"]) => ReturnType<typeof describeItem>
  onAccept: (ids: string[]) => void
  onDismiss: (ids: string[]) => void
}) {
  const { proposal, items } = group
  const ids = items.map((i) => i.item.id)
  return (
    <section
      data-testid="suggestion-group"
      data-proposal-id={proposal.id}
      aria-label={proposal.rationale}
      className="flex flex-col gap-2 border-b px-6 py-4"
    >
      <div className="flex flex-col gap-0.5">
        <h3
          data-testid="suggestion-rationale"
          className="font-reading text-base leading-snug font-medium"
        >
          {proposal.rationale}
        </h3>
        <p className="text-xs text-muted-foreground">
          {proposalBy(proposal, me)} · {relativeTime(proposal.createdAt)} ·{" "}
          {suggestionsCount(items.length)}
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((i) => (
          <Item
            key={i.item.id}
            pending={i}
            live={live}
            busy={busy}
            describe={describe}
            onAccept={() => onAccept([i.item.id])}
            onDismiss={() => onDismiss([i.item.id])}
          />
        ))}
      </ul>
      {items.length > 1 && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAccept(ids)}
          >
            <CheckIcon />
            Accept all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onDismiss(ids)}
          >
            Dismiss all
          </Button>
        </div>
      )}
    </section>
  )
}

function Item({
  pending,
  live,
  busy,
  describe,
  onAccept,
  onDismiss,
}: {
  pending: PendingItem
  live: DomainState
  busy: boolean
  describe: (item: PendingItem["item"]) => ReturnType<typeof describeItem>
  onAccept: () => void
  onDismiss: () => void
}) {
  const { item, staleness } = pending
  const d = describe(item)
  const Icon = KIND_ICON[d.kind]
  const gone = staleness.gone.length > 0
  const changed = staleness.changed.length > 0
  return (
    <li
      data-testid="suggestion"
      data-item-id={item.id}
      data-stale={gone ? "gone" : changed ? "changed" : undefined}
      className="flex gap-3 rounded-lg border border-dashed border-suggested/60 px-3 py-2"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-suggested-text" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-muted-foreground">{d.label}</span>
        <span
          data-testid="suggestion-title"
          className="text-sm font-medium break-words"
        >
          {d.title}
        </span>
        {d.detail && (
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {d.detail}
          </span>
        )}
        {gone ? (
          <p
            role="note"
            className="flex items-center gap-1.5 text-xs text-destructive"
          >
            <TriangleAlertIcon className="size-3.5 shrink-0" />
            Can't be added: what it needs was deleted since.
          </p>
        ) : (
          changed && (
            <div data-testid="stale" className="flex flex-col gap-1.5">
              <Badge variant="progress">
                <TriangleAlertIcon />
                Changed since suggested
              </Badge>
              {staleness.changed.map((f) => {
                const v = staleVersions(live, f)
                return (
                  <dl
                    key={`${f.entity}:${f.id}:${f.field}`}
                    data-testid="stale-versions"
                    className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs"
                  >
                    <dt className="text-muted-foreground">Now</dt>
                    <dd data-testid="stale-now" className="break-words">
                      <span className="sr-only">{v.field}: </span>
                      {v.now}
                    </dd>
                    <dt className="text-muted-foreground">Suggested</dt>
                    <dd
                      data-testid="stale-suggested"
                      className="break-words text-suggested-text"
                    >
                      {v.suggested}
                    </dd>
                  </dl>
                )
              })}
            </div>
          )
        )}
        <div className="-ml-2 flex gap-1">
          {!gone && (
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={onAccept}
            >
              <CheckIcon />
              {changed ? "Accept and overwrite" : "Accept"}
            </Button>
          )}
          <Button size="xs" variant="ghost" disabled={busy} onClick={onDismiss}>
            <XIcon />
            Dismiss
          </Button>
        </div>
      </div>
    </li>
  )
}

/** Shown before an accept that brings items along, overwrites, or leaves some out. */
function ConfirmAccept({
  plan,
  live,
  byId,
  describe,
  onCancel,
  onConfirm,
}: {
  plan: AcceptPlan | null
  live: DomainState
  byId: Map<string, PendingItem>
  describe: (item: PendingItem["item"]) => ReturnType<typeof describeItem>
  onCancel: () => void
  onConfirm: (plan: AcceptPlan) => void
}) {
  const line = (id: string) => {
    const p = byId.get(id)
    if (!p) return null
    const d = describe(p.item)
    return (
      <li key={id} data-item-id={id} className="text-sm">
        <span className="text-muted-foreground">{d.label}:</span> {d.title}
      </li>
    )
  }
  const n = plan?.ids.length ?? 0
  return (
    <Dialog open={!!plan} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent data-testid="confirm-accept" className="sm:max-w-md">
        {plan && (
          <>
            <DialogHeader>
              <DialogTitle>
                {n ? `Accept ${suggestionsCount(n)}?` : "Nothing to accept"}
              </DialogTitle>
              <DialogDescription>
                {n
                  ? "They're added as one Change, which you can undo."
                  : "What these need was deleted since. Dismiss them instead."}
              </DialogDescription>
            </DialogHeader>
            {plan.added.length > 0 && (
              <div data-testid="confirm-added" className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  Also adds what{" "}
                  {plan.added.length === 1 ? "it needs" : "they need"}:
                </p>
                <ul className="flex flex-col gap-0.5">
                  {plan.added.map(line)}
                </ul>
              </div>
            )}
            {plan.stale.length > 0 && (
              <div data-testid="confirm-stale" className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  Changed since suggested; accepting overwrites:
                </p>
                <ul className="flex flex-col gap-1">
                  {plan.stale.map((id) => {
                    const p = byId.get(id)
                    return (
                      <li key={id} className="text-sm">
                        {p && describe(p.item).title}
                        {p?.staleness.changed.map((f) => {
                          const v = staleVersions(live, f)
                          return (
                            <span
                              key={f.field}
                              className="block text-xs text-muted-foreground"
                            >
                              {v.field}: “{v.now}” becomes “{v.suggested}”
                            </span>
                          )
                        })}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {plan.skipped.length > 0 && (
              <div
                data-testid="confirm-skipped"
                className="flex flex-col gap-1"
              >
                <p className="text-sm font-medium">
                  Left out (what they need was deleted):
                </p>
                <ul className="flex flex-col gap-0.5">
                  {plan.skipped.map(line)}
                </ul>
              </div>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              <Button
                disabled={!n}
                data-testid="confirm-accept-button"
                onClick={() => onConfirm(plan)}
              >
                <CheckIcon />
                {plan.stale.length ? "Overwrite and accept" : "Accept"} {n}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
