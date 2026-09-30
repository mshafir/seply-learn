// What the side panel reads (spec §3.7): the back stack, provenance labels,
// Relationships in natural language both ways, and Attribute values. Pure
// functions of the live rows, so they are unit tested without a browser.
import {
  BUILTIN_REL_TYPE_BY_ID,
  type AttributeValue,
  type PaletteColor,
  type Prov,
} from "@seply/domain"
import type {
  ArticleSectionRow,
  AttributeDefRow,
  ConceptRow,
  RelationshipRow,
  RelTypeDefRow,
  SourceRow,
} from "@seply/sync"

// ─── Back stack ────────────────────────────────────────────────────────────

/**
 * One place in the panel. The overview depth shows the summary and the
 * overview (one read); the article depth is the full write-up.
 */
export type PanelDepth = "overview" | "article"
export type PanelEntry = { conceptId: string; depth: PanelDepth }
/** Oldest first; the last entry is on screen. Never empty. */
export type BackStack = readonly PanelEntry[]

/** Opens a Concept fresh (a canvas click): the stack starts over. */
export const openConcept = (conceptId: string): BackStack => [
  { conceptId, depth: "overview" },
]

/** Follows a link or opens the article: pushes, unless it is already on top. */
export function push(stack: BackStack, entry: PanelEntry): BackStack {
  const top = stack[stack.length - 1]
  if (top && top.conceptId === entry.conceptId && top.depth === entry.depth)
    return stack
  return [...stack, entry]
}

/** Goes back one place; the first entry stays. */
export const back = (stack: BackStack): BackStack =>
  stack.length > 1 ? stack.slice(0, -1) : stack

/** Drops entries whose Concept is gone (deleted, or merged away). */
export const pruneStack = (
  stack: BackStack,
  exists: (conceptId: string) => boolean
): BackStack => stack.filter((e) => exists(e.conceptId))

/** The Concept id of an in-text link (`#c/<id>`), or null for any other href. */
export function conceptLinkId(href: string | undefined): string | null {
  const match = href?.match(/^#c\/(.+)$/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return match[1]!
  }
}

// ─── Provenance ────────────────────────────────────────────────────────────

export type ProvenanceLabel = {
  kind: "source" | "background"
  text: string
  /** The first ref, for the Source viewer to open at (a later work package). */
  ref?: { source: string; segment: string }
}

const numbered = (ids: string[], prefix: string) =>
  ids.every((id) => new RegExp(`^${prefix}\\d+$`).test(id))
    ? ids.map((id) => Number(id.slice(prefix.length))).sort((a, b) => a - b)
    : null

