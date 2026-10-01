// Multi-op commands. Each returns the op bodies of one Change: Merge,
// removing a Kind or Relationship Type in use, plus the read helpers that
// apply the Merge and delete rules to View overrides.
import { ApplyError, applyBody, mergeProv } from "./apply.ts"
import type { AttributeValue, ReadingState } from "./common.ts"
import type { OpBody } from "./ops.ts"
import {
  isLive,
  relKey,
  type Concept,
  type DomainState,
  type View,
} from "./state.ts"
import type { ViewOverrides } from "./view-types.ts"

const NO_TIME = new Date(0).toISOString()

function builder(state: DomainState) {
  let working = state
  const ops: OpBody[] = []
  return {
    get state() {
      return working
    },
    ops,
    emit(op: OpBody) {
      working = applyBody(working, op, NO_TIME)
      ops.push(op)
    },
  }
}

/** Moves a Relationship to new ends, folding into an existing one if there is one. */
function moveRelationship(
  b: ReturnType<typeof builder>,
  key: string,
  from: string,
  to: string,
  type: string
) {
  const r = b.state.relationships[key]
  b.emit({ kind: "relationship.remove", target: key })
  if (from === to) return // it would point at its own Concept
  const nk = relKey(from, type, to)
  const existing = b.state.relationships[nk]
  if (isLive(existing)) {
    const prov = mergeProv(existing.prov, r.prov)
    if (prov.length !== existing.prov.length)
      b.emit({
        kind: "relationship.set",
        target: nk,
        path: "prov",
        value: prov,
      })
    if (existing.note === undefined && r.note !== undefined) {
      b.emit({
        kind: "relationship.set",
        target: nk,
        path: "note",
        value: r.note,
      })
    }
  } else {
    b.emit({
      kind: "relationship.add",
      target: nk,
      value: {
        ...(r.note !== undefined ? { note: r.note } : {}),
        prov: r.prov,
      },
    })
  }
}

const uniq = (xs: string[]) => [...new Set(xs)]

/** The `view.set` ops that point a View's overrides at the survivor instead of the loser. */
export function overrideOpsForMerge(
  view: View,
  survivor: string,
  loser: string
): OpBody[] {
  const ops: OpBody[] = []
  const set = (path: string, value: unknown) =>
    ops.push({
      kind: "view.set",
      target: view.id,
      path: `settings.${path}`,
      value,
    })
  const sub = (id: string) => (id === loser ? survivor : id)
  const s = view.settings as ViewOverrides

  if (s.placement) {
    const p = s.placement
    for (const [k, parent] of Object.entries(p)) {
      if (k === loser) {
        set(`placement.${loser}`, null)
        if (p[survivor] === undefined && sub(parent) !== survivor)
          set(`placement.${survivor}`, sub(parent))
      } else if (parent === loser) {
        set(`placement.${k}`, k === survivor ? null : survivor)
      }
    }
  }
  for (const key of ["order", "fold"] as const) {
    const m = s[key]
    if (!m) continue
    for (const [k, list] of Object.entries(m)) {
      if (k === loser) continue
      const next = uniq(list.map(sub)).filter(
        (id) => key !== "fold" || id !== k
      )
      if (k === survivor && m[loser])
        next.push(
          ...uniq(m[loser].map(sub)).filter(
            (id) => !next.includes(id) && id !== k
          )
        )
      if (!deepEqualList(next, list)) set(`${key}.${k}`, next)
    }
    if (m[loser]) {
      set(`${key}.${loser}`, null)
      if (!m[survivor])
        set(
          `${key}.${survivor}`,
          uniq(m[loser].map(sub)).filter((id) => id !== survivor)
        )
    }
  }
  if (s.hide?.includes(loser)) set("hide", uniq(s.hide.map(sub)))
  return ops
}
const deepEqualList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Merge `loser` into `survivor` (spec §1.3), as the ops of one Change:
 * moves Relationships, Tags and provenance, keeps the loser's title (and its
 * aliases) as aliases, points per-View overrides at the survivor, and
 * tombstones the loser. The survivor's `aliases` op comes just before the
 * loser's `concept.delete` (see `mergedPairs`). Reading status is per reader:
 * merge it with `higherReadingState`.
 */
