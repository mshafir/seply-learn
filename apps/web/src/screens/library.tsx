// The Library (spec §3.2), basic for now: Continue reading, your
// Expeditions from the API, global search, New and Import. Shared with
// you, Drafts, the Tag filter and thumbnails come in later work packages.
import * as React from "react"
import { BookOpenIcon, CompassIcon, PlusIcon, UploadIcon } from "lucide-react"
import { Link, useLocation } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@umbel/ui/components/alert"
import { Badge } from "@umbel/ui/components/badge"
import { Wordmark } from "@umbel/ui/components/brand"
import { Button } from "@umbel/ui/components/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@umbel/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@umbel/ui/components/empty"
import { Skeleton } from "@umbel/ui/components/skeleton"
import { Spinner } from "@umbel/ui/components/spinner"
import { toast } from "@umbel/ui/components/toast"

import { AccountMenu } from "@/components/account-menu.tsx"
import { GlobalSearch } from "@/components/global-search.tsx"
import {
  ApiError,
  continueReading,
  createExpedition,
  importExpedition,
  listExpeditions,
  type ContinueReadingItem,
  type ExpeditionSummary,
} from "@/lib/api.ts"

type ListState =
  | { status: "loading" }
  | { status: "ready"; expeditions: ExpeditionSummary[] }
  | { status: "error"; error: Error }

const STATUS_LABEL: Record<ExpeditionSummary["status"], string> = {
  draft: "Draft",
  building: "Building",
  ready: "Ready",
}

const lastRead = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

/**
 * Continue reading (spec §3.2): the three Expeditions I read most recently.
 * Opening one lands where I left off (the Expedition screen resumes the
 * saved position). Hidden until there is something to continue.
 */
function ContinueReading() {
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
    <section aria-label="Continue reading" className="flex flex-col gap-4">
      <h2 className="font-reading text-2xl font-medium">Continue reading</h2>
      <ul
        data-testid="continue-reading"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {items.map(({ expedition: e, position }) => (
          <li key={e.id}>
            <Link
              href={`/e/${e.id}`}
              className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Card
                size="sm"
                className="h-full transition-colors hover:bg-accent"
              >
                <CardHeader>
                  <CardTitle className="font-reading text-lg font-medium">
                    {e.title || "Untitled Expedition"}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1.5">
                    <BookOpenIcon className="size-3.5" />
                    Last read {lastRead.format(new Date(position.at))}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function LibraryScreen() {
  const [, navigate] = useLocation()
  const [list, setList] = React.useState<ListState>({ status: "loading" })
  const [busy, setBusy] = React.useState<"new" | "import" | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)

  const load = React.useCallback(() => {
    listExpeditions().then(
      (expeditions) => setList({ status: "ready", expeditions }),
      (error: Error) => setList({ status: "error", error })
    )
  }, [])
  React.useEffect(load, [load])

  const onNew = async () => {
    setBusy("new")
    try {
      const created = await createExpedition("Untitled Expedition")
      navigate(`/e/${created.id}`)
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
      const { expedition, counts } = await importExpedition(await file.text())
      toast.add({
        title: `Imported ${expedition.title || "the Expedition"}`,
        description: `${counts.concepts} Concepts, ${counts.relationships} Relationships, ${counts.views} Views.`,
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

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 sm:px-6">
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
          accept="application/json,.json"
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

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <ContinueReading />
        <h1 className="font-reading text-3xl font-medium">Your Expeditions</h1>

        {list.status === "loading" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        )}

        {list.status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't load your Expeditions</AlertTitle>
            <AlertDescription>{list.error.message}</AlertDescription>
          </Alert>
        )}

        {list.status === "ready" && list.expeditions.length === 0 && (
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

        {list.status === "ready" && list.expeditions.length > 0 && (
          <ul
            aria-label="Your Expeditions"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {list.expeditions.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/e/${e.id}`}
                  className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Card className="h-full transition-colors hover:bg-accent">
                    <CardHeader>
                      <CardTitle className="font-reading text-xl font-medium">
                        {e.title || "Untitled Expedition"}
                      </CardTitle>
                      {e.summary && (
                        <CardDescription className="line-clamp-3">
                          {e.summary}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardFooter className="mt-auto gap-2">
                      <Badge variant="secondary">
                        {STATUS_LABEL[e.status]}
                      </Badge>
                      {e.role !== "owner" && (
                        <Badge variant="outline">
                          {e.role === "editor" ? "Editor" : "Viewer"}
                        </Badge>
                      )}
                    </CardFooter>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
