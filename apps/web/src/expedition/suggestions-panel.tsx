// The Suggestions tab (spec §3.8), opened from the header's Suggestions
// count (owners and editors). Pending Proposal items, grouped by ask (its
// rationale and who asked) and, within it, into entries (suggestions.ts):
//
// - **A Concept package:** a suggested new Concept (with its article and
//   edits) and, nested under it with a checkbox each, its Relationships to
//   Concepts already in the Expedition. Accept takes them as one Change;
//   unticked Relationships are dismissed in the same action. Dismiss
//   dismisses the package and everything that depends on its Concept.
// - **A Relationship between suggested Concepts:** faded, and its Accept
//   off, until those Concepts are accepted; hovering or focusing it says
//   which ("Accept NF4 and QLoRA first"). It can still be dismissed.
// - Anything else: one item, with Accept and Dismiss.
//
// Each ask has Accept all and Dismiss all, and the header Accept all takes
// everything; Accept all confirms in a dialog that says what it takes. While
// the tab is open the canvas draws every pending item dashed.
//
// - **Left out:** when an accept overwrites anything or has to leave
//   something out, a dialog shows it before confirming.
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
import { Checkbox } from "@seply/ui/components/checkbox"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@seply/ui/components/tooltip"
import type { DomainState } from "@seply/domain"

