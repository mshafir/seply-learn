// Proposals (spec §1.5): pending op batches outside the log. These are the
// pure parts every side shares: the server checks them when a review
// commits, the web uses them to draw the Suggestions tab and the dashed
// preview, and AI asks (WP-4.4) use `proposalBase` when they write items.
//
// - **Base:** an item records the values it expected to replace, per field
//   (`proposalBase`), for entities that existed when it was suggested. New
//   Concepts, sections and Relationships have no base.
// - **Stale** (`staleness`): a based field has changed since ("changed since
//   suggested", with both versions), or something the item needs is gone (a
//   deleted Concept, or one no pending item creates). New Concepts and
//   Relationships go stale only through the second.
// - **Dependencies** (`withDependencies`): accepting an item that needs a
//   Concept another pending item creates (a Relationship to a new Concept, a
//   new Concept's article) includes that item.
// - **Preview** (`previewProposals`): the state with every pending item that
//   applies, and what to draw dashed.
import { applyBody, getPath } from "./apply.ts"
import {
  EXISTS,
  TAG_PREFIX,
  deepEqual,
  fieldKey,
  flattenEntity,
  parseFieldKey,
  type EntityType,
  type FieldRef,
} from "./fields.ts"
import type { OpBody } from "./ops.ts"
import { isLive, parseRelKey, type DomainState } from "./state.ts"

/** Field key (`fieldKey`) → the value the item expected there; null: unset. */
export type ProposalBase = Record<string, unknown>

/** What the pure functions need of an item. */
export type ProposalItemLike = {
  id: string
  ops: readonly OpBody[]
  base?: ProposalBase
}

const ENTITY_OF: Record<string, EntityType> = {
  expedition: "exp",
  concept: "concept",
  section: "section",
  relationship: "rel",
  kind: "kind",
  reltype: "reltype",
  attribute: "attr",
  view: "view",
  source: "source",
}

/** Ops that bring a new entity into being (no base: nothing is replaced). */
const CREATES = new Set<OpBody["kind"]>([
  "concept.create",
  "section.create",
  "relationship.add",
  "view.create",
  "source.add",
])

/** The field an op writes, and the value it writes there (null: unset). */
function opField(op: OpBody): { ref: FieldRef; proposed: unknown } | null {
  if (CREATES.has(op.kind)) return null
  const entity = ENTITY_OF[op.kind.split(".")[0]!]!
  const at = (field: string, proposed: unknown) => ({
    ref: { entity, id: op.target, field },
    proposed,
  })
  switch (op.kind) {
    case "expedition.set":
    case "concept.set":
    case "section.set":
    case "relationship.set":
    case "view.set":
      return at(op.path, op.value ?? null)
    case "expedition.tag.add":
    case "concept.tag.add":
      return at(TAG_PREFIX + op.value, true)
    case "expedition.tag.remove":
    case "concept.tag.remove":
      return at(TAG_PREFIX + op.value, null)
    case "concept.delete":
    case "section.delete":
    case "relationship.remove":
    case "attribute.delete":
    case "view.delete":
      return at(EXISTS, "deleted")
    case "concept.restore":
      return at(EXISTS, "live")
    case "section.move":
    case "view.move":
      return at("orderKey", op.value)
    case "kind.hide":
    case "reltype.hide":
      return at("hidden", op.value || null)
    case "kind.define":
    case "reltype.define":
    case "attribute.define":
      return at("def", op.value)
    case "source.remove":
      return at("def", null)
    default:
      return null
  }
}

/** A field's value in `state`; null when unset or when the entity is missing. */
export function fieldValue(state: DomainState, ref: FieldRef): unknown {
  if (ref.entity === "view" && ref.field.startsWith("settings")) {
    const v = state.views[ref.id]
    if (!v) return null
    const path = ref.field.split(".").slice(1)
    return (path.length ? getPath(v.settings, path) : v.settings) ?? null
  }
  const key = fieldKey(ref.entity, ref.id, ref.field)
  const hit = flattenEntity(state, ref.entity, ref.id).find(([k]) => k === key)
  return hit ? (hit[1] ?? null) : null
}

const exists = (state: DomainState, entity: EntityType, id: string) =>
  flattenEntity(state, entity, id).length > 0

/**
 * The base of an item suggested against `state`: for each field its ops
 * write on an entity that exists, the value there now. Ops that create
 * entities, and fields of entities that don't exist yet, have none.
 */
export function proposalBase(
  state: DomainState,
  ops: readonly OpBody[]
): ProposalBase {
  const base: ProposalBase = {}
  for (const op of ops) {
    const f = opField(op)
    if (!f || !exists(state, f.ref.entity, f.ref.id)) continue
    const key = fieldKey(f.ref.entity, f.ref.id, f.ref.field)
    if (!(key in base)) base[key] = fieldValue(state, f.ref)
  }
  return base
}

// --- what an item creates and needs -------------------------------------

