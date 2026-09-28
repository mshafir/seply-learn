// Field-level view of state. Every logged value has a field key, so history
// can compare values field by field (undo reverts only fields that still hold
// a Change's value) and turn any wanted set of field values back into ops
// (undo and restore both append ops; the log is never rewound).
import { ApplyError, applyBody } from "./apply.ts"
import { CONCEPT_FIELDS, type OpBody } from "./ops.ts"
import { OVERRIDE_KEYS } from "./view-types.ts"
import {
  isLive,
  parseRelKey,
  type DomainState,
  type Tombstone,
} from "./state.ts"

export type EntityType =
  | "exp"
  | "concept"
  | "section"
  | "rel"
  | "kind"
  | "reltype"
  | "attr"
  | "view"
  | "source"
export type FieldRef = { entity: EntityType; id: string; field: string }
/** Flat state: field key → value. Absent keys mean "unset" (or "doesn't exist"). */
export type FlatState = Map<string, unknown>

export const fieldKey = (entity: EntityType, id: string, field: string) =>
  JSON.stringify([entity, id, field])
export function parseFieldKey(key: string): FieldRef {
  const [entity, id, field] = JSON.parse(key) as [EntityType, string, string]
  return { entity, id, field }
}
const entityKey = (entity: EntityType, id: string) =>
  JSON.stringify([entity, id])

export const EXISTS = "exists"
export const TAG_PREFIX = "tag:"
export const ATTR_PREFIX = "attributes."
export const SETTINGS_PREFIX = "settings."

const existence = (deletedAt: Tombstone) =>
  deletedAt === null ? "live" : "deleted"

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  const ka = Object.keys(a).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined
  )
  const kb = Object.keys(b).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined
  )
  return (
    ka.length === kb.length &&
    ka.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k]
      )
    )
  )
}

const CONCEPT_FIELD_NAMES = Object.keys(
  CONCEPT_FIELDS
) as (keyof typeof CONCEPT_FIELDS)[]

/** The field keys and values of one entity (nothing, if it doesn't exist). */
export function flattenEntity(
  state: DomainState,
  entity: EntityType,
  id: string
): [string, unknown][] {
  const out: [string, unknown][] = []
  const add = (field: string, value: unknown) => {
    if (value !== undefined) out.push([fieldKey(entity, id, field), value])
  }
  switch (entity) {
    case "exp": {
      const e = state.expedition
      add("title", e.title)
      add("summary", e.summary)
      add("status", e.status)
      add("bestViewId", e.bestViewId)
      for (const t of e.tags) add(TAG_PREFIX + t, true)
      break
    }
    case "concept": {
      const c = state.concepts[id]
      if (!c) break
      add(EXISTS, existence(c.deletedAt))
      for (const f of CONCEPT_FIELD_NAMES) add(f, c[f])
      for (const [k, v] of Object.entries(c.attributes)) add(ATTR_PREFIX + k, v)
      for (const t of c.tags) add(TAG_PREFIX + t, true)
      break
    }
    case "section": {
      const s = state.sections[id]
      if (!s) break
      add(EXISTS, existence(s.deletedAt))
      add("conceptId", s.conceptId)
      add("orderKey", s.orderKey)
      add("heading", s.heading)
      add("md", s.md)
      add("prov", s.prov)
      break
    }
    case "rel": {
      const r = state.relationships[id]
      if (!r) break
      add(EXISTS, existence(r.deletedAt))
      add("note", r.note)
      add("prov", r.prov)
      break
    }
    case "kind":
    case "reltype": {
      const d = entity === "kind" ? state.kinds[id] : state.relTypes[id]
      if (!d) break
      const { id: _id, hidden, ...def } = d
      void _id
      if ((def as { label?: string }).label !== undefined) add("def", def)
      if (hidden) add("hidden", true)
      break
    }
    case "attr": {
      const a = state.attributes[id]
      if (!a) break
      const { id: _id, deletedAt, ...def } = a
      void _id
      add(EXISTS, existence(deletedAt))
      add("def", def)
      break
    }
    case "view": {
      const v = state.views[id]
      if (!v) break
      add(EXISTS, existence(v.deletedAt))
      add("viewType", v.viewType)
      add("label", v.label)
      add("question", v.question)
      add("orderKey", v.orderKey)
      add("settingsVersion", v.settingsVersion)
      add("status", v.status)
      add("failReason", v.failReason)
      for (const [k, val] of Object.entries(v.settings)) {
        const isMap =
          (OVERRIDE_KEYS as readonly string[]).includes(k) &&
          val &&
          typeof val === "object" &&
          !Array.isArray(val)
        if (isMap)
          for (const [ek, ev] of Object.entries(val))
            add(`${SETTINGS_PREFIX}${k}.${ek}`, ev)
        else add(SETTINGS_PREFIX + k, val)
      }
      break
    }
    case "source": {
      const s = state.sources[id]
      if (!s) break
      const { id: _id, ...def } = s
      void _id
      add("def", def)
      break
    }
  }
  return out
}