export function mergeConcepts(
  state: DomainState,
  survivorId: string,
  loserId: string
): OpBody[] {
  const survivor = state.concepts[survivorId]
  const loser = state.concepts[loserId]
  if (survivorId === loserId)
    throw new ApplyError("cannot merge a Concept into itself")
  if (!isLive(survivor) || !isLive(loser))
    throw new ApplyError("both Concepts must exist and be live")

  const b = builder(state)
  for (const [key, r] of Object.entries(state.relationships)) {
    if (!isLive(r) || (r.from !== loserId && r.to !== loserId)) continue
    const from = r.from === loserId ? survivorId : r.from
    const to = r.to === loserId ? survivorId : r.to
    moveRelationship(b, key, from, to, r.type)
  }
  for (const tag of loser.tags) {
    if (!survivor.tags.includes(tag))
      b.emit({ kind: "concept.tag.add", target: survivorId, value: tag })
  }
  const prov = mergeProv(survivor.prov, loser.prov)
  if (prov.length !== survivor.prov.length)
    b.emit({
      kind: "concept.set",
      target: survivorId,
      path: "prov",
      value: prov,
    })
  // The loser's title and aliases become the survivor's aliases. Always
  // emitted, even when nothing is added: it marks the survivor in the log
  // (`mergedPairs`), so the server can carry Reading status over.
  b.emit({
    kind: "concept.set",
    target: survivorId,
    path: "aliases",
    value: uniq([...survivor.aliases, loser.title, ...loser.aliases]).filter(
      (a) => a !== survivor.title
    ),
  })
  for (const view of Object.values(state.views)) {
    for (const op of overrideOpsForMerge(view, survivorId, loserId)) b.emit(op)
  }
  b.emit({ kind: "concept.delete", target: loserId })
  return b.ops
}

/**
 * The Merges in a merge Change's ops (origin `merge`): each `concept.delete`
 * paired with the survivor whose `aliases` op precedes it.
 */
export function mergedPairs(
  ops: readonly { kind: string; target: string; path?: string | null }[]
): { survivor: string; loser: string }[] {
  const pairs: { survivor: string; loser: string }[] = []
  let survivor: string | undefined
  for (const op of ops) {
    if (op.kind === "concept.set" && op.path === "aliases") survivor = op.target
    else if (op.kind === "concept.delete" && survivor) {
      if (survivor !== op.target) pairs.push({ survivor, loser: op.target })
      survivor = undefined
    }
  }
  return pairs
}

const READING_RANK: Record<ReadingState, number> = {
  unread: 0,
  read: 1,
  known: 2,
}
/** After a Merge the survivor takes the higher Reading status (known > read > unread). */
export function higherReadingState(
  a: ReadingState | undefined,
  b: ReadingState | undefined
): ReadingState {
  return READING_RANK[a ?? "unread"] >= READING_RANK[b ?? "unread"]
    ? (a ?? "unread")
    : (b ?? "unread")
}

export type RemoveOptions = { reassignTo: string } | { deleteMembers: true }

/** Removes (hides) a Kind, first reassigning or deleting the Concepts of that Kind, in one Change. */
export function removeKind(
  state: DomainState,
  kindId: string,
  opts: RemoveOptions
): OpBody[] {
  const b = builder(state)
  for (const c of Object.values(state.concepts)) {
    if (!isLive(c) || c.kind !== kindId) continue
    if ("reassignTo" in opts)
      b.emit({
        kind: "concept.set",
        target: c.id,
        path: "kind",
        value: opts.reassignTo,
      })
    else b.emit({ kind: "concept.delete", target: c.id })
  }
  b.emit({ kind: "kind.hide", target: kindId, value: true })
  return b.ops
}

/** Removes (hides) a Relationship Type, first reassigning or removing its Relationships, in one Change. */
export function removeRelType(
  state: DomainState,
  typeId: string,
  opts: RemoveOptions
): OpBody[] {
  const b = builder(state)
  for (const [key, r] of Object.entries(state.relationships)) {
    if (!isLive(r) || r.type !== typeId) continue
    if ("reassignTo" in opts)
      moveRelationship(b, key, r.from, r.to, opts.reassignTo)
    else b.emit({ kind: "relationship.remove", target: key })
  }
  b.emit({ kind: "reltype.hide", target: typeId, value: true })
  return b.ops
}

