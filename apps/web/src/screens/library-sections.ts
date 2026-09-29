// The Library's sections and card text (spec §3.2), as pure functions.
import type { CardCollaborator, LibraryCard } from "@/lib/api.ts"

export type LibrarySections = {
  /** Mine (owner), built or building. */
  yours: LibraryCard[]
  /** Others' that I edit or view, built or building. */
  shared: LibraryCard[]
  /** Not built yet, that I can edit (owner or editor). */
  drafts: LibraryCard[]
}

/**
 * Splits the list into the Library's sections. Each Expedition is in one:
 * a draft I can edit is under Drafts; otherwise mine are Yours and the rest
 * Shared with you. The list's order (newest first) is kept.
 */
export function librarySections(
  cards: readonly LibraryCard[]
): LibrarySections {
  const out: LibrarySections = { yours: [], shared: [], drafts: [] }
  for (const card of cards) {
    if (card.status === "draft" && card.role !== "viewer") out.drafts.push(card)
    else if (card.role === "owner") out.yours.push(card)
    else out.shared.push(card)
  }
  return out
}

/** Every Expedition Tag in the list, with how many Expeditions carry it, A–Z. */
export function libraryTags(
  cards: readonly LibraryCard[]
): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const card of cards)
    for (const tag of new Set(card.tags))
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

/** The cards carrying the Tag (all of them for null). */
export function withTag<T extends Pick<LibraryCard, "tags">>(
  cards: readonly T[],
  tag: string | null
): T[] {
  return tag ? cards.filter((c) => c.tags.includes(tag)) : [...cards]
}

/**
 * The collaborators' short summary: "Only you", "You and Ada", "You, Ada and
 * Bo", "You, Ada and 3 others"; someone else's first when I'm not on it.
 */
export function collaboratorSummary(
  people: readonly CardCollaborator[],
  meId: string | null
): string {
  const me = people.find((p) => p.id === meId)
  const others = people.filter((p) => p.id !== meId).map((p) => p.name)
  const names = me ? ["You", ...others] : others
  if (!names.length) return ""
  if (me && names.length === 1) return "Only you"
  if (names.length === 1) return names[0]!
  if (names.length <= 3)
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`
}

/** "201 Concepts · 12 Views". */
export function countsLabel({
  concepts,
  views,
}: LibraryCard["counts"]): string {
  const n = (count: number, one: string) =>
    `${count} ${count === 1 ? one : `${one}s`}`
  return `${n(concepts, "Concept")} · ${n(views, "View")}`
}

/** Initials for an avatar: "Ada Lovelace" → "AL", "ada" → "AD". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2)
    return (words[0]![0]! + words.at(-1)![0]!).toUpperCase()
  return (words[0] ?? "?").slice(0, 2).toUpperCase()
}
