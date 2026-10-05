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

// --- packages: how the Suggestions tab groups items ------------------------------
//
// Items stay one per reviewable unit as stored (spec §1.5). The tab groups
// them, derived from their ops:
//
// - **A Concept package** per suggested new Concept: the item that creates
//   it, with the items that only add to it (its article, edits of it), and
//   nested under it the Relationships that connect it to Concepts in the
//   map. Accepting the package accepts them together, as one Change; each
//   nested Relationship can be left out.
// - **A Relationship between suggested Concepts** (two or more of the
//   Concepts it needs were suggested, by any item that wasn't dismissed) is
//   its own entry. It waits (`waitsFor`) until every one of them is in the
//   map: accepting it alone is refused until then (`waiting`).
// - Anything else (a Relationship between Concepts in the map, an edit of
//   one) is its own entry, as before.
// - **Dismissing** an item that creates a Concept dismisses every item that
//   needs that Concept (`withDependents`).

/** An item as stored, with its review status (undefined: pending). */
export type ProposalItemWithStatus = ProposalItemLike & {
  status?: ItemReviewStatus
}

/** One entry of the Suggestions tab: a Concept package, or one item. */
export type ProposalEntry = {
  /** The entry's first item (a package's: the one that creates its Concept). */
  id: string
  kind: "package" | "item"
  /** The Concepts a package brings into the map. */
  concepts: string[]
  /** Items accepted and dismissed together: a package's Concept, its article and edits; or the one item. */
  items: string[]
  /** A package's Relationships to Concepts in the map. Each can be left out. */
  relationships: string[]
  /**
   * Suggested Concepts this entry needs that aren't in the map yet (another
   * pending package creates them). While any are, it can't be accepted alone.
   */
  waitsFor: string[]
}

const isPending = (i: ProposalItemWithStatus) =>
  i.status === undefined || i.status === "pending"

const isRelationshipItem = (i: Pick<ProposalItemLike, "ops">) =>
  i.ops.length > 0 && i.ops.every((op) => op.kind.startsWith("relationship."))

/**
 * The tab's entries for `items` (every item of the Proposals shown; reviewed
 * ones only tell which Concepts were suggested), in the order of each
 * entry's first pending item.
 */
export function proposalEntries(
  state: DomainState,
  items: readonly ProposalItemWithStatus[]
): ProposalEntry[] {
  const pending = items.filter(isPending)
  const pos = new Map(pending.map((i, n) => [i.id, n]))
  // Concepts a pending item creates (that aren't in the map), and Concepts
  // any item that wasn't dismissed suggested.
  const from = providers(pending)
  const newConcept = (c: string) =>
    !isLive(state.concepts[c]) && from.concepts.has(c)
  const suggested = new Set<string>()
  for (const i of items)
    if (i.status !== "dismissed")
      for (const c of itemRefs(i).creates) suggested.add(c)

  const entries: ProposalEntry[] = []
  const entryOf = new Map<string, ProposalEntry>()
  for (const item of orderItems(state, pending)) {
    const r = itemRefs(item)
    // An item that changes a section another pending item creates joins
    // that item's entry (an article's later edits).
    const section = [...r.needsSections]
      .filter((s) => !isLive(state.sections[s]))
      .map((s) => from.sections.get(s))
      .find((id) => id && id !== item.id && entryOf.has(id))
    if (section) {
      const e = entryOf.get(section)!
      e.items.push(item.id)
      entryOf.set(item.id, e)
      continue
    }
    const waits = [...r.needs].filter(newConcept)
    const creates = [...r.creates].filter((c) => !isLive(state.concepts[c]))
    if (creates.length) {
      const e: ProposalEntry = {
        id: item.id,
        kind: "package",
        concepts: creates,
        items: [item.id],
        relationships: [],
        waitsFor: waits,
      }
      entries.push(e)
      entryOf.set(item.id, e)
      continue
    }
    const among = [...r.needs].filter((c) => suggested.has(c))
    const home =
      among.length === 1 && waits.length === 1
        ? entryOf.get(from.concepts.get(waits[0]!)!)
        : undefined
    if (home && home.kind === "package") {
      if (isRelationshipItem(item)) home.relationships.push(item.id)
      else home.items.push(item.id)
      entryOf.set(item.id, home)
      continue
    }
    const e: ProposalEntry = {
      id: item.id,
      kind: "item",
      concepts: [],
      items: [item.id],
      relationships: [],
      waitsFor: waits,
    }
    entries.push(e)
    entryOf.set(item.id, e)
  }
  const byPos = (a: string, b: string) => pos.get(a)! - pos.get(b)!
  for (const e of entries) e.relationships.sort(byPos)
  return entries.sort((a, b) => byPos(a.id, b.id))
}

