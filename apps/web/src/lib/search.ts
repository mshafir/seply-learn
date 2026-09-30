// Search queries as typed: free text plus `#tag` filters (spec §2.8). The
// server parses global queries the same way; inside an Expedition the
// Concepts already loaded are matched here, which also works offline.
import type { ConceptRow } from "@seply/sync"

export type ParsedQuery = { terms: string[]; tags: string[] }

/** Lower-cased, without accents, so "Levaín" finds "levain". */
export const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()

export function parseQuery(raw: string): ParsedQuery {
  const terms: string[] = []
  const tags: string[] = []
  for (const w of raw.trim().split(/\s+/)) {
    if (!w || w === "#") continue
    if (w.startsWith("#")) tags.push(fold(w.slice(1).replace(/[.,;:!?]+$/, "")))
    else terms.push(fold(w))
  }
  return { terms, tags: tags.filter(Boolean) }
}

/**
 * The query after picking `tag` from the Tags group: the prefix it was
 * suggested for (the free text, else the last `#tag`) becomes `#tag`.
 */
export function withTag(query: string, tag: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean)
  const tags = words.filter((w) => w.startsWith("#") && w.length > 1)
  const hasText = words.some((w) => !w.startsWith("#"))
  const kept = hasText ? tags : tags.slice(0, -1)
  const next = [...new Set([...kept, `#${tag}`])]
  return `${next.join(" ")} `
}

/**
 * The Concepts matching a query inside one Expedition, or undefined for an
 * empty query (nothing is dimmed). Every word must match: a text word within
 * the title, an alias, the summary or a Tag; a `#tag` as the start of a Tag.
 */
export function matchConcepts(
  concepts: readonly ConceptRow[],
  query: string
): Set<string> | undefined {
  const { terms, tags } = parseQuery(query)
  if (!terms.length && !tags.length) return undefined
  const out = new Set<string>()
  for (const c of concepts) {
    const conceptTags = c.tags.map(fold)
    const text = fold(
      [c.title, ...c.aliases, c.summary ?? "", ...c.tags].join("\n")
    )
    if (
      tags.every((t) => conceptTags.some((ct) => ct.startsWith(t))) &&
      terms.every((t) => text.includes(t))
    )
      out.add(c.id)
  }
  return out
}
