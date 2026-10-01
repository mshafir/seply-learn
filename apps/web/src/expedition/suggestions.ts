// What the Suggestions tab says (spec §3.8, WP-4.3): each pending item in
// plain words ("New Concept · KV cache", "KV cache is part of Attention",
// "Article for MLA · 3 sections"), whether it is stale ("changed since
// suggested", with both versions), and what accepting it brings along.
// Reader-facing copy says "suggestions"; the code says Proposal.
import {
  BUILTIN_REL_TYPE_BY_ID,
  isStale,
  parseRelKey,
  staleness,
  withDependencies,
  type DomainState,
  type ProposalItemView,
  type ProposalView,
  type StaleField,
  type Staleness,
} from "@seply/domain"

/** One pending item, with its Proposal (the ask) and how it stands now. */
export type PendingItem = {
  item: ProposalItemView
  proposal: ProposalView
  staleness: Staleness
}

/** A Proposal (one ask) and its pending items, as the tab groups them. */
export type SuggestionGroup = {
  proposal: ProposalView
  items: PendingItem[]
}

/** The pending items of every Proposal, grouped by ask (oldest ask first). */
export function groupPending(
  state: DomainState,
  proposals: readonly ProposalView[]
): SuggestionGroup[] {
  const pool = pendingPool(proposals)
  return proposals
    .map((proposal) => ({
      proposal,
      items: proposal.items
        .filter((i) => i.status === "pending")
        .map((item) => ({
          item,
          proposal,
          staleness: staleness(state, item, pool),
        })),
    }))
    .filter((g) => g.items.length > 0)
}

/** Every pending item, across Proposals. */
export const pendingPool = (proposals: readonly ProposalView[]) =>
  proposals.flatMap((p) => p.items.filter((i) => i.status === "pending"))

export const countPending = (proposals: readonly ProposalView[]) =>
  pendingPool(proposals).length

export type AcceptPlan = {
  /** Everything to accept, in the order it applies. */
  ids: string[]
  /** Items included because an accepted one needs them (shown before confirming). */
  added: string[]
  /** Items that changed since suggested: accepting overwrites them. */
  stale: string[]
  /** Items left out: something they need is gone. They stay pending. */
  skipped: string[]
}

/**
 * What accepting `selected` does: its dependencies, which of them are stale
 * (an explicit overwrite) and which can't be accepted at all.
 */
export function planAccept(
  state: DomainState,
  proposals: readonly ProposalView[],
  selected: readonly string[]
): AcceptPlan {
  const pool = pendingPool(proposals)
  const how = new Map(pool.map((i) => [i.id, staleness(state, i, pool)]))
  const gone = (id: string) => !!how.get(id)?.gone.length
  // An item that can't apply, or that needs one that can't, stays pending.
  const ok: string[] = []
  const skipped: string[] = []
  for (const id of selected) {
    const needs = withDependencies(state, pool, [id]).ids
    if (needs.some(gone)) skipped.push(id)
    else ok.push(id)
  }
  const { ids, added } = withDependencies(state, pool, ok)
  return {
    ids,
    added,
    stale: ids.filter((id) => isStale(how.get(id)!)),
    skipped,
  }
}

// --- describing items --------------------------------------------------------

export type ItemKind = "concept" | "relationship" | "article" | "edit"

export type ItemDescription = {
  kind: ItemKind
  /** "New Concept", "New Relationship", "Article", "Edit". */
  label: string
  /** "KV cache", "KV cache is part of Attention", "for MLA · 3 sections". */
  title: string
  /** A line under it: a summary, the new value, … */
  detail?: string
}

const titleOf = (state: DomainState, id: string) =>
  state.concepts[id]?.title ?? "a Concept"

function relLabel(state: DomainState, type: string) {
  return (
    state.relTypes[type]?.label ??
    BUILTIN_REL_TYPE_BY_ID.get(type)?.label ??
    "relates to"
  )
}

const FIELD_NAMES: Record<string, string> = {
  title: "title",
  summary: "summary",
  overview: "overview",
  aliases: "aliases",
  kind: "Kind",
  date: "date",
  dateEnd: "end date",
  lat: "location",
  lon: "location",
  weightPin: "weight",
}

/** A field's name in copy: "summary", "price", "tag #japan". */
export function fieldName(state: DomainState, field: string): string {
  if (field.startsWith("attributes.")) {
    const id = field.slice("attributes.".length)
    return state.attributes[id]?.label ?? "an Attribute"
  }
  if (field.startsWith("tag:")) return `tag #${field.slice(4)}`
  if (field === "exists") return "whether it exists"
  return FIELD_NAMES[field] ?? field
}