/** "3", "3 and 14", "3, 9 and 14". */
function listNumbers(ns: number[]): string {
  const unique = [...new Set(ns)].map(String)
  if (unique.length <= 1) return unique.join("")
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`
}

/**
 * The badge for a provenance list (spec §3.7). An empty list is background
 * knowledge. Segment ids follow the seeding contract: `t14` is chat turn 14,
 * `s3` is document section 3.
 */
export function provenanceLabel(
  prov: Prov,
  sources: readonly SourceRow[]
): ProvenanceLabel {
  if (prov.length === 0)
    return { kind: "background", text: "Background knowledge" }

  const bySource = new Map<string, string[]>()
  for (const ref of prov) {
    bySource.set(ref.source, [...(bySource.get(ref.source) ?? []), ref.segment])
  }
  const parts = [...bySource].map(([sourceId, segments]) => {
    const source = sources.find((s) => s.id === sourceId)
    if (!source) return "From a Source"
    if (source.kind === "chat") {
      const turns = numbered(segments, "t")
      if (!turns) return "From the chat"
      return `From the chat, ${turns.length > 1 ? "turns" : "turn"} ${listNumbers(turns)}`
    }
    const name = source.kind === "prompt" ? "the prompt" : source.title
    const sections = numbered(segments, "s")
    if (!sections) return `From ${name}`
    return `From ${name}, ${sections.length > 1 ? "sections" : "section"} ${listNumbers(sections)}`
  })
  const first = prov[0]!
  return {
    kind: "source",
    text: [...new Set(parts)].join("; "),
    ref: { source: first.source, segment: first.segment },
  }
}

// ─── Relationships ─────────────────────────────────────────────────────────

export type RelTypeLabels = {
  label: string
  inverseLabel: string
  color?: PaletteColor
}

/** A Relationship Type's labels: the Expedition's own, else the built-in's. */
export function relTypeLabels(
  typeId: string,
  relTypeDefs: readonly RelTypeDefRow[]
): RelTypeLabels {
  const own = relTypeDefs.find((r) => r.id === typeId)
  const builtin = BUILTIN_REL_TYPE_BY_ID.get(typeId)
  const label = own?.label ?? builtin?.label ?? typeId
  return {
    label,
    inverseLabel: own?.inverseLabel ?? builtin?.inverseLabel ?? label,
    color: own?.color ?? builtin?.color,
  }
}

export type RelatedConcept = { id: string; title: string; note?: string }
/** One phrase and the Concepts it points at: "needs Tokenizer, Embedding". */
export type RelationshipGroup = {
  direction: "out" | "in"
  typeId: string
  phrase: string
  color?: PaletteColor
  concepts: RelatedConcept[]
}

/**
 * Relationships of one Concept in natural language, both ways. Outgoing ones
 * read with the Type's label ("is needed to understand X"), incoming ones with
 * its inverse label ("needs X"). Grouped by phrase, in first-seen order;
 * Concepts within a group by title.
 */
export function relationshipGroups(
  conceptId: string,
  relationships: readonly RelationshipRow[],
  concepts: ReadonlyMap<string, ConceptRow>,
  relTypeDefs: readonly RelTypeDefRow[]
): { out: RelationshipGroup[]; in: RelationshipGroup[] } {
  const groups = new Map<string, RelationshipGroup>()
  for (const rel of relationships) {
    const direction =
      rel.from === conceptId ? "out" : rel.to === conceptId ? "in" : null
    if (!direction) continue
    const otherId = direction === "out" ? rel.to : rel.from
    const other = concepts.get(otherId)
    if (!other || otherId === conceptId) continue
    const key = `${direction}|${rel.type}`
    let group = groups.get(key)
    if (!group) {
      const labels = relTypeLabels(rel.type, relTypeDefs)
      group = {
        direction,
        typeId: rel.type,
        phrase: direction === "out" ? labels.label : labels.inverseLabel,
        color: labels.color,
        concepts: [],
      }
      groups.set(key, group)
    }
    group.concepts.push({ id: other.id, title: other.title, note: rel.note })
  }
  const all = [...groups.values()]
  for (const g of all) g.concepts.sort((a, b) => a.title.localeCompare(b.title))
  return {
    out: all.filter((g) => g.direction === "out"),
    in: all.filter((g) => g.direction === "in"),
  }
}

// ─── Attributes ────────────────────────────────────────────────────────────

export type AttributeItem = { id: string; label: string; value: string }

/** A value as read: numbers localised with their unit, yes/no in words. */
export function formatAttribute(
  value: AttributeValue,
  def: Pick<AttributeDefRow, "type" | "unit"> | undefined
): string {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    const n = value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    const unit = def?.unit
    if (!unit) return n
    // A currency symbol leads ("$40"); a word unit is spaced ("12 hours");
    // a short symbol unit is not ("405B", "3.4×/yr", "40%").
    if (def.type === "money" && /^[$€£¥₹]$/.test(unit)) return `${unit}${n}`
    return /^\p{L}{2,}/u.test(unit) ? `${n} ${unit}` : `${n}${unit}`
  }
  return def?.unit ? `${value} ${def.unit}` : value
}

/**
 * A Concept's filled Attributes, in the Expedition's Attribute order. Values
 * of a removed Attribute (no live definition) are not shown.
 */
export function attributeItems(
  concept: ConceptRow,
  attributeDefs: readonly AttributeDefRow[]
): AttributeItem[] {
  const items: AttributeItem[] = []
  for (const def of attributeDefs) {
    const value = concept.attributes[def.id]
    if (value === undefined || value === "") continue
    items.push({
      id: def.id,
      label: def.label,
      value: formatAttribute(value, def),
    })
  }
  return items
}

// ─── Article ───────────────────────────────────────────────────────────────

const byOrderKey = (a: ArticleSectionRow, b: ArticleSectionRow) =>
  a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0

/** A Concept's article sections, in order. */
export const articleSectionsOf = (
  conceptId: string,
  sections: readonly ArticleSectionRow[]
): ArticleSectionRow[] =>
  sections.filter((s) => s.conceptId === conceptId).sort(byOrderKey)

/** The line above the panel title: Kind and date, or the article's length. */
export function conceptEyebrow(
  concept: Pick<ConceptRow, "date" | "dateEnd">,
  kindLabel: string,
  depth: PanelDepth,
  minutes: number
): string {
  if (depth === "article") return `Article · ${minutes} min`
  const date = concept.date
    ? concept.dateEnd
      ? `${concept.date}–${concept.dateEnd === "ongoing" ? "now" : concept.dateEnd}`
      : concept.date
    : null
  return [kindLabel, date].filter(Boolean).join(" · ")
}

/** Minutes to read some markdown, at 220 words a minute; at least 1. */
export function readingMinutes(md: readonly string[]): number {
  const words = md.join(" ").split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}
