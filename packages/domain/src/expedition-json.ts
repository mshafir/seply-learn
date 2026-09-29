// Our JSON (spec §1.9): the canonical export of an Expedition's current
// state, and import as a first build. Import validates the file, upgrades it
// by `schemaVersion`, re-mints every entity id with its references remapped,
// and returns the ops of one "Imported from file" Change. Pure: the caller
// reads the file and writes the ops through the op log.
//
// Versions:
//   0  the prototype sample-graph format (no `schemaVersion`; sample.ts)
//   1  this file's `ExpeditionJson`
import { z } from "zod"
import { applyAll, ApplyError } from "./apply.ts"
import {
  BUILTIN_KIND_BY_ID,
  BUILTIN_PREFIX,
  BUILTIN_REL_TYPE_BY_ID,
  isBuiltinId,
} from "./builtins.ts"
import {
  AttributeType,
  AttributeValue,
  DateEnd,
  DateString,
  Id,
  PaletteColor,
  Prov,
  SourceKind,
  ViewStatus,
  WeightPin,
  type Prov as ProvT,
} from "./common.ts"
import type { ChangeMeta } from "./history.ts"
import { makeOps, type Op, type OpBody } from "./ops.ts"
import { keysAfter } from "./order-key.ts"
import { sampleToState } from "./sample.ts"
import { emptyState, isLive, relKey, type DomainState } from "./state.ts"
import { ulidSequence } from "./ulid.ts"
import {
  OVERRIDE_KEYS,
  parseSharedSettings,
  VIEW_TYPES,
  ViewTypeId,
} from "./view-types.ts"

/** The current version of our JSON. */
export const EXPEDITION_JSON_VERSION = 1

export const IMPORT_CHANGE_LABEL = "Imported from file"

// --- the v1 format -----------------------------------------------------------

const Tag = z.string().trim().min(1)

