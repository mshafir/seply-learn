// The pure `apply(state, op)`: folds one op into an Expedition's state and
// returns a new state (the input is never mutated). Invalid ops throw
// `ApplyError`; validate with `parseOp` first.
//
// Create/define/add on an id that already exists is an upsert that also
// clears its tombstone. That is what re-adding a Relationship does (spec
// §1.3), and it is how undo and restore bring back Sections, Views,
// Attributes and Sources, which have no restore op of their own.
import {
  BUILTIN_KIND_BY_ID,
  BUILTIN_REL_TYPE_BY_ID,
  isBuiltinId,
} from "./builtins.ts"
import type { AttributeValue, Prov } from "./common.ts"
import {
  ATTRIBUTE_PATH_PREFIX,
  SETTINGS_PATH,
  type Op,
  type OpBody,
} from "./ops.ts"
import {
  isLive,
  parseRelKey,
  type AttributeDef,
  type Concept,
  type DomainState,
  type Relationship,
  type View,
} from "./state.ts"
import { ulidTime } from "./ulid.ts"
import { parseSharedSettings } from "./view-types.ts"

export class ApplyError extends Error {
  constructor(
    message: string,
    readonly op?: OpBody
  ) {
    super(message)
    this.name = "ApplyError"
  }
}

/** Applies one op. The tombstone time comes from the op's ULID. */
export function apply(state: DomainState, op: Op): DomainState {
  if (op.expeditionId !== state.expedition.id) {
    throw new ApplyError(
      `op for Expedition ${op.expeditionId} applied to ${state.expedition.id}`,
      op
    )
  }
  return applyBody(state, op, new Date(ulidTime(op.opId)).toISOString())
}

export function applyAll(state: DomainState, ops: readonly Op[]): DomainState {
  return ops.reduce(apply, state)
}

const put = <T>(
  rec: Record<string, T>,
  id: string,
  v: T
): Record<string, T> => ({ ...rec, [id]: v })
const without = <T>(rec: Record<string, T>, id: string): Record<string, T> => {
  const next = { ...rec }
  delete next[id]
  return next
}
const addToSet = (xs: string[], x: string) =>
  xs.includes(x) ? xs : [...xs, x].sort()
const removeFromSet = (xs: string[], x: string) => xs.filter((y) => y !== x)

/** Sets (or, for null/undefined, deletes) an optional field. */
function setField<T extends object>(obj: T, key: string, value: unknown): T {
  const next = { ...obj } as Record<string, unknown>
  if (value === null || value === undefined) delete next[key]
  else next[key] = value
  return next as T
}

export function kindExists(state: DomainState, id: string): boolean {
  return BUILTIN_KIND_BY_ID.has(id) || !!state.kinds[id]?.label
}
export function relTypeExists(state: DomainState, id: string): boolean {
  return BUILTIN_REL_TYPE_BY_ID.has(id) || !!state.relTypes[id]?.label
}

function checkAttributeValue(
  def: AttributeDef | undefined,
  attrId: string,
  value: AttributeValue,
  op: OpBody
) {
  if (!def) throw new ApplyError(`unknown Attribute ${attrId}`, op)
  const ok =
    def.type === "bool"
      ? typeof value === "boolean"
      : def.type === "number" || def.type === "money"
        ? typeof value === "number"
        : def.type === "enum"
          ? typeof value === "string" && (def.enumValues ?? []).includes(value)
          : typeof value === "string"
  if (!ok)
    throw new ApplyError(
      `value ${JSON.stringify(value)} does not fit ${def.type} Attribute ${attrId}`,
      op
    )
}

/** Reads a dotted path inside an object. */
export function getPath(obj: unknown, segments: readonly string[]): unknown {
  let cur: unknown = obj
  for (const s of segments) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur))
      return undefined
    cur = (cur as Record<string, unknown>)[s]
  }
  return cur
}