/**
 * A View's overrides as they apply now: entries that point at a deleted
 * Concept are ignored while it is deleted (and come back when it's restored).
 */
export function effectiveOverrides(
  state: DomainState,
  view: View
): Required<ViewOverrides> {
  const live = (id: string) => isLive(state.concepts[id])
  const s = view.settings as ViewOverrides
  const mapLists = (m: Record<string, string[]> | undefined) =>
    Object.fromEntries(
      Object.entries(m ?? {})
        .filter(([k]) => live(k))
        .map(([k, ids]) => [k, ids.filter(live)])
    )
  return {
    placement: Object.fromEntries(
      Object.entries(s.placement ?? {}).filter(([k, p]) => live(k) && live(p))
    ),
    order: mapLists(s.order),
    hide: (s.hide ?? []).filter(live),
    fold: mapLists(s.fold),
  }
}

/** A Concept's Attribute values, without those whose definition is deleted. */
export function liveAttributes(
  state: DomainState,
  concept: Concept
): Record<string, AttributeValue> {
  return Object.fromEntries(
    Object.entries(concept.attributes).filter(([k]) =>
      isLive(state.attributes[k])
    )
  )
}

/**
 * Removes (tombstones) an Attribute, first copying its values to another
 * Attribute of the same type where a Concept has none there yet, in one
 * Change. With `deleteMembers` the values just stay hidden with the
 * definition (undo brings them back).
 */
export function removeAttribute(
  state: DomainState,
  attrId: string,
  opts: RemoveOptions
): OpBody[] {
  const def = state.attributes[attrId]
  if (!isLive(def)) throw new ApplyError(`unknown Attribute ${attrId}`)
  const b = builder(state)
  if ("reassignTo" in opts) {
    const to = state.attributes[opts.reassignTo]
    if (opts.reassignTo === attrId || !isLive(to))
      throw new ApplyError(`unknown Attribute ${opts.reassignTo}`)
    if (to.type !== def.type)
      throw new ApplyError(
        `${def.label} is ${def.type} and ${to.label} is ${to.type}: Attribute types are fixed`
      )
    for (const c of Object.values(state.concepts)) {
      const value = c.attributes[attrId]
      if (!isLive(c) || value === undefined) continue
      if (c.attributes[opts.reassignTo] !== undefined) continue
      b.emit({
        kind: "concept.set",
        target: c.id,
        path: `attributes.${opts.reassignTo}`,
        value,
      })
    }
  }
  b.emit({ kind: "attribute.delete", target: attrId })
  return b.ops
}

// --- Per-View structure (spec §1.6) ----------------------------------------

/**
 * The Relationship Types a View's structure follows, read child → parent:
 * the Outline's `relationshipTypes`, the Anatomy's `containment`. Other View
 * Types have no structure to re-parent in.
 */
export function structureTypes(view: View): string[] {
  const s = view.settings as {
    relationshipTypes?: string[]
    containment?: string[]
  }
  if (view.viewType === "outline") return s.relationshipTypes ?? []
  if (view.viewType === "anatomy") return s.containment ?? []
  return []
}

/** A Concept's shared parent: its first live structure Relationship. */
function sharedParent(
  state: DomainState,
  types: readonly string[],
  conceptId: string
): string | undefined {
  for (const r of Object.values(state.relationships))
    if (
      isLive(r) &&
      r.from === conceptId &&
      r.to !== conceptId &&
      types.includes(r.type)
    )
      return r.to
  return undefined
}

/**
 * The parent a View shows a Concept under: its `placement` override, else
 * the shared structure Relationship (spec §1.6). Ignores hide and folds.
 */
export function parentInView(
  state: DomainState,
  view: View,
  conceptId: string
): string | undefined {
  const placed = effectiveOverrides(state, view).placement[conceptId]
  if (placed && placed !== conceptId) return placed
  return sharedParent(state, structureTypes(view), conceptId)
}

/** Whether `ancestor` is `id` or above it, following `parentOf`. */
function isAncestor(
  parentOf: (id: string) => string | undefined,
  ancestor: string,
  id: string
) {
  const seen = new Set<string>()
  for (let p: string | undefined = id; p && !seen.has(p); p = parentOf(p)) {
    if (p === ancestor) return true
    seen.add(p)
  }
  return false
}