export const JsonKind = z.strictObject({
  /** `builtin:<name>` for a built-in (inlined so another instance can read it). */
  id: Id,
  label: z.string().min(1),
  color: PaletteColor,
  icon: z.string().optional(),
  hidden: z.boolean().optional(),
})
export const JsonRelType = z.strictObject({
  id: Id,
  label: z.string().min(1),
  inverseLabel: z.string().min(1),
  color: PaletteColor,
  dashed: z.boolean().optional(),
  hidden: z.boolean().optional(),
})
export const JsonAttribute = z
  .strictObject({
    id: Id,
    label: z.string().min(1),
    type: AttributeType,
    unit: z.string().optional(),
    enumValues: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (a) => a.type !== "enum" || (a.enumValues && a.enumValues.length > 0),
    { message: "an enum Attribute needs enumValues" }
  )
/** Source metadata. Source files travel separately (not in v1 files yet). */
export const JsonSource = z.strictObject({
  id: Id,
  kind: SourceKind,
  title: z.string().min(1),
  mime: z.string().optional(),
  size: z.number().int().min(0).optional(),
  addedAt: z.iso.datetime().optional(),
})
export const JsonSection = z.strictObject({
  id: Id,
  heading: z.string(),
  md: z.string(),
  prov: Prov.default([]),
})
export const JsonConcept = z.strictObject({
  id: Id,
  title: z.string().min(1),
  kind: Id,
  aliases: z.array(z.string().min(1)).default([]),
  tags: z.array(Tag).default([]),
  summary: z.string().optional(),
  overview: z.string().optional(),
  overviewProv: Prov.default([]),
  attributes: z.record(Id, AttributeValue).default({}),
  date: DateString.optional(),
  dateEnd: DateEnd.optional(),
  dateApprox: z.boolean().optional(),
  lane: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  weightPin: WeightPin.optional(),
  prov: Prov.default([]),
  /** The article, in order. */
  sections: z.array(JsonSection).default([]),
})
export const JsonRelationship = z.strictObject({
  from: Id,
  type: Id,
  to: Id,
  note: z.string().optional(),
  prov: Prov.default([]),
})
export const JsonView = z.strictObject({
  id: Id,
  viewType: ViewTypeId,
  label: z.string().min(1),
  question: z.string().optional(),
  /** Shared settings, including the per-View overrides. */
  settings: z.record(z.string(), z.unknown()),
  settingsVersion: z.number().int().min(1),
  status: ViewStatus.default("ready"),
  failReason: z.string().optional(),
})

const ExpeditionJsonShape = z.strictObject({
  schemaVersion: z.literal(EXPEDITION_JSON_VERSION),
  exportedAt: z.iso.datetime().optional(),
  id: Id,
  title: z.string(),
  summary: z.string().default(""),
  tags: z.array(Tag).default([]),
  bestViewId: Id.nullable().default(null),
  kinds: z.array(JsonKind).default([]),
  relationshipTypes: z.array(JsonRelType).default([]),
  attributes: z.array(JsonAttribute).default([]),
  sources: z.array(JsonSource).default([]),
  /** Live Concepts only (export is current state). */
  concepts: z.array(JsonConcept),
  relationships: z.array(JsonRelationship).default([]),
  /** In rail order. */
  views: z.array(JsonView).default([]),
})

/** An Expedition in our JSON, v1: validated, with internal references checked. */
export const ExpeditionJson = ExpeditionJsonShape.superRefine(checkReferences)
export type ExpeditionJson = z.output<typeof ExpeditionJsonShape>
export type ExpeditionJsonInput = z.input<typeof ExpeditionJsonShape>

function checkReferences(doc: ExpeditionJson, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message })
  const unique = <T>(
    list: readonly T[],
    key: (x: T) => string,
    path: string,
    what: string
  ) => {
    const seen = new Set<string>()
    list.forEach((x, i) => {
      const k = key(x)
      if (seen.has(k)) issue([path, i], `duplicate ${what} ${k}`)
      seen.add(k)
    })
    return seen
  }
  const kinds = unique(doc.kinds, (k) => k.id, "kinds", "Kind id")
  const relTypes = unique(
    doc.relationshipTypes,
    (t) => t.id,
    "relationshipTypes",
    "Relationship Type id"
  )
  unique(doc.attributes, (a) => a.id, "attributes", "Attribute id")
  const attributes = new Map(doc.attributes.map((a) => [a.id, a]))
  unique(doc.sources, (s) => s.id, "sources", "Source id")
  const concepts = unique(doc.concepts, (c) => c.id, "concepts", "Concept id")
  unique(
    doc.relationships,
    (r) => relKey(r.from, r.type, r.to),
    "relationships",
    "Relationship"
  )
  unique(doc.views, (v) => v.id, "views", "View id")
  const sectionIds = new Set<string>()

  const kindKnown = (id: string) => kinds.has(id) || BUILTIN_KIND_BY_ID.has(id)
  const relTypeKnown = (id: string) =>
    relTypes.has(id) || BUILTIN_REL_TYPE_BY_ID.has(id)

  doc.concepts.forEach((c, i) => {
    if (!kindKnown(c.kind))
      issue(["concepts", i, "kind"], `unknown Kind ${c.kind}`)
    for (const [attr, value] of Object.entries(c.attributes)) {
      const def = attributes.get(attr)
      if (!def) {
        issue(["concepts", i, "attributes", attr], `unknown Attribute ${attr}`)
        continue
      }
      const fits =
        def.type === "bool"
          ? typeof value === "boolean"
          : def.type === "number" || def.type === "money"
            ? typeof value === "number"
            : def.type === "enum"
              ? typeof value === "string" &&
                (def.enumValues ?? []).includes(value)
              : typeof value === "string"
      if (!fits)
        issue(
          ["concepts", i, "attributes", attr],
          `${JSON.stringify(value)} does not fit ${def.type} Attribute ${attr}`
        )
    }
    c.sections.forEach((s, j) => {
      if (sectionIds.has(s.id))
        issue(["concepts", i, "sections", j], `duplicate section id ${s.id}`)
      sectionIds.add(s.id)
    })
  })
  doc.relationships.forEach((r, i) => {
    if (!concepts.has(r.from))
      issue(["relationships", i, "from"], `unknown Concept ${r.from}`)
    if (!concepts.has(r.to))
      issue(["relationships", i, "to"], `unknown Concept ${r.to}`)
    if (!relTypeKnown(r.type))
      issue(["relationships", i, "type"], `unknown Relationship Type ${r.type}`)
  })
  doc.views.forEach((v, i) => {
    const current = VIEW_TYPES[v.viewType].version
    if (v.settingsVersion > current)
      issue(
        ["views", i, "settingsVersion"],
        `${v.viewType} settings v${v.settingsVersion} are newer than this server's v${current}`
      )
    const r = parseSharedSettings(v.viewType, v.settings)
    if (!r.success)
      for (const e of r.error.issues)
        issue(["views", i, "settings", ...e.path.map(String)], e.message)
    const refs = VIEW_TYPES[v.viewType].refs
    for (const p of refs.kinds)
      for (const id of readRefs(v.settings, p))
        if (!kindKnown(id))
          issue(["views", i, "settings", p], `unknown Kind ${id}`)
    for (const p of refs.relTypes)
      for (const id of readRefs(v.settings, p))
        if (!relTypeKnown(id))
          issue(["views", i, "settings", p], `unknown Relationship Type ${id}`)
  })
}