export type ItemRefs = {
  /** Concept ids the item creates (`concept.create`). */
  creates: Set<string>
  /** Article section ids the item creates. */
  createsSections: Set<string>
  /** Concepts the item needs to exist (and the item doesn't create). */
  needs: Set<string>
  /** Article sections the item needs (and doesn't create). */
  needsSections: Set<string>
}

export function itemRefs(item: Pick<ProposalItemLike, "ops">): ItemRefs {
  const creates = new Set<string>()
  const createsSections = new Set<string>()
  const needs = new Set<string>()
  const needsSections = new Set<string>()
  for (const op of item.ops) {
    switch (op.kind) {
      case "concept.create":
        creates.add(op.target)
        break
      case "concept.set":
      case "concept.tag.add":
      case "concept.tag.remove":
      case "concept.delete":
      case "concept.restore":
        needs.add(op.target)
        break
      case "section.create":
        createsSections.add(op.target)
        needs.add(op.value.conceptId)
        break
      case "section.set":
      case "section.move":
      case "section.delete":
        needsSections.add(op.target)
        break
      case "relationship.add":
      case "relationship.set":
      case "relationship.remove": {
        const { from, to } = parseRelKey(op.target)
        needs.add(from)
        needs.add(to)
        break
      }
    }
  }
  for (const id of creates) needs.delete(id)
  for (const id of createsSections) needsSections.delete(id)
  return { creates, createsSections, needs, needsSections }
}

/** Which pending item creates each Concept and section. */
function providers(pool: readonly ProposalItemLike[]) {
  const concepts = new Map<string, string>()
  const sections = new Map<string, string>()
  for (const item of pool) {
    const r = itemRefs(item)
    for (const id of r.creates) if (!concepts.has(id)) concepts.set(id, item.id)
    for (const id of r.createsSections)
      if (!sections.has(id)) sections.set(id, item.id)
  }
  return { concepts, sections }
}

// --- stale ------------------------------------------------------------------

/** A field that changed since the item was suggested: both versions. */
export type StaleField = FieldRef & {
  /** What it held when suggested (null: unset). */
  base: unknown
  /** What it holds now. */
  current: unknown
  /** What the item would write. */
  proposed: unknown
}

export type Staleness = {
  /** Based fields that changed since: accepting overwrites them. */
  changed: StaleField[]
  /** Concepts (or sections) the item needs that are deleted or missing: it can't apply. */
  gone: string[]
}

export const isStale = (s: Staleness) =>
  s.changed.length > 0 || s.gone.length > 0

/**
 * Whether an item is stale against `state`. `pool` is every pending item
 * (an item may need a Concept another one creates; that is not "gone").
 */
export function staleness(
  state: DomainState,
  item: ProposalItemLike,
  pool: readonly ProposalItemLike[] = []
): Staleness {
  const changed: StaleField[] = []
  const proposed = new Map<string, unknown>()
  for (const op of item.ops) {
    const f = opField(op)
    if (f)
      proposed.set(fieldKey(f.ref.entity, f.ref.id, f.ref.field), f.proposed)
  }
  for (const [key, base] of Object.entries(item.base ?? {})) {
    const ref = parseFieldKey(key)
    const current = fieldValue(state, ref)
    if (!deepEqual(current ?? null, base ?? null))
      changed.push({
        ...ref,
        base,
        current,
        proposed: proposed.get(key) ?? null,
      })
  }
  const refs = itemRefs(item)
  const from = providers(pool.filter((p) => p.id !== item.id))
  // Gone: not live, and no pending item creates it (one that does may bring
  // back a Concept an undone accept removed).
  const gone: string[] = []
  for (const id of refs.needs)
    if (!isLive(state.concepts[id]) && !from.concepts.has(id)) gone.push(id)
  for (const id of refs.needsSections)
    if (!isLive(state.sections[id]) && !from.sections.has(id)) gone.push(id)
  return { changed, gone }
}

// --- dependencies -------------------------------------------------------------

/**
 * The items to accept for `selected`: those, plus every pending item that
 * creates a Concept or section they need (and so on). In an order that
 * applies (an item after the items it needs), else pool order.
 * `added` are the ones not selected (shown before confirming).
 */
export function withDependencies(
  state: DomainState,
  pool: readonly ProposalItemLike[],
  selected: Iterable<string>
): { ids: string[]; added: string[] } {
  const byId = new Map(pool.map((i) => [i.id, i]))
  const from = providers(pool)
  const want = new Set<string>()
  const queue = [...selected].filter((id) => byId.has(id))
  const chosen = new Set(queue)
  while (queue.length) {
    const id = queue.pop()!
    if (want.has(id)) continue
    want.add(id)
    const r = itemRefs(byId.get(id)!)
    const deps = [
      ...[...r.needs]
        .filter((c) => !isLive(state.concepts[c]))
        .map((c) => from.concepts.get(c)),
      ...[...r.needsSections]
        .filter((s) => !isLive(state.sections[s]))
        .map((s) => from.sections.get(s)),
    ]
    for (const d of deps) if (d && !want.has(d)) queue.push(d)
  }
  const ids = orderItems(
    state,
    pool.filter((i) => want.has(i.id))
  ).map((i) => i.id)
  return { ids, added: ids.filter((id) => !chosen.has(id)) }
}