import { relativeTime } from "@/expedition/history.ts"
import { PanelHeader } from "@/expedition/panel-header.tsx"
import {
  describeItem,
  entryIds,
  proposalBy,
  staleVersions,
  suggestionsCount,
  waitsForPhrase,
  type AcceptPlan,
  type ItemKind,
  type PendingItem,
  type SuggestionEntry,
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
  /** What accepting these items would do (order, stale, left out). */
  plan: (
    ids: string[],
    opts?: { dismiss?: string[]; all?: boolean }
  ) => AcceptPlan
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
  const accept: AcceptFn = (ids, opts) => {
    const p = plan(ids, opts)
    if (p.all || p.stale.length || p.skipped.length) setConfirm(p)
    else if (p.ids.length) onAccept(p)
  }
  const byId = new Map(
    groups.flatMap((g) =>
      g.entries.flatMap((e) =>
        [...e.items, ...e.relationships].map((i) => [i.item.id, i] as const)
      )
    )
  )
  const all = groups.flatMap((g) => g.entries.flatMap((e) => entryIds(e)))
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
              onClick={() => accept(all, { all: true })}
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
                preview={preview}
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

type AcceptFn = (
  ids: string[],
  opts?: { dismiss?: string[]; all?: boolean }
) => void
type Describe = (item: PendingItem["item"]) => ReturnType<typeof describeItem>

function Group({
  group,
  me,
  live,
  preview,
  busy,
  describe,
  onAccept,
  onDismiss,
}: {
  group: SuggestionGroup
  me: string | null
  live: DomainState
  preview: DomainState
  busy: boolean
  describe: Describe
  onAccept: AcceptFn
  onDismiss: (ids: string[]) => void
}) {
  const { proposal, entries, count } = group
  const ids = entries.flatMap((e) => entryIds(e))
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
          {suggestionsCount(count)}
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {entries.map((e) => (
          <Entry
            key={e.id}
            entry={e}
            live={live}
            preview={preview}
            busy={busy}
            describe={describe}
            onAccept={onAccept}
            onDismiss={onDismiss}
          />
        ))}
      </ul>
      {count > 1 && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAccept(ids, { all: true })}
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

/** One entry: a Concept package with its Relationships, or one item. */
function Entry({
  entry,
  live,
  preview,
  busy,
  describe,
  onAccept,
  onDismiss,
}: {
  entry: SuggestionEntry
  live: DomainState
  preview: DomainState
  busy: boolean
  describe: Describe
  onAccept: AcceptFn
  onDismiss: (ids: string[]) => void
}) {
  // The package's Relationships the reader unticked: dismissed on accept.
  const [leftOut, setLeftOut] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [head, ...rest] = entry.items
  if (!head) return null
  const waiting = entry.waitsFor.length > 0
  const why = waiting ? waitsForPhrase(preview, entry.waitsFor) : ""
  const gone = entry.items.some((i) => i.staleness.gone.length > 0)
  const changed = entry.items.some((i) => i.staleness.changed.length > 0)
  const goneRel = (i: PendingItem) => i.staleness.gone.length > 0
  const rels = entry.relationships
  const unticked = rels.map((i) => i.item.id).filter((id) => leftOut.has(id))
  const toggle = (id: string, on: boolean) =>
    setLeftOut((s) => {
      const next = new Set(s)
      if (on) next.delete(id)
      else next.add(id)
      return next
    })
  // A Relationship that can't apply is neither accepted nor dismissed: it
  // stays, to be dismissed on its own.
  const accept = () =>
    onAccept(
      entryIds(
        entry,
        new Set([...leftOut, ...rels.filter(goneRel).map((i) => i.item.id)])
      ),
      { dismiss: unticked }
    )
  const body = <ItemBody pending={head} live={live} describe={describe} />
  return (
    <li
      data-testid="suggestion"
      data-item-id={head.item.id}
      data-entry={entry.kind}
      data-waiting={waiting || undefined}
      data-stale={gone ? "gone" : changed ? "changed" : undefined}
      className="flex flex-col gap-2 rounded-lg border border-dashed border-suggested/60 px-3 py-2"
    >
      {waiting ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                tabIndex={0}
                data-testid="suggestion-waiting"
                aria-label={`${describe(head.item).title}. ${why}.`}
                className="flex gap-3 rounded-md opacity-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            }
          >
            {body}
          </TooltipTrigger>
          <TooltipContent data-testid="waiting-reason">{why}</TooltipContent>
        </Tooltip>
      ) : (
        <div className="flex gap-3">{body}</div>
      )}
      {rest.map((i) => (
        <div
          key={i.item.id}
          data-testid="suggestion-part"
          data-item-id={i.item.id}
          className="flex gap-3 border-t border-dashed border-suggested/40 pt-2"
        >
          <ItemBody pending={i} live={live} describe={describe} />
        </div>
      ))}
      {rels.length > 0 && (
        <ul
          data-testid="suggestion-relationships"
          aria-label="Its Relationships"
          className="flex flex-col gap-1.5 border-t border-dashed border-suggested/40 pt-2"
        >
          {rels.map((i) => {
            const d = describe(i.item)
            const off = goneRel(i)
            return (
              <li
                key={i.item.id}
                data-testid="suggestion-relationship"
                data-item-id={i.item.id}
                className="flex items-start gap-2 text-sm"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={!off && !leftOut.has(i.item.id)}
                  disabled={busy || off}
                  aria-label={d.title}
                  onCheckedChange={(v) => toggle(i.item.id, v === true)}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words">{d.title}</span>
                  {d.detail && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {d.detail}
                    </span>
                  )}
                  {off && (
                    <span
                      role="note"
                      className="flex items-center gap-1 text-xs text-destructive"
                    >
                      <TriangleAlertIcon className="size-3 shrink-0" />
                      Can't be added: what it needs was deleted since.
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {unticked.length > 0 && (
        <p
          data-testid="left-out-note"
          className="text-xs text-muted-foreground"
        >
          Unticked Relationships are dismissed when you accept.
        </p>
      )}
      <div className="-ml-2 flex gap-1">
        {!gone && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || waiting}
            onClick={accept}
          >
            <CheckIcon />
            {changed ? "Accept and overwrite" : "Accept"}
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => onDismiss(entry.items.map((i) => i.item.id))}
        >
          <XIcon />
          Dismiss
        </Button>
      </div>
    </li>
  )
}

/** One item in plain words, with whether it's stale. */
function ItemBody({
  pending,
  live,
  describe,
}: {
  pending: PendingItem
  live: DomainState
  describe: Describe
}) {
  const { item, staleness } = pending
  const d = describe(item)
  const Icon = KIND_ICON[d.kind]
  const gone = staleness.gone.length > 0
  const changed = staleness.changed.length > 0
  return (
    <>
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
      </div>
    </>
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
            {plan.all && n > 0 && (
              <ul
                data-testid="confirm-all"
                className="flex list-disc flex-col gap-0.5 pl-5 text-sm"
              >
                {allLines(plan.counts).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
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
                  Left out (what they need was deleted, or isn't accepted with
                  them):
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

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** Accept all in the tab's terms: the packages first, then what they unlock. */
function allLines(c: AcceptPlan["counts"]): string[] {
  const lines: string[] = []
  if (c.concepts)
    lines.push(
      `${plural(c.concepts, "new Concept", "new Concepts")}${
        c.relationships
          ? `, with ${plural(c.relationships, "Relationship", "Relationships")} to Concepts already here`
          : ""
      }`
    )
  else if (c.relationships)
    lines.push(plural(c.relationships, "Relationship", "Relationships"))
  if (c.between)
    lines.push(
      `then ${plural(c.between, "Relationship", "Relationships")} between new Concepts`
    )
  if (c.other)
    lines.push(plural(c.other, "other suggestion", "other suggestions"))
  return lines
}
