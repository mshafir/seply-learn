// The Library (spec §3.2, canvas 01): Continue reading, then Your
// Expeditions, Shared with you (with a New badge until it is opened) and
// Drafts, filtered by a Tag. Cards show the fixed thumbnail of the best View's View Type (never a preview of the
// Expedition), the title and summary, the collaborators' avatars with a
// short summary, the Concept and View counts and the date, and a pin to
// "Keep available offline" (spec §2.9). Offline, the Library lists the
// Expeditions saved on this device. Global search, New and Import (our JSON,
// or a zip export with Source files; spec §1.9) sit in the header. **Trash**
// (WP-5.2), for owners: what I moved there, with when it will be deleted for
// good (30 days on) and Restore.
import * as React from "react"
import {
  BookOpenIcon,
  CloudOffIcon,
  CompassIcon,
  PinIcon,
  PlusIcon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react"
import { Link, useLocation } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@seply/ui/components/avatar"
import { Badge } from "@seply/ui/components/badge"
import { Wordmark } from "@seply/ui/components/brand"
import { Button } from "@seply/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@seply/ui/components/empty"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import { toast } from "@seply/ui/components/toast"
import { Toggle } from "@seply/ui/components/toggle"
import { ToggleGroup, ToggleGroupItem } from "@seply/ui/components/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@seply/ui/components/tooltip"
import { ViewTypeThumbnail } from "@seply/ui/components/view-type-thumbnail"
import type { OfflineEntry } from "@seply/sync"

import { AccountMenu } from "@/components/account-menu.tsx"
import { GlobalSearch } from "@/components/global-search.tsx"
import {
  ApiError,
  continueReading,
  createExpedition,
  importExpedition,
  listExpeditions,
  listTrash,
  restoreExpedition,
  type ContinueReadingItem,
  type LibraryCard,
  type TrashedCard,
} from "@/lib/api.ts"
import { importedLabel } from "@/lib/export.ts"
import { formatAsOf, setKeptOffline, useOfflineEntries } from "@/lib/offline.ts"
import { useUser } from "@/lib/session.ts"
import {
  collaboratorSummary,
  countsLabel,
  initials,
  librarySections,
  libraryTags,
  withTag,
} from "@/screens/library-sections.ts"

type ListState =
  | { status: "loading" }
  | { status: "ready"; expeditions: LibraryCard[] }
  | { status: "error"; error: Error }

const STATUS_LABEL: Record<LibraryCard["status"], string> = {
  draft: "Draft",
  building: "Building",
  ready: "Ready",
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })

/** "Today, 9:14 PM" or "Sep 23, 2026". */
function when(iso: string): string {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
    ? `Today, ${timeFormat.format(d)}`
    : dateFormat.format(d)
}

/** A draft I can edit opens in the create flow; anything else opens to read. */
const cardHref = (card: LibraryCard) =>
  card.status === "draft" && card.role !== "viewer"
    ? `/new/${card.id}`
    : `/e/${card.id}`

const cardLink =
  "outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"

/**
 * Continue reading (spec §3.2): the three Expeditions I read most recently,
 * with their thumbnails when the list has them. Opening one lands where I
 * left off (the Expedition screen resumes the saved position). Hidden until
 * there is something to continue.
 */
