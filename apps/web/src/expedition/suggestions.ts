// What the Suggestions tab says (spec §1.5, §3.8): each ask's pending items
// grouped into entries (`proposalEntries`): a package per suggested new
// Concept, with its Relationships to Concepts already in the Expedition
// nested under it; a Relationship between suggested Concepts on its own,
// waiting until they're in; anything else on its own. Each in plain words
// ("New Concept · KV cache", "KV cache is part of Attention", "Article for
// MLA · 3 sections", "Summary and Tags of the Expedition", "New Attribute ·
// Priority"), whether it is stale ("changed since suggested", with
// both versions), and what accepting a selection does.
// Reader-facing copy says "suggestions"; the code says Proposal.
import {
  BUILTIN_REL_TYPE_BY_ID,
  acceptable,
  isStale,
  parseRelKey,
  proposalEntries,
  staleness,
  type DomainState,
  type OpBody,
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

/** One entry of the tab: a Concept package, or one item on its own. */
export type SuggestionEntry = {
  id: string
  kind: "package" | "item"
  /** Accepted and dismissed together: a package's Concept, its article and edits; or the one item. */
  items: PendingItem[]
  /** A package's Relationships to Concepts in the Expedition; each can be left out. */
  relationships: PendingItem[]
  /** Suggested Concepts (ids) it needs that aren't in the Expedition yet: it can't be accepted until they are. */
  waitsFor: string[]
}

/** A Proposal (one ask) and its pending entries, as the tab groups them. */
export type SuggestionGroup = {
  proposal: ProposalView
  entries: SuggestionEntry[]
  /** Its pending items. */
  count: number
}

/** The pending items of every Proposal as entries, grouped by ask (oldest ask first). */
export function groupPending(
  state: DomainState,
  proposals: readonly ProposalView[]
): SuggestionGroup[] {
  const pool = pendingPool(proposals)
  const pending = new Map(
    proposals.flatMap((proposal) =>
      proposal.items
        .filter((i) => i.status === "pending")
        .map(
          (item) =>
            [
              item.id,
              { item, proposal, staleness: staleness(state, item, pool) },
            ] as const
        )
    )
  )
  const at = (id: string) => pending.get(id)!
  const entries = proposalEntries(
    state,
    proposals.flatMap((p) => p.items)
  ).map((e): SuggestionEntry => ({
    id: e.id,
    kind: e.kind,
    items: e.items.map(at),
    relationships: e.relationships.map(at),
    waitsFor: e.waitsFor,
  }))
  return proposals
    .map((proposal) => {
      const mine = entries.filter((e) => at(e.id).proposal.id === proposal.id)
      return {
        proposal,
        entries: mine,
        count: mine.reduce(
          (n, e) => n + e.items.length + e.relationships.length,
          0
        ),
      }
    })
    .filter((g) => g.entries.length > 0)
}

/** Every pending item, across Proposals. */
export const pendingPool = (proposals: readonly ProposalView[]) =>
  proposals.flatMap((p) => p.items.filter((i) => i.status === "pending"))

export const countPending = (proposals: readonly ProposalView[]) =>
  pendingPool(proposals).length

/** The ids an entry accepts: its items and the Relationships not left out. */
export const entryIds = (e: SuggestionEntry, leftOut?: ReadonlySet<string>) => [
  ...e.items.map((i) => i.item.id),
  ...e.relationships.map((i) => i.item.id).filter((id) => !leftOut?.has(id)),
]

export type AcceptPlan = {
  /** Everything to accept, in the order it applies. */
  ids: string[]
  /** A package's Relationships left out: dismissed in the same action. */
  dismiss: string[]
  /** Items that changed since suggested: accepting overwrites them. */
  stale: string[]
  /** Items left out: something they need is gone, or isn't accepted with them. They stay pending. */
  skipped: string[]
  /** What it accepts, in the tab's terms (for the Accept all dialog). */
  counts: {
    /** New Concepts (packages, with their articles and edits). */
    concepts: number
    /** Their Relationships to Concepts already in the Expedition. */
    relationships: number
    /** Relationships between suggested Concepts. */
    between: number
    /** Everything else (edits, Relationships between Concepts in the Expedition). */
    other: number
  }
  /** Accept all: always confirmed in a dialog. */
  all: boolean
}

/**
 * What accepting `selected` (with `dismiss`, a package's Relationships left
 * out) does: in which order, which items are stale (an explicit overwrite)
 * and which can't be accepted with it (gone, or waiting for a Concept that
 * isn't accepted with it).
 */
export function planAccept(
  state: DomainState,
  proposals: readonly ProposalView[],
  selected: readonly string[],
  opts: { dismiss?: readonly string[]; all?: boolean } = {}
): AcceptPlan {
  const pool = pendingPool(proposals)
  const { ids, left } = acceptable(state, pool, selected)
  const byId = new Map(pool.map((i) => [i.id, i]))
  const taking = new Set(ids)
  const counts = { concepts: 0, relationships: 0, between: 0, other: 0 }
  for (const e of proposalEntries(
    state,
    proposals.flatMap((p) => p.items)
  )) {
    const its = e.items.filter((id) => taking.has(id)).length
    const rels = e.relationships.filter((id) => taking.has(id)).length
    if (e.kind === "package") {
      // Its article and edits go with it.
      if (taking.has(e.id)) counts.concepts += e.concepts.length
      counts.relationships += rels
    } else if (e.waitsFor.length) counts.between += its
    else counts.other += its
  }
  return {
    ids,
    dismiss: [...(opts.dismiss ?? [])],
    stale: ids.filter((id) => isStale(staleness(state, byId.get(id)!, pool))),
    skipped: left,
    counts,
    all: !!opts.all,
  }
}

// --- describing items --------------------------------------------------------

export type ItemKind =
  "concept" | "relationship" | "article" | "attribute" | "edit"

export type ItemDescription = {
  kind: ItemKind
  /** "New Concept", "New Relationship", "Article", "New Attribute", "Attribute", "Edit". */
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
  def: "definition",
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

/** An Attribute's type in copy: "enum: hard < nice", "money, USD". */
function attributeDetail(v: {
  type: string
  unit?: string
  enumValues?: string[]
}): string {
  const type = v.type === "bool" ? "yes/no" : v.type
  if (v.enumValues?.length) return `${type}: ${v.enumValues.join(" < ")}`
  return v.unit ? `${type}, ${v.unit}` : type
}

/** The concept a section op is about: its own for a create, else the section's. */
function sectionConcept(state: DomainState, op: OpBody): string | undefined {
  if (op.kind === "section.create") return op.value.conceptId
  if (op.kind.startsWith("section."))
    return state.sections[op.target]?.conceptId
  return undefined
}

/** One item in plain words. `state` should have the item applied (the preview), so new Concepts have titles. */
export function describeItem(
  state: DomainState,
  item: Pick<ProposalItemView, "ops"> & { base?: ProposalItemView["base"] }
): ItemDescription {
  const ops = item.ops
  if (ops.length && ops.every((op) => op.kind.startsWith("expedition."))) {
    const fields: string[] = []
    const added: string[] = []
    const removed: string[] = []
    let summary: string | undefined
    for (const op of ops) {
      if (op.kind === "expedition.set") {
        fields.push(op.path === "title" ? "title" : op.path)
        if (op.path === "summary") summary = String(op.value ?? "")
      } else if (op.kind === "expedition.tag.add") added.push(`#${op.value}`)
      else if (op.kind === "expedition.tag.remove") removed.push(`#${op.value}`)
    }
    if (added.length || removed.length) fields.push("Tags")
    const tagLine = [
      added.length ? `add ${added.join(" ")}` : "",
      removed.length ? `remove ${removed.join(" ")}` : "",
    ]
      .filter(Boolean)
      .join(", ")
    return {
      kind: "edit",
      label: "Edit",
      title: `${listWords([...new Set(fields)])} of the Expedition`,
      detail:
        summary !== undefined
          ? [summary || "(no summary)", tagLine].filter(Boolean).join(" · ")
          : tagLine || undefined,
    }
  }
  const defined = ops.find((op) => op.kind === "attribute.define")
  if (defined && defined.kind === "attribute.define" && ops.length === 1) {
    const existed = Object.keys(item.base ?? {}).length > 0
    return {
      kind: "attribute",
      label: existed ? "Attribute" : "New Attribute",
      title: defined.value.label,
      detail: attributeDetail(defined.value),
    }
  }
  const created = ops.find((op) => op.kind === "concept.create")
  if (created && created.kind === "concept.create")
    return {
      kind: "concept",
      label: "New Concept",
      title: created.value.title,
      detail: created.value.summary,
    }
  const sections = ops.filter((op) => op.kind === "section.create")
  const deleted = ops.filter((op) => op.kind === "section.delete")
  if (deleted.length && deleted.length === ops.length) {
    const conceptId = sectionConcept(state, deleted[0]!) ?? ""
    return {
      kind: "article",
      label: "Article",
      title: `Remove the article of ${titleOf(state, conceptId)}`,
    }
  }
  if (sections.length && sections.length + deleted.length === ops.length) {
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
      detail: `${deleted.length ? "replaces it · " : ""}${sections.length === 1 ? "1 section" : `${sections.length} sections`} · about ${n.toLocaleString()} words`,
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
  // An existing Concept's edits: fields, Tags and its article together.
  const conceptOf = (op: OpBody) =>
    op.kind === "concept.set" ||
    op.kind === "concept.tag.add" ||
    op.kind === "concept.tag.remove"
      ? op.target
      : sectionConcept(state, op)
  const target = ops.length ? conceptOf(ops[0]!) : undefined
  if (target && ops.every((op) => conceptOf(op) === target)) {
    const fields = [
      ...new Set(
        ops.map((op) =>
          op.kind === "concept.set"
            ? fieldName(state, op.path)
            : op.kind.startsWith("concept.tag.")
              ? "Tags"
              : "article"
        )
      ),
    ]
    const last = sets.at(-1)
    const value = last?.kind === "concept.set" ? last.value : undefined
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

/** Why an entry can't be accepted yet: "Accept NF4 and QLoRA first". It may wait for suggested Concepts or Attributes. `state` should be the preview, so they have names. */
export function waitsForPhrase(
  state: DomainState,
  conceptIds: readonly string[]
): string {
  const names = conceptIds.map(
    (id) =>
      state.concepts[id]?.title ??
      (state.attributes[id]
        ? `the ${state.attributes[id].label} Attribute`
        : titleOf(state, id))
  )
  const list =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
  return `Accept ${list} first`
}

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
  const counts = {
    concept: 0,
    relationship: 0,
    article: 0,
    attribute: 0,
    edit: 0,
  }
  for (const i of items) counts[describeItem(state, i).kind]++
  const parts = [
    counts.concept &&
      `${counts.concept} ${counts.concept === 1 ? "Concept" : "Concepts"}`,
    counts.relationship &&
      `${counts.relationship} ${counts.relationship === 1 ? "Relationship" : "Relationships"}`,
    counts.article &&
      `${counts.article} ${counts.article === 1 ? "article" : "articles"}`,
    counts.attribute &&
      `${counts.attribute} ${counts.attribute === 1 ? "Attribute" : "Attributes"}`,
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