// --- settings references -------------------------------------------------------

type Settings = Record<string, unknown>
const isRecord = (x: unknown): x is Settings =>
  !!x && typeof x === "object" && !Array.isArray(x)

/** The ids at a refs path (`a.b`, `columns[].concept`). */
function readRefs(obj: unknown, path: string): string[] {
  const out: string[] = []
  const walk = (cur: unknown, segs: string[]) => {
    if (!segs.length) {
      if (typeof cur === "string") out.push(cur)
      else if (Array.isArray(cur))
        for (const x of cur) if (typeof x === "string") out.push(x)
      return
    }
    const [head, ...rest] = segs
    if (head.endsWith("[]")) {
      const list = isRecord(cur) ? cur[head.slice(0, -2)] : undefined
      if (Array.isArray(list)) for (const x of list) walk(x, rest)
    } else if (isRecord(cur)) walk(cur[head], rest)
  }
  walk(obj, path.split("."))
  return out
}

/**
 * Rewrites the ids at a refs path in place. `fn` returns the new id, or
 * undefined to drop the reference (a single id is removed; a list loses it).
 */
function mapRefs(
  obj: Settings,
  path: string,
  fn: (id: string) => string | undefined
) {
  const walk = (cur: unknown, segs: string[]) => {
    if (!isRecord(cur)) return
    const [head, ...rest] = segs
    if (head.endsWith("[]")) {
      const list = cur[head.slice(0, -2)]
      if (Array.isArray(list)) for (const x of list) walk(x, rest)
      return
    }
    if (rest.length) return walk(cur[head], rest)
    const v = cur[head]
    if (typeof v === "string") {
      const next = fn(v)
      if (next === undefined) delete cur[head]
      else cur[head] = next
    } else if (Array.isArray(v)) {
      cur[head] = v.flatMap((x) => {
        if (typeof x !== "string") return [x]
        const next = fn(x)
        return next === undefined ? [] : [next]
      })
    }
  }
  walk(obj, path.split("."))
}

/** Rewrites every Concept id in the per-View overrides, dropping dangling ones. */
function mapOverrides(
  settings: Settings,
  fn: (id: string) => string | undefined
) {
  const list = (ids: unknown) =>
    Array.isArray(ids)
      ? ids.flatMap((id) => {
          const next = typeof id === "string" ? fn(id) : undefined
          return next === undefined ? [] : [next]
        })
      : []
  const record = <T>(
    rec: unknown,
    value: (v: unknown) => T | undefined
  ): Record<string, T> => {
    const out: Record<string, T> = {}
    if (!isRecord(rec)) return out
    for (const [k, v] of Object.entries(rec)) {
      const key = fn(k)
      const next = value(v)
      if (key !== undefined && next !== undefined) out[key] = next
    }
    return out
  }
  for (const key of OVERRIDE_KEYS) {
    if (settings[key] === undefined) continue
    if (key === "hide") settings.hide = list(settings.hide)
    else if (key === "placement")
      settings.placement = record(settings.placement, (v) =>
        typeof v === "string" ? fn(v) : undefined
      )
    else settings[key] = record(settings[key], list)
  }
}