function ContinueReading({
  cards,
}: {
  cards: ReadonlyMap<string, LibraryCard>
}) {
  const [items, setItems] = React.useState<ContinueReadingItem[]>([])
  React.useEffect(() => {
    let cancelled = false
    continueReading(3).then(
      (list) => {
        if (!cancelled) setItems(list)
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [])
  if (!items.length) return null
  return (
    <section aria-labelledby="continue-heading" className="flex flex-col gap-3">
      <h2 id="continue-heading" className="font-reading text-2xl font-medium">
        Continue reading
      </h2>
      <ul
        data-testid="continue-reading"
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4"
      >
        {items.map(({ expedition: e, position }) => {
          const card = cards.get(e.id)
          return (
            <li key={e.id}>
              <Card
                size="sm"
                className="relative h-full flex-row items-center gap-3 px-3 transition-colors hover:bg-accent"
              >
                <div className="w-20 shrink-0 overflow-hidden rounded-md bg-sidebar ring-1 ring-foreground/10">
                  <ViewTypeThumbnail viewType={card?.bestViewType ?? null} />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <Link href={`/e/${e.id}`} className={cardLink}>
                    <span className="line-clamp-2 font-reading text-lg leading-snug font-medium">
                      {e.title || "Untitled Expedition"}
                    </span>
                  </Link>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <BookOpenIcon className="size-3.5 shrink-0" />
                    Last read {when(position.at)}
                  </span>
                </div>
              </Card>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Collaborators({ card, meId }: { card: LibraryCard; meId: string }) {
  const shown = card.collaborators.slice(0, 3)
  const more = card.collaborators.length - shown.length
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AvatarGroup>
        {shown.map((p) => (
          <Avatar key={p.id} size="sm" title={p.name}>
            {p.image && <AvatarImage src={p.image} alt="" />}
            <AvatarFallback className="bg-secondary font-semibold text-secondary-foreground">
              {initials(p.name)}
            </AvatarFallback>
          </Avatar>
        ))}
        {more > 0 && (
          <AvatarGroupCount className="size-6 text-xs">
            +{more}
          </AvatarGroupCount>
        )}
      </AvatarGroup>
      <span className="truncate text-muted-foreground">
        {collaboratorSummary(card.collaborators, meId)}
      </span>
    </div>
  )
}

function PinToggle({
  card,
  kept,
  onChange,
}: {
  card: Pick<LibraryCard, "id" | "title">
  kept: boolean
  onChange: (keep: boolean) => void
}) {
  const label = kept ? "Kept available offline" : "Keep available offline"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="sm"
            aria-label={`${label}: ${card.title || "Untitled Expedition"}`}
            data-testid="pin-offline"
            pressed={kept}
            onPressedChange={onChange}
            // Above the card's stretched link.
            className="relative z-10 text-muted-foreground aria-pressed:text-foreground"
          />
        }
      >
        <PinIcon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ExpeditionCard({
  card,
  meId,
  kept,
  onKeep,
}: {
  card: LibraryCard
  meId: string
  kept: boolean
  onKeep: (keep: boolean) => void
}) {
  return (
    <Card
      data-testid="expedition-card"
      className="relative h-full pt-0 transition-colors hover:bg-accent/60"
    >
      <div className="flex h-32 items-center justify-center border-b bg-sidebar px-6 py-3">
        <ViewTypeThumbnail
          viewType={card.bestViewType}
          className="max-h-full w-auto"
        />
      </div>
      <CardHeader>
        <CardTitle className="font-reading text-xl font-medium">
          <Link href={cardHref(card)} className={cardLink}>
            {card.title || "Untitled Expedition"}
          </Link>
        </CardTitle>
        <CardAction>
          <PinToggle card={card} kept={kept} onChange={onKeep} />
        </CardAction>
        {card.summary && (
          <CardDescription className="line-clamp-2">
            {card.summary}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="mt-auto">
        <Collaborators card={card} meId={meId} />
      </CardContent>
      <CardFooter className="flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        {card.isNew && (
          <Badge data-testid="card-new" aria-label="New: shared with you">
            New
          </Badge>
        )}
        <span data-testid="card-counts">{countsLabel(card.counts)}</span>
        {card.status !== "ready" && (
          <Badge variant="secondary">
            {card.status === "building" && <Spinner />}
            {STATUS_LABEL[card.status]}
          </Badge>
        )}
        {card.role !== "owner" && (
          <Badge variant="outline">
            {card.role === "editor" ? "Editor" : "Viewer"}
          </Badge>
        )}
        <span className="ml-auto">{when(card.updatedAt)}</span>
      </CardFooter>
    </Card>
  )
}

function CardGrid({
  label,
  cards,
  meId,
  kept,
  onKeep,
}: {
  label: string
  cards: LibraryCard[]
  meId: string
  kept: ReadonlySet<string>
  onKeep: (card: LibraryCard, keep: boolean) => void
}) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4"
    >
      {cards.map((card) => (
        <li key={card.id}>
          <ExpeditionCard
            card={card}
            meId={meId}
            kept={kept.has(card.id)}
            onKeep={(keep) => onKeep(card, keep)}
          />
        </li>
      ))}
    </ul>
  )
}

const SECTION_IDS = {
  yours: "your-expeditions",
  shared: "shared-with-you",
  drafts: "drafts",
  trash: "trash",
} as const

/**
 * Trash (spec §3.2): my Expeditions there, soonest deleted first, each with
 * Restore. Nobody can open them until they're restored.
 */
function Trash({
  cards,
  onRestore,
}: {
  cards: TrashedCard[]
  onRestore: (card: TrashedCard) => Promise<void>
}) {
  const [busy, setBusy] = React.useState<string | null>(null)
  return (
    <ul
      aria-label="Trash"
      data-testid="trash-list"
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4"
    >
      {cards.map((card) => (
        <li key={card.id}>
          <Card size="sm" data-testid="trash-card" className="h-full">
            <CardHeader>
              <CardTitle className="font-reading text-lg font-medium text-muted-foreground">
                {card.title || "Untitled Expedition"}
              </CardTitle>
              <CardDescription>
                Moved to Trash: {when(card.deletedAt)}. Deleted for good on{" "}
                {dateFormat.format(new Date(card.purgeAfter))}.
              </CardDescription>
            </CardHeader>
            <CardFooter className="mt-auto gap-3 text-muted-foreground">
              <span data-testid="card-counts">{countsLabel(card.counts)}</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(card.id)
                  await onRestore(card)
                  setBusy(null)
                }}
              >
                {busy === card.id ? <Spinner /> : <RotateCcwIcon />}
                Restore
              </Button>
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
  )
}

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="flex scroll-mt-20 flex-col gap-3"
    >
      <h2 id={`${id}-heading`} className="font-reading text-2xl font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Offline: the Expeditions saved on this device, to read. */
function SavedOffline({ entries }: { entries: OfflineEntry[] }) {
  const saved = entries
    .filter((e) => e.savedAt !== null)
    .sort((a, b) => b.openedAt - a.openedAt)
  return (
    <Section id="saved-offline" title="Available offline">
      {saved.length ? (
        <ul
          aria-label="Available offline"
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4"
        >
          {saved.map((e) => (
            <li key={e.expeditionId}>
              <Card size="sm" className="relative h-full">
                <CardHeader>
                  <CardTitle className="font-reading text-lg font-medium">
                    <Link href={`/e/${e.expeditionId}`} className={cardLink}>
                      {e.title || "Untitled Expedition"}
                    </Link>
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1.5">
                    {e.pinned && <PinIcon className="size-3.5" />}
                    As of {formatAsOf(e.savedAt!)}
                  </CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          Nothing is saved on this device yet. Expeditions you open are kept for
          reading offline.
        </p>
      )}
    </Section>
  )
}

export function LibraryScreen() {
  const user = useUser()
  const [, navigate] = useLocation()
  const [list, setList] = React.useState<ListState>({ status: "loading" })
  const [busy, setBusy] = React.useState<"new" | "import" | null>(null)
  const [tag, setTag] = React.useState<string | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const offline = useOfflineEntries(user.id)
  const kept = React.useMemo(
    () => new Set(offline.filter((e) => e.pinned).map((e) => e.expeditionId)),
    [offline]
  )

  const [trash, setTrash] = React.useState<TrashedCard[]>([])
  const load = React.useCallback(() => {
    listExpeditions().then(
      (expeditions) => setList({ status: "ready", expeditions }),
      (error: Error) => setList({ status: "error", error })
    )
    // Trash is secondary: offline or failing, it just isn't shown.
    listTrash().then(setTrash, () => setTrash([]))
  }, [])
  React.useEffect(load, [load])

  const cards = React.useMemo(
    () => (list.status === "ready" ? list.expeditions : []),
    [list]
  )
  const byId = React.useMemo(
    () => new Map(cards.map((c) => [c.id, c])),
    [cards]
  )
  const tags = React.useMemo(() => libraryTags(cards), [cards])
  const activeTag = tag && tags.some((t) => t.tag === tag) ? tag : null
  const sections = React.useMemo(
    () => librarySections(withTag(cards, activeTag)),
    [cards, activeTag]
  )
  const all = librarySections(cards)

  const onKeep = (card: LibraryCard, keep: boolean) => {
    setKeptOffline(user.id, card, keep).then(
      () => {
        if (keep)
          toast.add({
            title: "Kept available offline",
            description: `${card.title || "This Expedition"} can be read without a connection on this device.`,
          })
      },
      (e: Error) =>
        toast.add({
          title: "Couldn't save it for offline reading",
          description: e.message,
          type: "error",
        })
    )
  }

  const onRestore = async (card: TrashedCard) => {
    try {
      await restoreExpedition(card.id)
      toast.add({
        title: `Restored ${card.title || "the Expedition"}`,
        description: "Everyone it was shared with can open it again.",
        type: "success",
      })
      load()
    } catch (e) {
      toast.add({
        title: "Couldn't restore it",
        description: (e as Error).message,
        type: "error",
      })
    }
  }

  const onNew = async () => {
    setBusy("new")
    try {
      const created = await createExpedition("Untitled Expedition")
      navigate(`/new/${created.id}`)
    } catch (e) {
      setBusy(null)
      toast.add({
        title: "Couldn't create an Expedition",
        description: (e as Error).message,
        type: "error",
      })
    }
  }

  const onImport = async (file: File) => {
    setBusy("import")
    try {
      const { expedition, counts } = await importExpedition(file)
      toast.add({
        title: `Imported ${expedition.title || "the Expedition"}`,
        description: importedLabel(counts),
        type: "success",
      })
      navigate(`/e/${expedition.id}`)
    } catch (e) {
      setBusy(null)
      toast.add({
        title: "Couldn't import that file",
        description:
          e instanceof ApiError && e.status === 413
            ? "It's larger than 25 MB."
            : (e as Error).message,
        type: "error",
      })
    }
  }

  const actions = (
    <>
      <Button
        variant="outline"
        onClick={() => fileInput.current?.click()}
        disabled={!!busy}
      >
        {busy === "import" ? <Spinner /> : <UploadIcon />}
        Import
      </Button>
      <Button onClick={onNew} disabled={!!busy}>
        {busy === "new" ? <Spinner /> : <PlusIcon />}
        New
      </Button>
    </>
  )

  const unreachable =
    list.status === "error" &&
    list.error instanceof ApiError &&
    list.error.status === 0
  const grid = (label: string, items: LibraryCard[]) => (
    <CardGrid
      label={label}
      cards={items}
      meId={user.id}
      kept={kept}
      onKeep={onKeep}
    />
  )
  const nav = [
    {
      id: SECTION_IDS.yours,
      label: "Your Expeditions",
      count: all.yours.length,
    },
    {
      id: SECTION_IDS.shared,
      label: "Shared with you",
      count: all.shared.length,
    },
    { id: SECTION_IDS.drafts, label: "Drafts", count: all.drafts.length },
    { id: SECTION_IDS.trash, label: "Trash", count: trash.length },
  ]

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 sm:px-6">
        <Link href="/" aria-label="Library">
          <Wordmark />
        </Link>
        <div className="flex flex-1 justify-center">
          <GlobalSearch />
        </div>
        {actions}
        <AccountMenu />
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json,application/zip,.zip"
          className="hidden"
          aria-label="Import an Expedition file"
          data-testid="import-file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) void onImport(file)
          }}
        />
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:flex-row">
        {list.status === "ready" && (cards.length > 0 || trash.length > 0) && (
          <aside className="flex shrink-0 flex-col gap-6 lg:sticky lg:top-22 lg:w-52 lg:self-start">
            <nav
              aria-label="Library sections"
              className="flex flex-col gap-0.5"
            >
              {nav
                .filter((s) => s.count > 0 || s.id === SECTION_IDS.yours)
                .map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
                  >
                    {s.label}
                    <span className="text-muted-foreground tabular-nums">
                      {s.count}
                    </span>
                  </a>
                ))}
            </nav>
            {tags.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Tags
                </span>
                <ToggleGroup
                  aria-label="Filter by Tag"
                  data-testid="tag-filter"
                  variant="outline"
                  size="sm"
                  spacing={1}
                  className="w-full flex-wrap"
                  value={activeTag ? [activeTag] : []}
                  onValueChange={(value: unknown[]) =>
                    setTag((value[0] as string | undefined) ?? null)
                  }
                >
                  {tags.map((t) => (
                    <ToggleGroupItem
                      key={t.tag}
                      value={t.tag}
                      className="rounded-full"
                    >
                      #{t.tag}
                      <span className="text-muted-foreground tabular-nums">
                        {t.count}
                      </span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col gap-10">
          <h1 className="sr-only">Library</h1>
          <ContinueReading cards={byId} />

          {unreachable && (
            <>
              <Alert>
                <CloudOffIcon />
                <AlertTitle>You're offline</AlertTitle>
                <AlertDescription>
                  Expeditions saved on this device open read-only. The rest of
                  your Library comes back with the connection.
                </AlertDescription>
              </Alert>
              <SavedOffline entries={offline} />
            </>
          )}

          {!unreachable && (
            <Section id={SECTION_IDS.yours} title="Your Expeditions">
              {list.status === "loading" && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-72 rounded-xl" />
                  ))}
                </div>
              )}

              {list.status === "error" && (
                <Alert variant="destructive">
                  <AlertTitle>Couldn't load your Expeditions</AlertTitle>
                  <AlertDescription>{list.error.message}</AlertDescription>
                </Alert>
              )}

              {list.status === "ready" && cards.length === 0 && (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CompassIcon />
                    </EmptyMedia>
                    <EmptyTitle>No Expeditions yet</EmptyTitle>
                    <EmptyDescription>
                      Start a new one, or import one exported as JSON.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="flex-row justify-center">
                    {actions}
                  </EmptyContent>
                </Empty>
              )}

              {list.status === "ready" &&
                cards.length > 0 &&
                (sections.yours.length > 0 ? (
                  grid("Your Expeditions", sections.yours)
                ) : (
                  <p className="text-muted-foreground">
                    {activeTag
                      ? `None of yours is tagged #${activeTag}.`
                      : "None yet: your drafts are below, and the ones shared with you."}
                  </p>
                ))}
            </Section>
          )}

          {sections.shared.length > 0 && (
            <Section id={SECTION_IDS.shared} title="Shared with you">
              {grid("Shared with you", sections.shared)}
            </Section>
          )}

          {sections.drafts.length > 0 && (
            <Section id={SECTION_IDS.drafts} title="Drafts">
              {grid("Drafts", sections.drafts)}
            </Section>
          )}

          {!unreachable && trash.length > 0 && (
            <Section id={SECTION_IDS.trash} title="Trash">
              <p className="text-muted-foreground">
                Expeditions you deleted. Each is deleted for good, Sources
                included, 30 days after it was moved here.
              </p>
              <Trash cards={trash} onRestore={onRestore} />
            </Section>
          )}
        </main>
      </div>
    </div>
  )
}