/**
 * Of `ids` (items to accept together), those that need a Concept (or
 * section) a pending item creates, isn't in the map, and isn't created by
 * one of `ids`: they can't be accepted yet. Item id → what it waits for.
 */
export function waiting(
  state: DomainState,
  pool: readonly ProposalItemLike[],
  ids: Iterable<string>
): Map<string, string[]> {
  const chosen = new Set(ids)
  const all = providers(pool)
  const mine = providers(pool.filter((i) => chosen.has(i.id)))
  const out = new Map<string, string[]>()
  for (const item of pool) {
    if (!chosen.has(item.id)) continue
    const r = itemRefs(item)
    const w = [
      ...[...r.needs].filter(
        (c) =>
          !isLive(state.concepts[c]) &&
          all.concepts.has(c) &&
          !mine.concepts.has(c)
      ),
      ...[...r.needsSections].filter(
        (s) =>
          !isLive(state.sections[s]) &&
          all.sections.has(s) &&
          !mine.sections.has(s)
      ),
    ]
    if (w.length) out.set(item.id, w)
  }
  return out
}

/**
 * The most of `ids` that can be accepted together, in an order that
 * applies: without the items whose Concepts are gone (`staleness`), and
 * without those that wait for a Concept no item left in creates (and so
 * on). `left` are the ones taken out, in pool order.
 */
export function acceptable(
  state: DomainState,
  pool: readonly ProposalItemLike[],
  ids: Iterable<string>
): { ids: string[]; left: string[] } {
  const asked = new Set(ids)
  const keep = new Set(
    pool
      .filter((i) => asked.has(i.id) && !staleness(state, i, pool).gone.length)
      .map((i) => i.id)
  )
  for (;;) {
    const w = waiting(state, pool, keep)
    if (!w.size) break
    for (const id of w.keys()) keep.delete(id)
  }
  return {
    ids: orderItems(
      state,
      pool.filter((i) => keep.has(i.id))
    ).map((i) => i.id),
    left: pool
      .filter((i) => asked.has(i.id) && !keep.has(i.id))
      .map((i) => i.id),
  }
}

/**
 * `dismissed`, plus every pending item that needs a Concept (or section)
 * only they would have created, and so on: dismissing a Concept dismisses
 * the Relationships, article and edits that depend on it. In pool order.
 */
export function withDependents(
  state: DomainState,
  pool: readonly ProposalItemLike[],
  dismissed: Iterable<string>
): string[] {
  const out = new Set(dismissed)
  for (;;) {
    const gone = providers(pool.filter((i) => out.has(i.id)))
    const left = providers(pool.filter((i) => !out.has(i.id)))
    const more = pool.filter((i) => {
      if (out.has(i.id)) return false
      const r = itemRefs(i)
      return (
        [...r.needs].some(
          (c) =>
            !isLive(state.concepts[c]) &&
            gone.concepts.has(c) &&
            !left.concepts.has(c)
        ) ||
        [...r.needsSections].some(
          (s) =>
            !isLive(state.sections[s]) &&
            gone.sections.has(s) &&
            !left.sections.has(s)
        )
      )
    })
    if (!more.length) break
    for (const i of more) out.add(i.id)
  }
  return pool.filter((i) => out.has(i.id)).map((i) => i.id)
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