/** Writes (or, for null/undefined, deletes) a dotted path, copying on the way down. */
export function setPath(
  obj: Record<string, unknown>,
  segments: readonly string[],
  value: unknown
): Record<string, unknown> {
  const [head, ...rest] = segments
  const next = { ...obj }
  if (rest.length === 0) {
    if (value === null || value === undefined) delete next[head]
    else next[head] = value
    return next
  }
  const child = next[head]
  const base =
    child && typeof child === "object" && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {}
  if (value === null || value === undefined) {
    if (child === undefined) return obj
  }
  next[head] = setPath(base, rest, value)
  return next
}

function validateSettings(view: View, op: OpBody) {
  const r = parseSharedSettings(view.viewType, view.settings)
  if (!r.success) {
    throw new ApplyError(
      `invalid ${view.viewType} settings: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      op
    )
  }
}

function conceptTouches(r: Relationship, conceptId: string) {
  return r.from === conceptId || r.to === conceptId
}

/** Applies an op body at a given time. Exposed for inverse-op generation. */
export function applyBody(
  state: DomainState,
  op: OpBody,
  at: string
): DomainState {
  const need = <T>(v: T | undefined, what: string): T => {
    if (v === undefined)
      throw new ApplyError(`${what} ${op.target} not found`, op)
    return v
  }

  switch (op.kind) {
    case "expedition.set":
    case "expedition.tag.add":
    case "expedition.tag.remove": {
      if (op.target !== state.expedition.id)
        throw new ApplyError(`wrong Expedition target ${op.target}`, op)
      const e = state.expedition
      if (op.kind === "expedition.set") {
        return { ...state, expedition: { ...e, [op.path]: op.value } }
      }
      const tags =
        op.kind === "expedition.tag.add"
          ? addToSet(e.tags, op.value)
          : removeFromSet(e.tags, op.value)
      return { ...state, expedition: { ...e, tags } }
    }

    case "concept.create": {
      const v = op.value
      if (!kindExists(state, v.kind))
        throw new ApplyError(`unknown Kind ${v.kind}`, op)
      for (const [k, val] of Object.entries(v.attributes ?? {}))
        checkAttributeValue(state.attributes[k], k, val, op)
      const concept: Concept = {
        ...v,
        id: op.target,
        aliases: v.aliases ?? [],
        tags: [...new Set(v.tags ?? [])].sort(),
        attributes: v.attributes ?? {},
        overviewProv: v.overviewProv ?? [],
        prov: v.prov ?? [],
        deletedAt: null,
      }
      return { ...state, concepts: put(state.concepts, op.target, concept) }
    }
    case "concept.set": {
      const c = need(state.concepts[op.target], "Concept")
      let next: Concept
      if (op.path.startsWith(ATTRIBUTE_PATH_PREFIX)) {
        const attr = op.path.slice(ATTRIBUTE_PATH_PREFIX.length)
        const value = op.value as AttributeValue | null
        if (value !== null)
          checkAttributeValue(state.attributes[attr], attr, value, op)
        next = { ...c, attributes: setField(c.attributes, attr, value) }
      } else {
        if (op.path === "kind" && !kindExists(state, op.value as string)) {
          throw new ApplyError(`unknown Kind ${String(op.value)}`, op)
        }
        next = setField(c, op.path, op.value)
      }
      return { ...state, concepts: put(state.concepts, op.target, next) }
    }
    case "concept.delete": {
      const c = need(state.concepts[op.target], "Concept")
      if (!isLive(c)) return state
      // Cascade: tombstone its live Relationships, marked so restore brings them back.
      let relationships = state.relationships
      for (const [k, r] of Object.entries(state.relationships)) {
        if (isLive(r) && conceptTouches(r, op.target)) {
          relationships = put(relationships, k, {
            ...r,
            deletedAt: at,
            deletedWith: op.target,
          })
        }
      }
      return {
        ...state,
        concepts: put(state.concepts, op.target, { ...c, deletedAt: at }),
        relationships,
      }
    }
    case "concept.restore": {
      const c = need(state.concepts[op.target], "Concept")
      if (isLive(c)) return state
      let next: DomainState = {
        ...state,
        concepts: put(state.concepts, op.target, { ...c, deletedAt: null }),
      }
      let relationships = next.relationships
      for (const [k, r] of Object.entries(state.relationships)) {
        if (r.deletedWith !== op.target) continue
        const other = r.from === op.target ? r.to : r.from
        // The other end is still deleted: hand the Relationship to its cascade instead.
        const restored: Relationship = isLive(next.concepts[other])
          ? setField({ ...r, deletedAt: null }, "deletedWith", undefined)
          : { ...r, deletedWith: other }
        relationships = put(relationships, k, restored)
      }
      next = { ...next, relationships }
      return next
    }
    case "concept.tag.add":
    case "concept.tag.remove": {
      const c = need(state.concepts[op.target], "Concept")
      const tags =
        op.kind === "concept.tag.add"
          ? addToSet(c.tags, op.value)
          : removeFromSet(c.tags, op.value)
      return {
        ...state,
        concepts: put(state.concepts, op.target, { ...c, tags }),
      }
    }

    case "section.create": {
      need(state.concepts[op.value.conceptId], "Concept of section")
      const existing = state.sections[op.target]
      if (existing && existing.conceptId !== op.value.conceptId) {
        throw new ApplyError(
          `section ${op.target} belongs to another Concept`,
          op
        )
      }
      const s = {
        ...op.value,
        id: op.target,
        prov: op.value.prov ?? [],
        deletedAt: null,
      }
      return { ...state, sections: put(state.sections, op.target, s) }
    }
    case "section.set": {
      const s = need(state.sections[op.target], "Section")
      return {
        ...state,
        sections: put(state.sections, op.target, { ...s, [op.path]: op.value }),
      }
    }
    case "section.move": {
      const s = need(state.sections[op.target], "Section")
      return {
        ...state,
        sections: put(state.sections, op.target, { ...s, orderKey: op.value }),
      }
    }
    case "section.delete": {
      const s = need(state.sections[op.target], "Section")
      if (!isLive(s)) return state
      return {
        ...state,
        sections: put(state.sections, op.target, { ...s, deletedAt: at }),
      }
    }

    case "relationship.add": {
      const { from, type, to } = parseRelKey(op.target)
      if (from === to)
        throw new ApplyError(
          "a Relationship cannot point at its own Concept",
          op
        )
      for (const end of [from, to]) {
        if (!isLive(state.concepts[end]))
          throw new ApplyError(`Concept ${end} is missing or deleted`, op)
      }
      if (!relTypeExists(state, type))
        throw new ApplyError(`unknown Relationship Type ${type}`, op)
      const prev = state.relationships[op.target]
      const r: Relationship = {
        from,
        type,
        to,
        ...(op.value.note !== undefined
          ? { note: op.value.note }
          : prev?.note !== undefined
            ? { note: prev.note }
            : {}),
        prov: op.value.prov ?? prev?.prov ?? [],
        deletedAt: null,
      }
      return { ...state, relationships: put(state.relationships, op.target, r) }
    }
    case "relationship.set": {
      const r = need(state.relationships[op.target], "Relationship")
      return {
        ...state,
        relationships: put(
          state.relationships,
          op.target,
          setField(r, op.path, op.value)
        ),
      }
    }
    case "relationship.remove": {
      const r = need(state.relationships[op.target], "Relationship")
      if (!isLive(r)) return state
      return {
        ...state,
        relationships: put(state.relationships, op.target, {
          ...r,
          deletedAt: at,
        }),
      }
    }

    case "kind.define": {
      const hidden = state.kinds[op.target]?.hidden ?? false
      return {
        ...state,
        kinds: put(state.kinds, op.target, {
          id: op.target,
          ...op.value,
          hidden,
        }),
      }
    }
    case "kind.hide": {
      if (!kindExists(state, op.target))
        throw new ApplyError(`unknown Kind ${op.target}`, op)
      const k = state.kinds[op.target] ?? { id: op.target, hidden: false }
      const next = { ...k, hidden: op.value }
      // A built-in that is no longer hidden needs no row.
      const kinds =
        isBuiltinId(op.target) && !op.value
          ? without(state.kinds, op.target)
          : put(state.kinds, op.target, next)
      return { ...state, kinds }
    }
    case "reltype.define": {
      const hidden = state.relTypes[op.target]?.hidden ?? false
      return {
        ...state,
        relTypes: put(state.relTypes, op.target, {
          id: op.target,
          ...op.value,
          hidden,
        }),
      }
    }
    case "reltype.hide": {
      if (!relTypeExists(state, op.target))
        throw new ApplyError(`unknown Relationship Type ${op.target}`, op)
      const t = state.relTypes[op.target] ?? { id: op.target, hidden: false }
      const relTypes =
        isBuiltinId(op.target) && !op.value
          ? without(state.relTypes, op.target)
          : put(state.relTypes, op.target, { ...t, hidden: op.value })
      return { ...state, relTypes }
    }

    case "attribute.define": {
      const prev = state.attributes[op.target]
      if (prev && prev.type !== op.value.type) {
        throw new ApplyError(
          `Attribute ${op.target} is ${prev.type}; types are fixed at creation`,
          op
        )
      }
      const def: AttributeDef = { id: op.target, ...op.value, deletedAt: null }
      return { ...state, attributes: put(state.attributes, op.target, def) }
    }
    case "attribute.delete": {
      // Values stay on Concepts, hidden while the definition is tombstoned.
      const a = need(state.attributes[op.target], "Attribute")
      if (!isLive(a)) return state
      return {
        ...state,
        attributes: put(state.attributes, op.target, { ...a, deletedAt: at }),
      }
    }

    case "view.create": {
      const prev = state.views[op.target]
      if (prev && prev.viewType !== op.value.viewType) {
        throw new ApplyError(`View ${op.target} is a ${prev.viewType} View`, op)
      }
      const v = op.value
      const view: View = {
        ...v,
        id: op.target,
        settingsVersion: v.settingsVersion ?? 1,
        status: v.status ?? "ready",
        deletedAt: null,
      }
      validateSettings(view, op)
      return { ...state, views: put(state.views, op.target, view) }
    }
    case "view.set": {
      const v = need(state.views[op.target], "View")
      let next: View
      if (
        op.path === SETTINGS_PATH ||
        op.path.startsWith(`${SETTINGS_PATH}.`)
      ) {
        const segs = op.path.split(".").slice(1)
        const settings =
          segs.length === 0
            ? ((op.value ?? {}) as Record<string, unknown>)
            : setPath(v.settings, segs, op.value)
        next = { ...v, settings }
        validateSettings(next, op)
      } else {
        next = setField(v, op.path, op.value)
      }
      return { ...state, views: put(state.views, op.target, next) }
    }
    case "view.move": {
      const v = need(state.views[op.target], "View")
      return {
        ...state,
        views: put(state.views, op.target, { ...v, orderKey: op.value }),
      }
    }
    case "view.delete": {
      const v = need(state.views[op.target], "View")
      if (!isLive(v)) return state
      return {
        ...state,
        views: put(state.views, op.target, { ...v, deletedAt: at }),
      }
    }

    case "source.add":
      return {
        ...state,
        sources: put(state.sources, op.target, { id: op.target, ...op.value }),
      }
    case "source.remove":
      need(state.sources[op.target], "Source")
      return { ...state, sources: without(state.sources, op.target) }
  }
}

/** The union of provenance lists, without duplicates. */
export function mergeProv(a: Prov, b: Prov): Prov {
  const seen = new Set(a.map((p) => JSON.stringify(p)))
  return [...a, ...b.filter((p) => !seen.has(JSON.stringify(p)))]
}