/** "Just this View" (a `placement` override) or "Everywhere" (the shared Relationship). */
export type ReparentScope = "view" | "everywhere"

/**
 * Re-parents a Concept (spec §1.6), as the ops of one Change.
 * - `view`: this View's `placement` override; cleared when the new parent
 *   is the shared one anyway. Other Views are untouched.
 * - `everywhere`: the shared structure Relationship: the Concept's live
 *   Relationships of the View's structure types are removed and one of the
 *   first type added to the new parent (keeping a moved one's note and
 *   provenance); this View's own `placement` for it is cleared. Other Views'
 *   `placement` overrides are their curators' choice and stay.
 * Refuses a parent inside the Concept (a cycle), and Views without structure.
 */
export function reparent(
  state: DomainState,
  viewId: string,
  conceptId: string,
  parentId: string,
  scope: ReparentScope
): OpBody[] {
  const view = state.views[viewId]
  if (!isLive(view)) throw new ApplyError(`unknown View ${viewId}`)
  const types = structureTypes(view)
  if (!types.length)
    throw new ApplyError(`${view.label} has no structure to re-parent in`)
  if (!isLive(state.concepts[conceptId]) || !isLive(state.concepts[parentId]))
    throw new ApplyError("both Concepts must exist and be live")
  if (
    isAncestor((id) => parentInView(state, view, id), conceptId, parentId) ||
    (scope === "everywhere" &&
      isAncestor((id) => sharedParent(state, types, id), conceptId, parentId))
  )
    throw new ApplyError("a Concept can't go inside itself")

  const b = builder(state)
  const placement = (view.settings as ViewOverrides).placement ?? {}
  const clearPlacement = () => {
    if (placement[conceptId] !== undefined)
      b.emit({
        kind: "view.set",
        target: viewId,
        path: `settings.placement.${conceptId}`,
        value: null,
      })
  }
  if (scope === "view") {
    if (sharedParent(state, types, conceptId) === parentId) clearPlacement()
    else if (placement[conceptId] !== parentId)
      b.emit({
        kind: "view.set",
        target: viewId,
        path: `settings.placement.${conceptId}`,
        value: parentId,
      })
    return b.ops
  }

  const keep = relKey(conceptId, types[0]!, parentId)
  let moved: { note?: string; prov: Concept["prov"] } | undefined
  for (const [key, r] of Object.entries(state.relationships)) {
    if (!isLive(r) || r.from !== conceptId || !types.includes(r.type)) continue
    if (key === keep) continue
    moved ??= { note: r.note, prov: r.prov }
    b.emit({ kind: "relationship.remove", target: key })
  }
  if (!isLive(state.relationships[keep]))
    b.emit({
      kind: "relationship.add",
      target: keep,
      value: {
        ...(moved?.note !== undefined ? { note: moved.note } : {}),
        prov: moved?.prov ?? [],
      },
    })
  clearPlacement()
  return b.ops
}

/** Hides a Concept from one View, or shows it again (`settings.hide`). */
export function hideInView(
  view: View,
  conceptId: string,
  hidden: boolean
): OpBody[] {
  const now = (view.settings as ViewOverrides).hide ?? []
  if (now.includes(conceptId) === hidden) return []
  return [
    {
      kind: "view.set",
      target: view.id,
      path: "settings.hide",
      value: hidden
        ? [...now, conceptId]
        : now.filter((id) => id !== conceptId),
    },
  ]
}

/**
 * Moves a Concept among its siblings in one View (`settings.order`):
 * `siblings` is the order the View draws now; the Concept goes to `index`.
 */
export function orderInView(
  view: View,
  parentId: string,
  siblings: readonly string[],
  conceptId: string,
  index: number
): OpBody[] {
  const rest = siblings.filter((id) => id !== conceptId)
  const at = Math.max(0, Math.min(index, rest.length))
  const next = [...rest.slice(0, at), conceptId, ...rest.slice(at)]
  const now = (view.settings as ViewOverrides).order?.[parentId]
  if (now && deepEqualList(now, next)) return []
  return [
    {
      kind: "view.set",
      target: view.id,
      path: `settings.order.${parentId}`,
      value: next,
    },
  ]
}