const words = (md: string) => md.split(/\s+/).filter(Boolean).length

/** One item in plain words. `state` should have the item applied (the preview), so new Concepts have titles. */
export function describeItem(
  state: DomainState,
  item: Pick<ProposalItemView, "ops">
): ItemDescription {
  const ops = item.ops
  const created = ops.find((op) => op.kind === "concept.create")
  if (created && created.kind === "concept.create")
    return {
      kind: "concept",
      label: "New Concept",
      title: created.value.title,
      detail: created.value.summary,
    }
  const sections = ops.filter((op) => op.kind === "section.create")
  if (sections.length && sections.length === ops.length) {
    const conceptId =
      sections[0]!.kind === "section.create" ? sections[0]!.value.conceptId : ""
    const n = sections.reduce(
      (sum, op) =>
        sum + (op.kind === "section.create" ? words(op.value.md) : 0),
      0
    )
    return {
      kind: "article",
      label: "Article",
      title: `for ${titleOf(state, conceptId)}`,
      detail: `${sections.length === 1 ? "1 section" : `${sections.length} sections`} · about ${n.toLocaleString()} words`,
    }
  }
  const rel = ops.find((op) => op.kind === "relationship.add")
  if (rel && ops.every((op) => op.kind.startsWith("relationship."))) {
    const { from, type, to } = parseRelKey(rel.target)
    return {
      kind: "relationship",
      label: "New Relationship",
      title: `${titleOf(state, from)} ${relLabel(state, type)} ${titleOf(state, to)}`,
      detail: rel.kind === "relationship.add" ? rel.value.note : undefined,
    }
  }
  const sets = ops.filter((op) => op.kind === "concept.set")
  if (sets.length && sets.length === ops.length) {
    const target = sets[0]!.target
    const fields = [
      ...new Set(
        sets.map((op) =>
          op.kind === "concept.set" ? fieldName(state, op.path) : ""
        )
      ),
    ]
    const last = sets.at(-1)!
    const value = last.kind === "concept.set" ? last.value : undefined
    return {
      kind: "edit",
      label: "Edit",
      title: `${listWords(fields)} of ${titleOf(state, target)}`,
      detail: typeof value === "string" ? value : undefined,
    }
  }
  return {
    kind: "edit",
    label: "Edit",
    title: ops.length === 1 ? "1 change" : `${ops.length} changes`,
  }
}

function listWords(xs: string[]) {
  if (xs.length <= 1) return capitalize(xs[0] ?? "")
  return capitalize(`${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A stale field's two versions, as text. */
export function staleVersions(
  state: DomainState,
  f: StaleField
): { field: string; now: string; suggested: string } {
  return {
    field: fieldName(state, f.field),
    now: showValue(f.current),
    suggested: showValue(f.proposed),
  }
}

export function showValue(v: unknown): string {
  if (v === null || v === undefined) return "(empty)"
  if (v === "deleted") return "(deleted)"
  if (typeof v === "string") return v
  if (typeof v === "boolean") return v ? "yes" : "no"
  return JSON.stringify(v)
}

/** "2 Concepts and 1 Relationship", for the MCP toast. */
export function itemsPhrase(
  state: DomainState,
  items: readonly Pick<ProposalItemView, "ops">[]
): string {
  const counts = { concept: 0, relationship: 0, article: 0, edit: 0 }
  for (const i of items) counts[describeItem(state, i).kind]++
  const parts = [
    counts.concept &&
      `${counts.concept} ${counts.concept === 1 ? "Concept" : "Concepts"}`,
    counts.relationship &&
      `${counts.relationship} ${counts.relationship === 1 ? "Relationship" : "Relationships"}`,
    counts.article &&
      `${counts.article} ${counts.article === 1 ? "article" : "articles"}`,
    counts.edit && `${counts.edit} ${counts.edit === 1 ? "edit" : "edits"}`,
  ].filter(Boolean) as string[]
  if (parts.length <= 1) return parts[0] ?? "nothing"
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
}

/** "Suggested 3 changes" / "Dismissed 1 suggestion": the review toasts. */
export const suggestionsCount = (n: number) =>
  n === 1 ? "1 suggestion" : `${n} suggestions`

/** Who suggested it, as the tab shows it: "Your ask", "Ana's agent (via MCP)". */
export function proposalBy(p: ProposalView, me: string | null): string {
  const mine = p.author.id === me
  if (p.origin === "mcp")
    return mine ? "Your agent (via MCP)" : `${p.author.name}'s agent (via MCP)`
  return mine ? "Your ask" : `${p.author.name}'s ask`
}