// --- export ---------------------------------------------------------------------

/** The current state as our JSON (live entities only; no history). */
export function stateToExpeditionJson(
  state: DomainState,
  opts: { exportedAt?: string } = {}
): ExpeditionJson {
  const concepts = Object.values(state.concepts).filter(isLive)
  const relationships = Object.values(state.relationships).filter(isLive)
  const views = Object.values(state.views)
    .filter(isLive)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))
  const attributes = Object.values(state.attributes).filter(isLive)
  const liveAttr = new Set(attributes.map((a) => a.id))

  // Built-ins are inlined when used, referenced by a View, or hidden.
  const usedKinds = new Set(concepts.map((c) => c.kind))
  const usedRelTypes = new Set(relationships.map((r) => r.type))
  for (const v of views) {
    const refs = VIEW_TYPES[v.viewType].refs
    for (const p of refs.kinds)
      for (const id of readRefs(v.settings, p)) usedKinds.add(id)
    for (const p of refs.relTypes)
      for (const id of readRefs(v.settings, p)) usedRelTypes.add(id)
  }
  const kinds: ExpeditionJson["kinds"] = []
  for (const k of BUILTIN_KIND_BY_ID.values()) {
    const hidden = !!state.kinds[k.id]?.hidden
    if (usedKinds.has(k.id) || hidden)
      kinds.push({ ...k, ...(hidden ? { hidden } : {}) })
  }
  for (const k of Object.values(state.kinds)) {
    if (isBuiltinId(k.id) || !k.label || !k.color) continue
    kinds.push({
      id: k.id,
      label: k.label,
      color: k.color,
      ...(k.icon ? { icon: k.icon } : {}),
      ...(k.hidden ? { hidden: true } : {}),
    })
  }
  const relationshipTypes: ExpeditionJson["relationshipTypes"] = []
  for (const t of BUILTIN_REL_TYPE_BY_ID.values()) {
    const hidden = !!state.relTypes[t.id]?.hidden
    if (usedRelTypes.has(t.id) || hidden)
      relationshipTypes.push({ ...t, ...(hidden ? { hidden } : {}) })
  }
  for (const t of Object.values(state.relTypes)) {
    if (isBuiltinId(t.id) || !t.label || !t.color) continue
    relationshipTypes.push({
      id: t.id,
      label: t.label,
      inverseLabel: t.inverseLabel ?? t.label,
      color: t.color,
      ...(t.dashed !== undefined ? { dashed: t.dashed } : {}),
      ...(t.hidden ? { hidden: true } : {}),
    })
  }

  const sectionsOf = new Map<
    string,
    ExpeditionJson["concepts"][number]["sections"]
  >()
  for (const s of Object.values(state.sections)
    .filter(isLive)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))) {
    const list = sectionsOf.get(s.conceptId) ?? []
    list.push({ id: s.id, heading: s.heading, md: s.md, prov: s.prov })
    sectionsOf.set(s.conceptId, list)
  }

  const liveViewIds = new Set(views.map((v) => v.id))
  return {
    schemaVersion: EXPEDITION_JSON_VERSION,
    ...(opts.exportedAt ? { exportedAt: opts.exportedAt } : {}),
    id: state.expedition.id,
    title: state.expedition.title,
    summary: state.expedition.summary,
    tags: [...state.expedition.tags],
    bestViewId:
      state.expedition.bestViewId &&
      liveViewIds.has(state.expedition.bestViewId)
        ? state.expedition.bestViewId
        : null,
    kinds,
    relationshipTypes,
    attributes: attributes.map((a) => ({
      id: a.id,
      label: a.label,
      type: a.type,
      ...(a.unit !== undefined ? { unit: a.unit } : {}),
      ...(a.enumValues ? { enumValues: [...a.enumValues] } : {}),
    })),
    sources: Object.values(state.sources).map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      ...(s.mime !== undefined ? { mime: s.mime } : {}),
      ...(s.size !== undefined ? { size: s.size } : {}),
      addedAt: s.addedAt,
    })),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    concepts: concepts.map(({ deletedAt, attributes: attrs, ...c }) => ({
      ...c,
      aliases: [...c.aliases],
      tags: [...c.tags],
      attributes: Object.fromEntries(
        Object.entries(attrs).filter(([k]) => liveAttr.has(k))
      ),
      sections: sectionsOf.get(c.id) ?? [],
    })),
    relationships: relationships.map((r) => ({
      from: r.from,
      type: r.type,
      to: r.to,
      ...(r.note !== undefined ? { note: r.note } : {}),
      prov: r.prov,
    })),
    views: views.map((v) => ({
      id: v.id,
      viewType: v.viewType,
      label: v.label,
      ...(v.question !== undefined ? { question: v.question } : {}),
      settings: structuredClone(v.settings),
      settingsVersion: v.settingsVersion,
      status: v.status,
      ...(v.failReason !== undefined ? { failReason: v.failReason } : {}),
    })),
  }
}