export function entityIds(state: DomainState): [EntityType, string][] {
  const ids: [EntityType, string][] = [["exp", state.expedition.id]]
  for (const id of Object.keys(state.concepts)) ids.push(["concept", id])
  for (const id of Object.keys(state.sections)) ids.push(["section", id])
  for (const id of Object.keys(state.relationships)) ids.push(["rel", id])
  for (const id of Object.keys(state.kinds)) ids.push(["kind", id])
  for (const id of Object.keys(state.relTypes)) ids.push(["reltype", id])
  for (const id of Object.keys(state.attributes)) ids.push(["attr", id])
  for (const id of Object.keys(state.views)) ids.push(["view", id])
  for (const id of Object.keys(state.sources)) ids.push(["source", id])
  return ids
}

export function flattenState(state: DomainState): FlatState {
  const flat: FlatState = new Map()
  for (const [t, id] of entityIds(state))
    for (const [k, v] of flattenEntity(state, t, id)) flat.set(k, v)
  return flat
}

/** Field keys whose values differ between two flat states. */
export function diffKeys(a: FlatState, b: FlatState): Set<string> {
  const keys = new Set<string>()
  for (const [k, v] of a) if (!deepEqual(v, b.get(k))) keys.add(k)
  for (const k of b.keys()) if (!a.has(k)) keys.add(k)
  return keys
}

/** The entities an op can change (its target, plus a Concept's cascade). */
export function affectedEntities(
  state: DomainState,
  op: OpBody
): [EntityType, string][] {
  switch (op.kind) {
    case "expedition.set":
    case "expedition.tag.add":
    case "expedition.tag.remove":
      return [["exp", op.target]]
    case "concept.delete":
    case "concept.restore": {
      const out: [EntityType, string][] = [["concept", op.target]]
      for (const [k, r] of Object.entries(state.relationships)) {
        if (r.from === op.target || r.to === op.target) out.push(["rel", k])
      }
      return out
    }
    default: {
      const prefix = op.kind.split(".")[0]
      const entity = (
        {
          concept: "concept",
          section: "section",
          relationship: "rel",
          kind: "kind",
          reltype: "reltype",
          attribute: "attr",
          view: "view",
          source: "source",
        } as const
      )[prefix as "concept"]
      return [[entity, op.target]]
    }
  }
}

function unflattenSettings(
  fields: Map<string, unknown>
): Record<string, unknown> {
  const settings: Record<string, unknown> = {}
  for (const [f, v] of fields) {
    if (!f.startsWith(SETTINGS_PREFIX)) continue
    const [top, ...rest] = f.slice(SETTINGS_PREFIX.length).split(".")
    if (rest.length === 0) settings[top] = v
    else ((settings[top] ??= {}) as Record<string, unknown>)[rest.join(".")] = v
  }
  return settings
}

/**
 * Ops that bring `state` to the `target` values for the given field keys,
 * and the resulting state. Ops are generated in dependency order (defs,
 * Concepts, sections, Relationships, Views) and applied as they are made.
 */
