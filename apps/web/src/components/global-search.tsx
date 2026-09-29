// Global search (spec §3.2, §2.8): the Library's "Search Concepts, articles
// and #tags" button opens a command dialog. Results come from the server,
// grouped by Expedition, Concept and Tag; `#tag` filters by Tag, and picking
// a Tag puts it in the query. "Include public Expeditions" widens the scope
// beyond the Expeditions I collaborate on. It needs a connection.
import * as React from "react"
import { CompassIcon, HashIcon, LightbulbIcon, SearchIcon } from "lucide-react"
import { useLocation } from "wouter"

import { Button } from "@umbel/ui/components/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@umbel/ui/components/command"
import { Label } from "@umbel/ui/components/label"
import { Spinner } from "@umbel/ui/components/spinner"
import { Switch } from "@umbel/ui/components/switch"

import { searchAll, type SearchResults } from "@/lib/api.ts"
import { withTag } from "@/lib/search.ts"

const DEBOUNCE_MS = 150

type SearchState =
  | { status: "idle" }
  | { status: "loading"; results?: SearchResults }
  | { status: "ready"; results: SearchResults }
  | { status: "error"; message: string }

type Answer = { key: string } & ({ results: SearchResults } | { error: string })

/** Debounced server search; stale answers are dropped (aborted). */
function useGlobalSearch(query: string, includePublic: boolean): SearchState {
  const [answer, setAnswer] = React.useState<Answer | null>(null)
  const q = query.trim()
  const active = !!q && q !== "#"
  const key = `${includePublic ? 1 : 0}:${q}`
  React.useEffect(() => {
    if (!active) return
    const ctl = new AbortController()
    const timer = setTimeout(() => {
      searchAll(q, includePublic, ctl.signal).then(
        (results) => setAnswer({ key, results }),
        (e: Error) => {
          if (!ctl.signal.aborted) setAnswer({ key, error: e.message })
        }
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [active, q, includePublic, key])
  if (!active) return { status: "idle" }
  if (answer?.key === key)
    return "results" in answer
      ? { status: "ready", results: answer.results }
      : { status: "error", message: answer.error }
  // Keep the previous results on screen while the next ones load.
  return {
    status: "loading",
    results: answer && "results" in answer ? answer.results : undefined,
  }
}

export function GlobalSearch() {
  const [, navigate] = useLocation()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [includePublic, setIncludePublic] = React.useState(false)
  const state = useGlobalSearch(query, includePublic)
  const results =
    state.status === "ready" || state.status === "loading"
      ? state.results
      : undefined

  // ⌘K / Ctrl+K opens it from anywhere on the Library.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const go = (href: string) => {
    setOpen(false)
    navigate(href)
  }
  const empty =
    results &&
    !results.expeditions.length &&
    !results.concepts.length &&
    !results.tags.length

  return (
    <>
      <Button
        variant="outline"
        className="w-full max-w-sm justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
        data-testid="global-search"
      >
        <SearchIcon />
        <span className="truncate">Search Concepts, articles and #tags</span>
        <CommandShortcut className="hidden sm:inline">⌘K</CommandShortcut>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search Concepts, articles and #tags"
        className="sm:max-w-xl"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search Concepts, articles and #tags"
            aria-label="Search"
          />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <Label className="text-muted-foreground">
              <Switch
                size="sm"
                checked={includePublic}
                onCheckedChange={setIncludePublic}
                aria-label="Include public Expeditions"
              />
              Include public Expeditions
            </Label>
            {state.status === "loading" && (
              <Spinner
                className="size-4 text-muted-foreground"
                data-testid="search-loading"
              />
            )}
          </div>
          <CommandList className="max-h-96" data-testid="search-results">
            {state.status === "idle" && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Type to search your Expeditions. Start with # to filter by a
                Tag.
              </p>
            )}
            {state.status === "error" && (
              <p
                role="alert"
                className="px-3 py-6 text-center text-sm text-destructive"
              >
                Search needs a connection. {state.message}
              </p>
            )}
            {empty && state.status === "ready" && (
              <CommandEmpty>No results.</CommandEmpty>
            )}
            {results && results.expeditions.length > 0 && (
              <CommandGroup heading="Expeditions">
                {results.expeditions.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`expedition:${e.id}`}
                    onSelect={() => go(`/e/${e.id}`)}
                  >
                    <CompassIcon />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {e.title || "Untitled Expedition"}
                      </div>
                      {e.summary && (
                        <div className="truncate text-xs text-muted-foreground">
                          {e.summary}
                        </div>
                      )}
                    </div>
                    {e.role === null && (
                      <CommandShortcut className="tracking-normal">
                        Public
                      </CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results && results.concepts.length > 0 && (
              <CommandGroup heading="Concepts">
                {results.concepts.map((c) => (
                  <CommandItem
                    key={`${c.expeditionId}/${c.id}`}
                    value={`concept:${c.expeditionId}/${c.id}`}
                    onSelect={() =>
                      go(
                        `/e/${c.expeditionId}?concept=${encodeURIComponent(c.id)}`
                      )
                    }
                  >
                    <LightbulbIcon />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{c.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.expeditionTitle || "Untitled Expedition"}
                        {c.summary ? ` · ${c.summary}` : ""}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results && results.tags.length > 0 && (
              <CommandGroup heading="Tags">
                {results.tags.map((t) => (
                  <CommandItem
                    key={t.tag}
                    value={`tag:${t.tag}`}
                    onSelect={() => setQuery(withTag(query, t.tag))}
                  >
                    <HashIcon />
                    <span className="flex-1 truncate">{t.tag}</span>
                    <CommandShortcut className="tracking-normal">
                      {t.count}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