// --- upgrade and validation ---------------------------------------------------------

/** An import the server refuses: a message and, for invalid files, the issues. */
export class ImportError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[] = []
  ) {
    super(message)
    this.name = "ImportError"
  }
}

/** Placeholder ids used while upgrading; import re-mints them anyway. */
const UPGRADE_EXPEDITION_ID = "upgrade"
const UPGRADE_EPOCH = Date.parse("2026-01-01T00:00:00Z")

/** Upgrades from version n to n + 1. */
const UPGRADES: Record<number, (doc: unknown, at: string) => unknown> = {
  // The prototype sample-graph format: build it through its converter and
  // export the state.
  0: (doc, at) => {
    const id =
      isRecord(doc) &&
      typeof doc.id === "string" &&
      Id.safeParse(doc.id).success
        ? doc.id
        : UPGRADE_EXPEDITION_ID
    const { state } = sampleToState(doc, {
      expeditionId: id,
      actor: "import",
      changeId: "upgrade",
      nextOpId: ulidSequence(UPGRADE_EPOCH),
      at,
    })
    return stateToExpeditionJson(state)
  },
}

function issuesOf(error: z.ZodError) {
  return error.issues.map((i) => ({
    path: i.path.map(String).join("."),
    message: i.message,
  }))
}

/**
 * Validates a file as our JSON, upgrading older versions first. A file with
 * no `schemaVersion` is version 0 (the prototype sample-graph format).
 * Throws ImportError.
 */
export function parseExpeditionJson(
  input: unknown,
  opts: { at?: string } = {}
): ExpeditionJson {
  if (!isRecord(input))
    throw new ImportError("not an Expedition file: expected a JSON object")
  const raw = input.schemaVersion
  const version = raw === undefined ? 0 : raw
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0)
    throw new ImportError(`bad schemaVersion ${JSON.stringify(raw)}`)
  if (version > EXPEDITION_JSON_VERSION)
    throw new ImportError(
      `schemaVersion ${version} is newer than this server's ${EXPEDITION_JSON_VERSION}`
    )
  const at = opts.at ?? new Date().toISOString()
  let doc: unknown = input
  for (let v = version; v < EXPEDITION_JSON_VERSION; v++) {
    try {
      doc = UPGRADES[v](doc, at)
    } catch (e) {
      if (e instanceof z.ZodError)
        throw new ImportError(
          `not a valid version ${v} Expedition file`,
          issuesOf(e)
        )
      if (e instanceof ApplyError)
        throw new ImportError(`could not upgrade version ${v}: ${e.message}`)
      throw e
    }
  }
  const r = ExpeditionJson.safeParse(doc)
  if (!r.success)
    throw new ImportError("not a valid Expedition file", issuesOf(r.error))
  return r.data
}

// --- import -----------------------------------------------------------------------

export type ImportOptions = {
  /** The new Expedition's id. */
  expeditionId: string
  /** The importer: the Change's author and the Sources' `addedBy`. */
  actor: string
  changeId: string
  /** ULID source for op ids. */
  nextOpId: () => string
  /** Mints a fresh entity id (ULIDs in the product). */
  newId: () => string
  /** ISO time the import happened. */
  at: string
}

