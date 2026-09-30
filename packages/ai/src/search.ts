// `search_existing(title|alias)`: find Concepts the agent may be about to
// duplicate. Matching is on normalized titles and aliases, the same key the
// chunk-and-merge fallback matches on (spec §5.2).
import type { Concept, DomainState } from "@seply/domain"
import { liveConcepts } from "./checks/common.ts"

/** Lower case, no accents or punctuation, no leading article, single spaces. */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an) /, "")
}

export type SearchHit = {
  id: string
  title: string
  kind: string
  aliases: string[]
  summary?: string
  /** exact: a title or alias is the query; partial: one contains the other; words: every query word appears. */
  match: "exact" | "partial" | "words"
}

const RANK = { exact: 0, partial: 1, words: 2 } as const

export function searchExisting(
  state: DomainState,
  query: string,
  limit = 10
): SearchHit[] {
  const q = normalizeTitle(query)
  if (!q) return []
  const words = q.split(" ")
  const hits: SearchHit[] = []
  for (const c of liveConcepts(state)) {
    const names = [c.title, ...c.aliases].map(normalizeTitle)
    const match = names.includes(q)
      ? "exact"
      : names.some((n) => n && (n.includes(q) || q.includes(n)))
        ? "partial"
        : names.some((n) => words.every((w) => n.split(" ").includes(w)))
          ? "words"
          : undefined
    if (match) hits.push(hitOf(c, match))
  }
  return hits
    .sort(
      (a, b) => RANK[a.match] - RANK[b.match] || a.title.localeCompare(b.title)
    )
    .slice(0, limit)
}

const hitOf = (c: Concept, match: SearchHit["match"]): SearchHit => ({
  id: c.id,
  title: c.title,
  kind: c.kind,
  aliases: c.aliases,
  ...(c.summary !== undefined && { summary: c.summary }),
  match,
})