/** Items in an order that applies: each after the items it needs. Stable. */
export function orderItems<T extends ProposalItemLike>(
  state: DomainState,
  items: readonly T[]
): T[] {
  const from = providers(items)
  const deps = new Map(
    items.map((i) => {
      const r = itemRefs(i)
      const d = new Set<string>()
      for (const c of r.needs)
        if (!isLive(state.concepts[c]) && from.concepts.has(c))
          d.add(from.concepts.get(c)!)
      for (const s of r.needsSections)
        if (!isLive(state.sections[s]) && from.sections.has(s))
          d.add(from.sections.get(s)!)
      d.delete(i.id)
      return [i.id, d]
    })
  )
  const out: T[] = []
  const placed = new Set<string>()
  const visiting = new Set<string>()
  const byId = new Map(items.map((i) => [i.id, i]))
  const visit = (i: T) => {
    if (placed.has(i.id) || visiting.has(i.id)) return
    visiting.add(i.id)
    for (const d of deps.get(i.id) ?? []) visit(byId.get(d)!)
    visiting.delete(i.id)
    placed.add(i.id)
    out.push(i)
  }
  items.forEach(visit)
  return out
}

// --- preview --------------------------------------------------------------------

export type Suggested = {
  /** Concepts a pending item creates or changes (drawn dashed). */
  concepts: Set<string>
  /** Relationships (`relKey`) a pending item adds. */
  relationships: Set<string>
}

/** What an item would draw dashed: the Concepts and Relationships it touches. */
export function suggestedBy(item: Pick<ProposalItemLike, "ops">): Suggested {
  const concepts = new Set<string>()
  const relationships = new Set<string>()
  for (const op of item.ops) {
    if (op.kind === "section.create") concepts.add(op.value.conceptId)
    else if (op.kind === "relationship.add") relationships.add(op.target)
    else if (op.kind.startsWith("concept.") && op.kind !== "concept.delete")
      concepts.add(op.target)
  }
  return { concepts, relationships }
}

/**
 * The preview overlay: `state` with every item that applies (in an order
 * that applies; one that doesn't is skipped whole, and listed in `skipped`),
 * and what to draw dashed. `at` stamps any tombstones.
 */
export function previewProposals(
  state: DomainState,
  items: readonly ProposalItemLike[],
  at = new Date().toISOString()
): { state: DomainState; suggested: Suggested; skipped: string[] } {
  let next = state
  const skipped: string[] = []
  const suggested: Suggested = { concepts: new Set(), relationships: new Set() }
  for (const item of orderItems(state, items)) {
    try {
      next = item.ops.reduce((s, op) => applyBody(s, op, at), next)
    } catch {
      skipped.push(item.id)
      continue
    }
    const s = suggestedBy(item)
    for (const id of s.concepts) suggested.concepts.add(id)
    for (const k of s.relationships) suggested.relationships.add(k)
  }
  return { state: next, suggested, skipped }
}

/** The proposal's status from its items' (spec §1.5; never "withdrawn" here). */
export function proposalStatusOf(
  statuses: readonly ("pending" | "accepted" | "dismissed" | "stale")[]
): "pending" | "partly" | "accepted" | "rejected" {
  const reviewed = statuses.filter((s) => s === "accepted" || s === "dismissed")
  if (!reviewed.length) return "pending"
  if (reviewed.length < statuses.length) return "partly"
  if (reviewed.every((s) => s === "accepted")) return "accepted"
  if (reviewed.every((s) => s === "dismissed")) return "rejected"
  return "partly"
}

// --- on the wire --------------------------------------------------------------

/** An item's review status as stored. Stale is never stored: see `staleness`. */
export type ItemReviewStatus = "pending" | "accepted" | "dismissed"

/** One item of a Proposal, as the API (and a `data-proposal` part) carries it. */
export type ProposalItemView = {
  id: string
  proposalId: string
  /** Its place in the Proposal. */
  position: number
  ops: OpBody[]
  base: ProposalBase
  status: ItemReviewStatus
  /** The Change that accepted it, if accepted. */
  changeId: string | null
  createdAt: string
}

/**
 * A Proposal: one ask (its rationale) with its items, as the API returns it
 * and as AI asks stream it (`data-proposal` parts, keyed by `id`; a later
 * part replaces an earlier one).
 */
export type ProposalView = {
  id: string
  expeditionId: string
  author: { id: string; name: string; image: string | null }
  origin: "ai" | "mcp"
  rationale: string
  status: "pending" | "partly" | "accepted" | "rejected" | "withdrawn"
  createdAt: string
  items: ProposalItemView[]
}
