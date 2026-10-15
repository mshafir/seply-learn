// Explore (spec §3.13): every public Expedition, newest Change first, for
// anyone. No sign-in is needed to browse or read; signing in is only for
// making your own or a Fork. Search narrows by title and summary, and a Tag
// filter by Expedition Tags. Cards look like the Library's, without people.
import * as React from "react"
import { CompassIcon, LibraryIcon, SearchIcon } from "lucide-react"
import { Link } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Wordmark } from "@seply/ui/components/brand"
import { Button, buttonVariants } from "@seply/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@seply/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@seply/ui/components/input-group"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import { ToggleGroup, ToggleGroupItem } from "@seply/ui/components/toggle-group"

import { AccountMenu } from "@/components/account-menu.tsx"
import { ExpeditionCard } from "@/components/expedition-card.tsx"
import {
  exploreExpeditions,
  type ExploreCard,
  type ExplorePage,
} from "@/lib/api.ts"
import { cardGrid } from "@/lib/cards.ts"
import { useSession } from "@/lib/session.ts"

type ListState =
  | { status: "loading" }
  | {
      status: "ready"
      cards: ExploreCard[]
      nextCursor: string | null
      more: "idle" | "loading" | "failed"
    }
  | { status: "error"; error: Error }

/** Waits this long after typing before searching. */
const SEARCH_DELAY_MS = 250

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

export function ExploreScreen() {
  const { session } = useSession()
  const signedIn = session.status === "signed-in"
  const [query, setQuery] = React.useState("")
  const q = useDebounced(query, SEARCH_DELAY_MS)
  const [tag, setTag] = React.useState<string | null>(null)
  const [tags, setTags] = React.useState<ExplorePage["tags"]>([])
  // The last answer, for the search it answered; a newer search shows as loading.
  const key = `${q}\n${tag ?? ""}`
  const [result, setResult] = React.useState<
    (Exclude<ListState, { status: "loading" }> & { for: string }) | null
  >(null)
  const list: ListState =
    result && result.for === key ? result : { status: "loading" }

  React.useEffect(() => {
    let live = true
    exploreExpeditions({ q, tag }).then(
      (page) => {
        if (!live) return
        // The Tag list is the same whatever the search: keep the first one.
        setTags((t) => (t.length ? t : page.tags))
        setResult({
          for: key,
          status: "ready",
          cards: page.expeditions,
          nextCursor: page.nextCursor,
          more: "idle",
        })
      },
      (error: Error) => live && setResult({ for: key, status: "error", error })
    )
    return () => {
      live = false
    }
  }, [q, tag, key])

  const loadMore = () => {
    if (list.status !== "ready" || !list.nextCursor) return
    const cursor = list.nextCursor
    const same = (r: typeof result) =>
      r?.status === "ready" && r.for === key && r.nextCursor === cursor
    setResult((r) => (same(r) ? { ...r!, more: "loading" } : r))
    exploreExpeditions({ q, tag, cursor }).then(
      (page) =>
        setResult((r) =>
          same(r) && r?.status === "ready"
            ? {
                ...r,
                cards: [...r.cards, ...page.expeditions],
                nextCursor: page.nextCursor,
                more: "idle",
              }
            : r
        ),
      () =>
        setResult((r) =>
          same(r) && r?.status === "ready" ? { ...r, more: "failed" } : r
        )
    )
  }

  const filtered = !!q.trim() || !!tag

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 sm:px-6">
        <Link href={signedIn ? "/" : "/explore"} aria-label="Seply Learn">
          <Wordmark />
        </Link>
        <div className="flex-1" />
        {signedIn ? (
          <>
            <Link
              href="/"
              className={buttonVariants({ variant: "ghost" })}
              data-testid="library-link"
            >
              <LibraryIcon />
              Library
            </Link>
            <AccountMenu />
          </>
        ) : (
          <Link
            href={`/sign-in?next=${encodeURIComponent("/explore")}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Sign in
          </Link>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4">
          <h1 className="font-reading text-3xl font-medium">Explore</h1>
          <InputGroup className="max-w-xl">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search public Expeditions"
              placeholder="Search public Expeditions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          {tags.length > 0 && (
            <ToggleGroup
              aria-label="Filter by Tag"
              data-testid="tag-filter"
              variant="outline"
              size="sm"
              spacing={1}
              className="flex-wrap"
              value={tag ? [tag] : []}
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
          )}
        </div>

        {list.status === "loading" && (
          <div className={cardGrid}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72 rounded-xl" />
            ))}
          </div>
        )}

        {list.status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't load public Expeditions</AlertTitle>
            <AlertDescription>{list.error.message}</AlertDescription>
          </Alert>
        )}

        {list.status === "ready" && list.cards.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CompassIcon />
              </EmptyMedia>
              <EmptyTitle>
                {filtered ? "Nothing matches" : "No public Expeditions yet"}
              </EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? "Try other words, or clear the Tag filter."
                  : "When someone makes an Expedition public, it is listed here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {list.status === "ready" && list.cards.length > 0 && (
          <>
            <ul aria-label="Public Expeditions" className={cardGrid}>
              {list.cards.map((card) => (
                <li key={card.id}>
                  <ExpeditionCard card={card} href={`/e/${card.id}`}>
                    {card.tags.length > 0 && (
                      <p className="line-clamp-1 text-muted-foreground">
                        {card.tags.map((t) => `#${t}`).join(" ")}
                      </p>
                    )}
                  </ExpeditionCard>
                </li>
              ))}
            </ul>
            {list.nextCursor && (
              <div className="flex flex-col items-center gap-2">
                <Button
                  variant="outline"
                  onClick={loadMore}
                  disabled={list.more === "loading"}
                >
                  {list.more === "loading" && <Spinner />}
                  Load more
                </Button>
                {list.more === "failed" && (
                  <p className="text-sm text-destructive">
                    Couldn't load more. Try again.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
