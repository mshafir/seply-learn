// Built-in Concept Kinds and Relationship Types (spec §1.2). They live in app
// code with stable ids (`builtin:<name>`); an Expedition refers to them, adds
// its own, and can hide one. The v1 set is the seeding contract's.
import type { PaletteColor } from "./common.ts"

export const BUILTIN_PREFIX = "builtin:"
export const builtinId = (name: string) => `${BUILTIN_PREFIX}${name}`
export const isBuiltinId = (id: string) => id.startsWith(BUILTIN_PREFIX)

export type KindDef = {
  id: string
  label: string
  color: PaletteColor
  icon?: string
}
export type RelTypeDef = {
  id: string
  /** Reads "from <label> to", e.g. "is needed to understand". */
  label: string
  inverseLabel: string
  color: PaletteColor
  dashed: boolean
}

const kind = (
  name: string,
  label: string,
  color: PaletteColor,
  icon: string
): KindDef => ({
  id: builtinId(name),
  label,
  color,
  icon,
})

/** The 16 built-in Kinds. `idea` is the default. */
export const BUILTIN_KINDS: readonly KindDef[] = [
  kind("idea", "Idea", "blue", "lightbulb"),
  kind("topic", "Topic", "slate", "folder"),
  kind("question", "Question", "amber", "circle-help"),
  kind("goal", "Goal", "green", "target"),
  kind("person", "Person", "violet", "user"),
  kind("place", "Place", "teal", "map-pin"),
  kind("thing", "Thing", "orange", "box"),
  kind("claim", "Claim", "amber", "message-square-quote"),
  kind("evidence", "Evidence", "indigo", "file-check"),
  kind("criterion", "Criterion", "olive", "list-checks"),
  kind("decision", "Decision", "pink", "git-branch"),
  kind("action", "Action", "green", "play"),
  kind("event", "Event", "slate", "calendar"),
  kind("source", "Source", "brown", "book-open"),
  kind("measurement", "Measurement", "teal", "ruler"),
  kind("risk", "Risk", "red", "triangle-alert"),
]

export const DEFAULT_KIND_ID = builtinId("idea")

const rel = (
  name: string,
  label: string,
  inverseLabel: string,
  color: PaletteColor,
  dashed = false
): RelTypeDef => ({ id: builtinId(name), label, inverseLabel, color, dashed })

/** The 18 built-in Relationship Types, with forward and inverse labels. */
export const BUILTIN_REL_TYPES: readonly RelTypeDef[] = [
  rel("part-of", "is part of", "has part", "violet", true),
  rel("prerequisite", "is needed to understand", "needs", "blue"),
  rel("example", "is an example of", "has example", "teal", true),
  rel("led-to", "led to", "came from", "teal"),
  rel("uses", "uses", "is used by", "orange"),
  rel("modifies", "changes", "is changed by", "violet", true),
  rel("raises", "raises", "is raised by", "red"),
  rel("lowers", "lowers", "is lowered by", "green"),
  rel("causes", "causes", "is caused by", "orange"),
  rel("supports", "supports", "is supported by", "indigo"),
  rel("challenges", "challenges", "is challenged by", "amber", true),
  rel("corrects", "corrects", "is corrected by", "brown"),
  rel(
    "alternative-to",
    "is an alternative to",
    "is an alternative to",
    "slate",
    true
  ),
  rel("meets", "meets", "is met by", "green"),
  rel("partly-meets", "partly meets", "is partly met by", "amber"),
  rel("fails", "fails", "is failed by", "red"),
  rel("located-in", "is in", "contains", "teal"),
  rel("reported-by", "is reported by", "reports", "slate", true),
]

export const BUILTIN_KIND_BY_ID: ReadonlyMap<string, KindDef> = new Map(
  BUILTIN_KINDS.map((k) => [k.id, k])
)
export const BUILTIN_REL_TYPE_BY_ID: ReadonlyMap<string, RelTypeDef> = new Map(
  BUILTIN_REL_TYPES.map((r) => [r.id, r])
)
