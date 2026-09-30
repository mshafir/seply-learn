// The View panel's settings forms, generated from a View Type's Zod schemas
// (spec §4.2): shared settings and personal settings each have one schema in
// @seply/domain, and this walks it into a list of fields. The schema is the
// only source; nothing here is written per View Type except display labels.
//
// - booleans → a switch; enums → a select; numbers and strings → an input
// - lists of ids that the View Type's `refs` name (Relationship Types, Kinds,
//   Concepts) → a checkbox list; a single id they name → a select
// - lists of plain strings (tags) → comma-separated text
// - objects (filters) → a group of the fields above
// - anything else (column lists, lanes, date ranges) → JSON, still checked
//   against the schema before it is written
// - the per-View structure overrides (`placement`, `order`, `hide`, `fold`)
//   are left out: they are edited on the canvas, not in a form.
import { OVERRIDE_KEYS, type SettingsRefs } from "@seply/domain"

export type RefKind = "relTypes" | "kinds" | "concepts"

export type FieldControl =
  | { type: "boolean" }
  | { type: "number"; integer: boolean; min?: number }
  | { type: "text" }
  | { type: "enum"; options: string[] }
  | { type: "ref"; ref: RefKind }
  | { type: "refs"; ref: RefKind }
  | { type: "tags" }
  | { type: "group"; fields: SettingsField[] }
  | { type: "json" }

export type SettingsField = {
  /** Path inside the settings object. */
  path: string[]
  label: string
  optional: boolean
  /** The schema's default (personal settings), if any. */
  defaultValue?: unknown
  control: FieldControl
}

/** The parts of a Zod 4 schema this reads (`schema._zod.def`). */
type Def = {
  type: string
  innerType?: ZodLike
  defaultValue?: unknown
  shape?: Record<string, ZodLike>
  element?: ZodLike
  entries?: Record<string, string>
  checks?: ZodLike[]
  format?: string | null
  check?: string
  value?: number
  inclusive?: boolean
}
type ZodLike = { _zod: { def: Def } }

const defOf = (s: unknown): Def => (s as ZodLike)._zod.def

/** Drops optional and default wrappers, noting what they said. */
function unwrap(schema: ZodLike): {
  inner: ZodLike
  optional: boolean
  defaultValue?: unknown
} {
  let inner = schema
  let optional = false
  let defaultValue: unknown
  for (;;) {
    const def = defOf(inner)
    if (def.type === "optional") optional = true
    else if (def.type === "default") {
      const d = def.defaultValue
      optional = true
      defaultValue = typeof d === "function" ? (d as () => unknown)() : d
    } else if (def.type !== "nullable" && def.type !== "readonly") break
    inner = def.innerType!
  }
  return { inner, optional, defaultValue }
}

/** "relationshipTypes" → "Relationship types". Labels override it. */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Friendlier names than the schema keys, where the key reads badly. */
const LABELS: Record<string, string> = {
  relationshipTypes: "Relationship Types",
  claimKinds: "Claim Kinds",
  hasAttribute: "Has Attribute",
  kinds: "Kinds",
  minSteps: "Minimum steps",
  coreShared: "Core after (shared paths)",
  openDepth: "Open to depth",
  rootTag: "Root tag",
  sortBy: "Sort by",
  rankBy: "Rank by",
  colorBy: "Colour by",
  groupBy: "Group by",
  showAllSteps: "Show all steps",
  hideRead: "Hide what I've read",
  sourceRelationship: "Source Relationship Type",
  x: "X axis",
  y: "Y axis",
}

function refAt(refs: SettingsRefs | undefined, dotted: string): RefKind | null {
  if (!refs) return null
  for (const kind of ["relTypes", "kinds", "concepts"] as const)
    if (refs[kind].includes(dotted)) return kind
  return null
}

function numberInfo(def: Def): { integer: boolean; min?: number } {
  let integer = def.format === "safeint" || def.format === "int32"
  let min: number | undefined
  for (const c of def.checks ?? []) {
    const cd = defOf(c)
    if (cd.check === "number_format" && cd.format?.includes("int"))
      integer = true
    if (cd.check === "greater_than" && typeof cd.value === "number")
      min = cd.inclusive ? cd.value : cd.value + (integer ? 1 : 0)
  }
  return { integer, min }
}

function controlFor(
  inner: ZodLike,
  path: string[],
  refs: SettingsRefs | undefined
): FieldControl {
  const def = defOf(inner)
  const ref = refAt(refs, path.join("."))
  switch (def.type) {
    case "boolean":
      return { type: "boolean" }
    case "number":
      return { type: "number", ...numberInfo(def) }
    case "enum":
      return { type: "enum", options: Object.values(def.entries ?? {}) }
    case "string":
      return ref ? { type: "ref", ref } : { type: "text" }
    case "array": {
      const el = defOf(unwrap(def.element!).inner)
      if (el.type !== "string") return { type: "json" }
      return ref ? { type: "refs", ref } : { type: "tags" }
    }
    case "object":
      return { type: "group", fields: walk(inner, path, refs, false) }
    default:
      return { type: "json" }
  }
}

function walk(
  schema: ZodLike,
  prefix: string[],
  refs: SettingsRefs | undefined,
  top: boolean
): SettingsField[] {
  const shape = defOf(schema).shape ?? {}
  const fields: SettingsField[] = []
  for (const [key, child] of Object.entries(shape)) {
    if (top && (OVERRIDE_KEYS as readonly string[]).includes(key)) continue
    const { inner, optional, defaultValue } = unwrap(child)
    const path = [...prefix, key]
    fields.push({
      path,
      label: LABELS[key] ?? humanize(key),
      optional,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      control: controlFor(inner, path, refs),
    })
  }
  return fields
}

/** The form fields of a settings schema (a Zod object). */
export function settingsFields(
  schema: unknown,
  refs?: SettingsRefs
): SettingsField[] {
  return walk(schema as ZodLike, [], refs, true)
}

/** The value at `path`, or undefined. */
export function getAt(obj: unknown, path: readonly string[]): unknown {
  let cur = obj
  for (const seg of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/**
 * A copy of `obj` with `value` at `path`. `undefined` removes the key (and
 * an object left empty by it, when that object is optional to the caller).
 */
export function setAt(
  obj: Record<string, unknown>,
  path: readonly string[],
  value: unknown
): Record<string, unknown> {
  const [head, ...rest] = path
  if (head === undefined) return obj
  const next = { ...obj }
  if (rest.length === 0) {
    if (value === undefined) delete next[head]
    else next[head] = value
    return next
  }
  const child = next[head]
  const base =
    child && typeof child === "object" && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {}
  next[head] = setAt(base, rest, value)
  return next
}

/** "a, b ,, c" → ["a", "b", "c"]; tags may start with "#". */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean)
    ),
  ]
}
