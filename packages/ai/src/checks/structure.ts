// Structure checks that don't depend on a View Type: the first half of the
// prototype's `validate.py` (prototypes/seeding/validate.py), plus the
// references a View's settings make.
import {
  BUILTIN_KIND_BY_ID,
  BUILTIN_REL_TYPE_BY_ID,
  isLive,
  OVERRIDE_KEYS,
  VIEW_TYPES,
  type DomainState,
  type View,
} from "@seply/domain"
import {
  isType,
  liveConcepts,
  liveRelationships,
  PART_OF,
  problem,
  quoted,
  titleOf,
  warning,
  type Finding,
} from "./common.ts"

/**
 * Expedition-wide: Relationships with a missing end (problem), and Concepts
 * nothing links to (warning).
 */
export function checkExpedition(s: DomainState): Finding[] {
  const out: Finding[] = []
  const rels = liveRelationships(s)
  for (const r of rels) {
    const gone = [r.from, r.to].filter((id) => !isLive(s.concepts[id]))
    if (gone.length)
      out.push(
        problem(
          "dangling-relationship",
          `Relationship ${r.from} -${r.type}-> ${r.to} points at a missing Concept (${gone.join(", ")})`,
          gone
        )
      )
  }
  const linked = new Set(rels.flatMap((r) => [r.from, r.to]))
  const orphans = liveConcepts(s).filter((c) => !linked.has(c.id))
  if (orphans.length)
    out.push(
      warning(
        "orphan",
        `${orphans.length} Concept(s) have no Relationships: ${quoted(orphans.map((c) => c.title))}`,
        orphans.map((c) => c.id)
      )
    )
  return out
}

/** Concepts with more than one live `part-of` parent, with their parents. */
export function partOfParents(s: DomainState): Map<string, string[]> {
  const parents = new Map<string, string[]>()
  for (const r of liveRelationships(s))
    if (isType(r.type, PART_OF))
      parents.set(r.from, [...(parents.get(r.from) ?? []), r.to])
  return parents
}

/**
 * One `part-of` parent each (spec §5.3), for the Views whose structure is
 * `part-of`: Outline, Anatomy, and the Learning path's topics. A `placement`
 * override settles the parent in that View.
 */
export function checkOneParent(s: DomainState, view: View): Finding[] {
  const st = view.settings as Record<string, unknown>
  const types = (key: string) => (st[key] as string[] | undefined) ?? []
  const readsPartOf =
    view.viewType === "learning-path" ||
    (view.viewType === "outline" &&
      types("relationshipTypes").some((t) => isType(t, PART_OF))) ||
    (view.viewType === "anatomy" &&
      types("containment").some((t) => isType(t, PART_OF)))
  if (!readsPartOf) return []
  const placed = (st.placement as Record<string, string> | undefined) ?? {}
  const out: Finding[] = []
  for (const [id, ps] of partOfParents(s)) {
    if (ps.length < 2 || placed[id] || !isLive(s.concepts[id])) continue
    out.push(
      problem(
        "part-of-parents",
        `'${titleOf(s, id)}' has ${ps.length} part-of parents (${quoted(ps.map((p) => titleOf(s, p)))}); keep one, or set its placement in this View`,
        [id]
      )
    )
  }
  return out
}

/** Settings paths that name an Attribute, per View Type. */
const ATTRIBUTE_REFS: Record<View["viewType"], readonly string[]> = {
  "comparison-table": [
    "columns[].attribute",
    "sortBy",
    "standing",
    "priority",
    "rows.hasAttribute",
  ],
  outline: [],
  evidence: ["evidenceType", "consensus"],
  "cause-and-effect": ["rankBy", "levers.hasAttribute"],
  map: ["colorBy"],
  timeline: [],
  anatomy: ["colorBy"],
  "learning-path": ["targets.hasAttribute"],
  lineage: ["groupBy"],
  quadrant: ["x", "y"],
  rates: ["group", "low", "high", "direction", "method", "independence"],
}

/** The ids at a settings path: `rows.kinds`, `columns[].concept`, `outcomes`. */
export function idsAt(settings: unknown, path: string): string[] {
  let values: unknown[] = [settings]
  for (const seg of path.split(".")) {
    const each = seg.endsWith("[]")
    const key = each ? seg.slice(0, -2) : seg
    values = values.flatMap((v) => {
      const x =
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[key]
          : undefined
      return each && Array.isArray(x) ? x : [x]
    })
  }
  return values.flatMap((v) =>
    typeof v === "string"
      ? [v]
      : Array.isArray(v)
        ? v.filter((x) => typeof x === "string")
        : []
  )
}

/** Every id a View's settings name that doesn't resolve (dangling ids). */
export function checkRefs(s: DomainState, view: View): Finding[] {
  const out: Finding[] = []
  const refs = VIEW_TYPES[view.viewType].refs
  const st = view.settings
  const conceptOk = (id: string) => isLive(s.concepts[id])
  const kindOk = (id: string) => BUILTIN_KIND_BY_ID.has(id) || !!s.kinds[id]
  const relTypeOk = (id: string) =>
    BUILTIN_REL_TYPE_BY_ID.has(id) || !!s.relTypes[id]
  const attrOk = (id: string) => isLive(s.attributes[id])
  const report = (what: string, path: string, ids: string[]) => {
    if (ids.length)
      out.push(
        problem(
          "dangling-ref",
          `settings.${path} names ${what} that don't exist: ${ids.join(", ")}`
        )
      )
  }
  for (const p of refs.concepts)
    report(
      "Concepts",
      p,
      idsAt(st, p).filter((id) => !conceptOk(id))
    )
  for (const p of refs.kinds)
    report(
      "Kinds",
      p,
      idsAt(st, p).filter((id) => !kindOk(id))
    )
  for (const p of refs.relTypes)
    report(
      "Relationship Types",
      p,
      idsAt(st, p).filter((id) => !relTypeOk(id))
    )
  for (const p of ATTRIBUTE_REFS[view.viewType])
    report(
      "Attributes",
      p,
      idsAt(st, p).filter((id) => !attrOk(id))
    )
  for (const key of OVERRIDE_KEYS) {
    const o = st[key]
    if (!o) continue
    const ids = Array.isArray(o)
      ? (o as string[])
      : Object.entries(o as Record<string, string | string[]>).flatMap(
          ([k, v]) => [k, ...(Array.isArray(v) ? v : [v])]
        )
    report(
      "Concepts",
      key,
      [...new Set(ids)].filter((id) => !conceptOk(id))
    )
  }
  return out
}
