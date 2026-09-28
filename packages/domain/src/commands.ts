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
 * moves Relationships, Tags and provenance, keeps the loser's title as an
 * alias, points per-View overrides at the survivor, and tombstones the loser.
 * Reading status is per reader: merge it with `higherReadingState`.
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
  if (
    loser.title !== survivor.title &&
    !survivor.aliases.includes(loser.title)
  ) {
    b.emit({
      kind: "concept.set",
      target: survivorId,
      path: "aliases",
      value: [...survivor.aliases, loser.title],
    })
  }
  for (const view of Object.values(state.views)) {
    for (const op of overrideOpsForMerge(view, survivorId, loserId)) b.emit(op)
  }
  b.emit({ kind: "concept.delete", target: loserId })
  return b.ops
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