export function opsToReach(
  state: DomainState,
  target: FlatState,
  keys: Iterable<string>,
  at: string
): { ops: OpBody[]; state: DomainState } {
  const targetByEntity = new Map<string, Map<string, unknown>>()
  for (const [k, v] of target) {
    const { entity, id, field } = parseFieldKey(k)
    const ek = entityKey(entity, id)
    if (!targetByEntity.has(ek)) targetByEntity.set(ek, new Map())
    targetByEntity.get(ek)!.set(field, v)
  }
  const wanted = new Map<
    string,
    { entity: EntityType; id: string; fields: Set<string> }
  >()
  for (const k of keys) {
    const { entity, id, field } = parseFieldKey(k)
    const ek = entityKey(entity, id)
    if (!wanted.has(ek)) wanted.set(ek, { entity, id, fields: new Set() })
    wanted.get(ek)!.fields.add(field)
  }

  let working = state
  const ops: OpBody[] = []
  const emit = (op: OpBody) => {
    working = applyBody(working, op, at)
    ops.push(op)
  }
  const tgt = (entity: EntityType, id: string) =>
    targetByEntity.get(entityKey(entity, id)) ?? new Map<string, unknown>()
  const cur = (entity: EntityType, id: string) =>
    new Map(
      flattenEntity(working, entity, id).map(([k, v]) => [
        parseFieldKey(k).field,
        v,
      ])
    )
  const of = (entity: EntityType) =>
    [...wanted.values()].filter((w) => w.entity === entity)
  const differs = (entity: EntityType, id: string, field: string) =>
    !deepEqual(cur(entity, id).get(field), tgt(entity, id).get(field))
  const wantsLive = (entity: EntityType, id: string) =>
    tgt(entity, id).get(EXISTS) === "live"

  // 1. Expedition fields and tags.
  for (const w of of("exp")) {
    for (const f of w.fields) {
      if (!differs("exp", w.id, f)) continue
      const v = tgt("exp", w.id).get(f)
      if (f.startsWith(TAG_PREFIX)) {
        emit({
          kind: v ? "expedition.tag.add" : "expedition.tag.remove",
          target: w.id,
          value: f.slice(TAG_PREFIX.length),
        })
      } else {
        emit({
          kind: "expedition.set",
          target: w.id,
          path: f,
          value: v ?? (f === "bestViewId" ? null : ""),
        })
      }
    }
  }

  // 2. Sources.
  for (const w of of("source")) {
    if (!differs("source", w.id, "def")) continue
    const def = tgt("source", w.id).get("def")
    if (def === undefined) emit({ kind: "source.remove", target: w.id })
    else emit({ kind: "source.add", target: w.id, value: def as never })
  }

  // 3. Kinds, Relationship Types, Attributes.
  for (const entity of ["kind", "reltype"] as const) {
    for (const w of of(entity)) {
      const def = tgt(entity, w.id).get("def")
      if (
        w.fields.has("def") &&
        def !== undefined &&
        differs(entity, w.id, "def")
      ) {
        emit({
          kind: entity === "kind" ? "kind.define" : "reltype.define",
          target: w.id,
          value: def as never,
        })
      }
      // A definition can't be removed; before it existed means hidden.
      const hide =
        tgt(entity, w.id).get("hidden") === true ||
        (w.fields.has("def") && def === undefined)
      if (
        (w.fields.has("hidden") || w.fields.has("def")) &&
        (cur(entity, w.id).get("hidden") === true) !== hide
      ) {
        emit({
          kind: entity === "kind" ? "kind.hide" : "reltype.hide",
          target: w.id,
          value: hide,
        })
      }
    }
  }
  for (const w of of("attr")) {
    const t = tgt("attr", w.id)
    const live = isLive(working.attributes[w.id])
    if (t.get(EXISTS) === "live") {
      if (!live || differs("attr", w.id, "def"))
        emit({
          kind: "attribute.define",
          target: w.id,
          value: t.get("def") as never,
        })
    } else if (live) {
      emit({ kind: "attribute.delete", target: w.id })
    }
  }

  // 4. Concepts: bring back, then fields, then delete (the delete cascades).
  const concepts = of("concept")
  for (const w of concepts) {
    if (!wantsLive("concept", w.id)) continue
    const c = working.concepts[w.id]
    if (!c) {
      const t = tgt("concept", w.id)
      const value: Record<string, unknown> = {
        attributes: {},
        tags: [] as string[],
      }
      for (const [f, v] of t) {
        if (f === EXISTS) continue
        if (f.startsWith(ATTR_PREFIX))
          (value.attributes as Record<string, unknown>)[
            f.slice(ATTR_PREFIX.length)
          ] = v
        else if (f.startsWith(TAG_PREFIX))
          (value.tags as string[]).push(f.slice(TAG_PREFIX.length))
        else value[f] = v
      }
      emit({ kind: "concept.create", target: w.id, value: value as never })
    } else if (!isLive(c)) {
      emit({ kind: "concept.restore", target: w.id })
    }
  }
  for (const w of concepts) {
    if (!tgt("concept", w.id).has(EXISTS) || !working.concepts[w.id]) continue
    for (const f of w.fields) {
      if (f === EXISTS || !differs("concept", w.id, f)) continue
      const v = tgt("concept", w.id).get(f)
      if (f.startsWith(TAG_PREFIX)) {
        emit({
          kind: v ? "concept.tag.add" : "concept.tag.remove",
          target: w.id,
          value: f.slice(TAG_PREFIX.length),
        })
      } else {
        emit({ kind: "concept.set", target: w.id, path: f, value: v ?? null })
      }
    }
  }
  for (const w of concepts) {
    if (!wantsLive("concept", w.id) && isLive(working.concepts[w.id]))
      emit({ kind: "concept.delete", target: w.id })
  }

  // 5. Article sections.
  for (const w of of("section")) {
    const t = tgt("section", w.id)
    const s = working.sections[w.id]
    if (t.get(EXISTS) !== "live") {
      if (isLive(s)) emit({ kind: "section.delete", target: w.id })
      if (!t.has(EXISTS)) continue
    } else if (!isLive(s)) {
      emit({
        kind: "section.create",
        target: w.id,
        value: {
          conceptId: t.get("conceptId") as string,
          orderKey: t.get("orderKey") as string,
          heading: t.get("heading") as string,
          md: t.get("md") as string,
          prov: t.get("prov") as never,
        },
      })
    }
    for (const f of ["heading", "md", "prov"] as const) {
      if (w.fields.has(f) && differs("section", w.id, f))
        emit({ kind: "section.set", target: w.id, path: f, value: t.get(f) })
    }
    if (w.fields.has("orderKey") && differs("section", w.id, "orderKey")) {
      emit({
        kind: "section.move",
        target: w.id,
        value: t.get("orderKey") as string,
      })
    }
  }

  // 6. Relationships (after Concepts, whose restore may already have brought them back).
  for (const w of of("rel")) {
    const t = tgt("rel", w.id)
    const r = working.relationships[w.id]
    if (t.get(EXISTS) !== "live") {
      if (isLive(r)) emit({ kind: "relationship.remove", target: w.id })
      continue
    }
    if (!isLive(r)) {
      const { from, to } = parseRelKey(w.id)
      if (!isLive(working.concepts[from]) || !isLive(working.concepts[to]))
        continue // an end is gone
      emit({
        kind: "relationship.add",
        target: w.id,
        value: {
          ...(t.has("note") ? { note: t.get("note") as string } : {}),
          prov: t.get("prov") as never,
        },
      })
    }
    if (w.fields.has("note") && differs("rel", w.id, "note")) {
      emit({
        kind: "relationship.set",
        target: w.id,
        path: "note",
        value: t.get("note") ?? null,
      })
    }
    if (w.fields.has("prov") && differs("rel", w.id, "prov")) {
      emit({
        kind: "relationship.set",
        target: w.id,
        path: "prov",
        value: t.get("prov"),
      })
    }
  }

  // 7. Views.
  for (const w of of("view")) {
    const t = tgt("view", w.id)
    const v = working.views[w.id]
    if (t.get(EXISTS) !== "live") {
      if (isLive(v)) emit({ kind: "view.delete", target: w.id })
      if (!t.has(EXISTS)) continue
    } else if (!isLive(v)) {
      emit({
        kind: "view.create",
        target: w.id,
        value: {
          viewType: t.get("viewType") as never,
          label: t.get("label") as string,
          orderKey: t.get("orderKey") as string,
          settings: unflattenSettings(t),
          settingsVersion: t.get("settingsVersion") as number,
          status: t.get("status") as never,
          ...(t.has("question")
            ? { question: t.get("question") as string }
            : {}),
          ...(t.has("failReason")
            ? { failReason: t.get("failReason") as string }
            : {}),
        },
      })
    }
    for (const f of [
      "label",
      "question",
      "status",
      "failReason",
      "settingsVersion",
    ] as const) {
      if (w.fields.has(f) && differs("view", w.id, f))
        emit({
          kind: "view.set",
          target: w.id,
          path: f,
          value: t.get(f) ?? null,
        })
    }
    if (w.fields.has("orderKey") && differs("view", w.id, "orderKey")) {
      emit({
        kind: "view.move",
        target: w.id,
        value: t.get("orderKey") as string,
      })
    }
    const settingsFields = [...w.fields].filter(
      (f) => f.startsWith(SETTINGS_PREFIX) && differs("view", w.id, f)
    )
    const before = { working, n: ops.length }
    try {
      for (const f of settingsFields)
        emit({
          kind: "view.set",
          target: w.id,
          path: f,
          value: t.get(f) ?? null,
        })
    } catch (e) {
      if (!(e instanceof ApplyError)) throw e
      // A path at a time passes through invalid settings: write them whole.
      working = before.working
      ops.length = before.n
      const merged = new Map(cur("view", w.id))
      for (const f of settingsFields) {
        if (t.has(f)) merged.set(f, t.get(f))
        else merged.delete(f)
      }
      emit({
        kind: "view.set",
        target: w.id,
        path: "settings",
        value: unflattenSettings(merged),
      })
    }
  }

  return { ops, state: working }
}
