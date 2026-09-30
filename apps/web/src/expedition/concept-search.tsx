// Search inside the Expedition (spec §3.6, §2.8): text or `#tag`, matched on
// the client over the Concepts already loaded (so it works offline). The
// canvas dims everything that doesn't match; Escape clears.
import { Badge } from "@seply/ui/components/badge"
import { Input } from "@seply/ui/components/input"

export function ConceptSearch({
  query,
  onQueryChange,
  matchCount,
}: {
  query: string
  onQueryChange: (query: string) => void
  /** Matching Concepts, or undefined when the query is empty. */
  matchCount: number | undefined
}) {
  return (
    <div role="search" className="flex items-center gap-2">
      {matchCount !== undefined && (
        <Badge
          variant={matchCount ? "secondary" : "outline"}
          data-testid="search-count"
          aria-live="polite"
        >
          {matchCount === 1 ? "1 match" : `${matchCount} matches`}
        </Badge>
      )}
      <Input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onQueryChange("")
        }}
        placeholder="Search text or #tag"
        aria-label="Search this Expedition"
        className="w-40 sm:w-56"
      />
    </div>
  )
}