/** Old id → new id, per entity. Kinds, Relationship Types and Attributes keep theirs. */
export type ImportIdMap = {
  expedition: string
  concepts: Map<string, string>
  sections: Map<string, string>
  views: Map<string, string>
  sources: Map<string, string>
  kinds: Map<string, string>
  relTypes: Map<string, string>
}

/**
 * The op bodies that build an imported file as a first build, with every
 * entity id re-minted. Kinds, Relationship Types and Attributes are
 * Expedition-scoped vocabulary that View settings name, so they keep their
 * ids; a built-in this server doesn't know becomes a custom definition.
 */
export function expeditionJsonToOpBodies(
  doc: ExpeditionJson,
  opts: Pick<ImportOptions, "expeditionId" | "actor" | "newId" | "at">
): { bodies: OpBody[]; ids: ImportIdMap } {
  const exp = opts.expeditionId
  const mint = (list: readonly { id: string }[]) =>
    new Map(list.map((x) => [x.id, opts.newId()]))
  const ids: ImportIdMap = {
    expedition: exp,
    concepts: mint(doc.concepts),
    sections: mint(doc.concepts.flatMap((c) => c.sections)),
    views: mint(doc.views),
    sources: mint(doc.sources),
    kinds: new Map(),
    relTypes: new Map(),
  }
  const ops: OpBody[] = []
  const set = (path: string, value: unknown) =>
    ops.push({ kind: "expedition.set", target: exp, path, value })

  set("title", doc.title)
  set("summary", doc.summary)
  for (const tag of doc.tags)
    ops.push({ kind: "expedition.tag.add", target: exp, value: tag })

  for (const s of doc.sources)
    ops.push({
      kind: "source.add",
      target: ids.sources.get(s.id)!,
      value: {
        kind: s.kind,
        title: s.title,
        ...(s.mime !== undefined ? { mime: s.mime } : {}),
        ...(s.size !== undefined ? { size: s.size } : {}),
        addedBy: opts.actor,
        addedAt: s.addedAt ?? opts.at,
      },
    })

  // Vocabulary: built-ins by reference; custom (and unknown built-ins) defined.
  const taken = new Set([
    ...doc.kinds.map((k) => k.id),
    ...doc.relationshipTypes.map((t) => t.id),
  ])
  const customId = (id: string) => {
    const base = id.slice(BUILTIN_PREFIX.length)
    let out = base
    for (let n = 2; taken.has(out); n++) out = `${base}-${n}`
    taken.add(out)
    return out
  }
  for (const k of doc.kinds) {
    const known = BUILTIN_KIND_BY_ID.has(k.id)
    const id = known ? k.id : isBuiltinId(k.id) ? customId(k.id) : k.id
    ids.kinds.set(k.id, id)
    if (!known)
      ops.push({
        kind: "kind.define",
        target: id,
        value: {
          label: k.label,
          color: k.color,
          ...(k.icon ? { icon: k.icon } : {}),
        },
      })
    if (k.hidden) ops.push({ kind: "kind.hide", target: id, value: true })
  }
  for (const t of doc.relationshipTypes) {
    const known = BUILTIN_REL_TYPE_BY_ID.has(t.id)
    const id = known ? t.id : isBuiltinId(t.id) ? customId(t.id) : t.id
    ids.relTypes.set(t.id, id)
    if (!known)
      ops.push({
        kind: "reltype.define",
        target: id,
        value: {
          label: t.label,
          inverseLabel: t.inverseLabel,
          color: t.color,
          ...(t.dashed !== undefined ? { dashed: t.dashed } : {}),
        },
      })
    if (t.hidden) ops.push({ kind: "reltype.hide", target: id, value: true })
  }
  const kindOf = (id: string) => ids.kinds.get(id) ?? id
  const relTypeOf = (id: string) => ids.relTypes.get(id) ?? id

  for (const a of doc.attributes)
    ops.push({
      kind: "attribute.define",
      target: a.id,
      value: {
        label: a.label,
        type: a.type,
        ...(a.unit !== undefined ? { unit: a.unit } : {}),
        ...(a.enumValues ? { enumValues: a.enumValues } : {}),
      },
    })

  // Provenance names Sources; refs to a Source not in the file are dropped.
  const prov = (p: ProvT): ProvT =>
    p.flatMap((ref) => {
      const source = ids.sources.get(ref.source)
      return source ? [{ ...ref, source }] : []
    })

  for (const c of doc.concepts) {
    const id = ids.concepts.get(c.id)!
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sections, kind, overviewProv, prov: cProv, ...rest } = c
    ops.push({
      kind: "concept.create",
      target: id,
      value: {
        ...rest,
        kind: kindOf(kind),
        overviewProv: prov(overviewProv),
        prov: prov(cProv),
      },
    })
    const keys = keysAfter(null, sections.length)
    sections.forEach((s, i) =>
      ops.push({
        kind: "section.create",
        target: ids.sections.get(s.id)!,
        value: {
          conceptId: id,
          orderKey: keys[i],
          heading: s.heading,
          md: s.md,
          prov: prov(s.prov),
        },
      })
    )
  }

  for (const r of doc.relationships)
    ops.push({
      kind: "relationship.add",
      target: relKey(
        ids.concepts.get(r.from)!,
        relTypeOf(r.type),
        ids.concepts.get(r.to)!
      ),
      value: {
        ...(r.note !== undefined ? { note: r.note } : {}),
        prov: prov(r.prov),
      },
    })

  const conceptOf = (id: string) => ids.concepts.get(id)
  const viewKeys = keysAfter(null, doc.views.length)
  doc.views.forEach((v, i) => {
    const settings = structuredClone(v.settings)
    const refs = VIEW_TYPES[v.viewType].refs
    for (const p of refs.kinds) mapRefs(settings, p, kindOf)
    for (const p of refs.relTypes) mapRefs(settings, p, relTypeOf)
    for (const p of refs.concepts) mapRefs(settings, p, conceptOf)
    mapOverrides(settings, conceptOf)
    // Nothing will finish a build that was under way where it was exported.
    const unfinished = v.status === "queued" || v.status === "building"
    ops.push({
      kind: "view.create",
      target: ids.views.get(v.id)!,
      value: {
        viewType: v.viewType,
        label: v.label,
        ...(v.question !== undefined ? { question: v.question } : {}),
        orderKey: viewKeys[i],
        settings,
        settingsVersion: v.settingsVersion,
        status: unfinished ? "failed" : v.status,
        ...(unfinished
          ? { failReason: "Still building when it was exported" }
          : v.failReason !== undefined
            ? { failReason: v.failReason }
            : {}),
      },
    })
  })

  const best =
    (doc.bestViewId && ids.views.get(doc.bestViewId)) ??
    (doc.views[0] ? ids.views.get(doc.views[0].id)! : null)
  if (best) set("bestViewId", best)
  set("status", "ready")
  return { bodies: ops, ids }
}

export type ImportResult = {
  doc: ExpeditionJson
  ops: Op[]
  change: ChangeMeta
  /** The state the ops build, from an empty Expedition. */
  state: DomainState
  ids: ImportIdMap
}

/**
 * Imports a file (our JSON, any version) as one "Imported from file" Change
 * on an empty Expedition. Throws ImportError when the file is invalid.
 */
export function importExpeditionJson(
  input: unknown,
  opts: ImportOptions
): ImportResult {
  const doc = parseExpeditionJson(input, { at: opts.at })
  const { bodies, ids } = expeditionJsonToOpBodies(doc, opts)
  const ops = makeOps(bodies, opts)
  let state: DomainState
  try {
    state = applyAll(emptyState(opts.expeditionId), ops)
  } catch (e) {
    if (e instanceof ApplyError)
      throw new ImportError(`could not build the Expedition: ${e.message}`)
    throw e
  }
  const change: ChangeMeta = {
    id: opts.changeId,
    expeditionId: opts.expeditionId,
    author: opts.actor,
    origin: "import",
    label: IMPORT_CHANGE_LABEL,
    at: opts.at,
  }
  return { doc, ops, change, state, ids }
}
