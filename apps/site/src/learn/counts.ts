// The Examples' counts ("206 CONCEPTS · 12 VIEWS"), read at build time from
// the public API, so the site stays right after each redeploy as the
// showcases grow. A showcase that can't be read (offline, private, an error)
// keeps its last known counts. SITE_COUNTS=offline skips the network (the
// tests use it).
//
// The count comes from the Expedition's op log (`GET /api/pull`, readable
// anonymously for public Expeditions): Concepts and Views created and not
// deleted. The site composes @seply/ui only, so it folds the ops itself.
import { APP_URL } from "../lib/env"

export type Counts = { concepts: number; views: number }

type Op = { serverSeq: number; kind: string; target: string }
type PullPage = { ops: Op[]; more: boolean }

/** Folds an op log into live Concept and View counts. */
export function countOps(ops: Op[]): Counts {
  const concepts = new Set<string>()
  const views = new Set<string>()
  for (const op of ops) {
    const [entity, action] = op.kind.split(".")
    const set =
      entity === "concept" ? concepts : entity === "view" ? views : null
    if (!set) continue
    if (action === "create" || action === "restore") set.add(op.target)
    else if (action === "delete") set.delete(op.target)
  }
  return { concepts: concepts.size, views: views.size }
}

async function fetchCounts(id: string): Promise<Counts> {
  const ops: Op[] = []
  let since = 0
  // A few pages at most; the showcases are a few thousand ops.
  for (let i = 0; i < 50; i++) {
    const res = await fetch(
      `${APP_URL}/api/pull?expedition=${id}&since=${since}&limit=1000`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (!res.ok) throw new Error(`pull ${id}: ${res.status}`)
    const page = (await res.json()) as PullPage
    ops.push(...page.ops)
    if (!page.more || page.ops.length === 0) break
    since = page.ops.at(-1)!.serverSeq
  }
  return countOps(ops)
}

/** "206 CONCEPTS · 12 VIEWS". */
export const countsLabel = ({ concepts, views }: Counts) =>
  `${concepts} ${concepts === 1 ? "CONCEPT" : "CONCEPTS"} · ${views} ${views === 1 ? "VIEW" : "VIEWS"}`

/** The live counts, or `fallback` when they can't be read. */
export async function showcaseCounts(
  id: string,
  fallback: Counts
): Promise<Counts> {
  if (process.env.SITE_COUNTS === "offline") return fallback
  try {
    const counts = await fetchCounts(id)
    return counts.concepts > 0 ? counts : fallback
  } catch (err) {
    console.warn(
      `[site] counts for ${id}: ${err instanceof Error ? err.message : err}; using the last known ones`
    )
    return fallback
  }
}
