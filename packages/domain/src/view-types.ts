// View Type settings (spec §1.6, §4.2): per View Type, a versioned Zod schema
// for shared settings (logged, path-edited, with per-View structure
// overrides) and one for personal settings (per reader, defaults from the
// schema only). Ported from prototypes/sample-graphs/src/lib/types.ts.
import { z } from "zod"

export const VIEW_TYPE_IDS = [
  "comparison-table",
  "outline",
  "evidence",
  "cause-and-effect",
  "map",
  "timeline",
  "anatomy",
  "learning-path",
  "lineage",
  "quadrant",
  "rates",
] as const
export const ViewTypeId = z.enum(VIEW_TYPE_IDS)
export type ViewTypeId = z.infer<typeof ViewTypeId>

const ids = z.array(z.string().min(1))

export const ConceptFilter = z.strictObject({
  kinds: ids.optional(),
  tags: ids.optional(),
  hasAttribute: z.string().min(1).optional(),
})
export type ConceptFilter = z.infer<typeof ConceptFilter>

/**
 * Per-View structure overrides. Shared `part-of` Relationships are the
 * default; these replace them in this View only.
 * - `placement`: this View's parent for a Concept
 * - `order`: this View's sibling order under a parent
 * - `hide`: Concepts the curator left out of this View
 * - `fold`: explicit folds (a Concept's folded children)
 */
export const ViewOverrides = z.strictObject({
  placement: z.record(z.string(), z.string()).optional(),
  order: z.record(z.string(), ids).optional(),
  hide: ids.optional(),
  fold: z.record(z.string(), ids).optional(),
})
export type ViewOverrides = z.infer<typeof ViewOverrides>
export const OVERRIDE_KEYS = ["placement", "order", "hide", "fold"] as const

const withOverrides = <S extends z.core.$ZodLooseShape>(shape: S) =>
  z.strictObject({ ...shape, ...ViewOverrides.shape })

export const ComparisonTableSettings = withOverrides({
  rows: ConceptFilter,
  // "criteria: auto" expands to every criterion the rows have a verdict on,
  // minus dropped ones, hard requirements first.
  columns: z.array(
    z.union([
      z.strictObject({ attribute: z.string().min(1) }),
      z.strictObject({ concept: z.string().min(1) }),
      z.strictObject({ criteria: z.literal("auto") }),
    ])
  ),
  sortBy: z.string().optional(),
  standing: z.string().optional(),
  priority: z.string().optional(),
})

export const OutlineSettings = withOverrides({
  relationshipTypes: ids, // read child -> parent
  rootTag: z.string().optional(),
  openDepth: z.number().int().min(0).optional(),
})

export const EvidenceSettings = withOverrides({
  supports: ids,
  challenges: ids,
  claimKinds: ids,
  evidenceType: z.string().optional(),
  consensus: z.string().optional(),
})

/** The prototype's fold-by-Relationship-Type is replaced by the explicit `fold` override. */
export const CauseEffectSettings = withOverrides({
  mode: z.enum(["mechanism", "risk"]),
  positive: ids,
  negative: ids,
  outcomes: ids,
  levers: ConceptFilter,
  rankBy: z.string().optional(),
})

export const MapSettings = withOverrides({
  kinds: ids.optional(),
  tags: ids.optional(),
  home: z.string().optional(),
  colorBy: z.string().optional(),
  relationshipTypes: ids.optional(),
})

export const TimelineSettings = withOverrides({
  lanes: z.array(z.strictObject({ id: z.string().min(1), label: z.string() })),
  focus: z.tuple([z.string(), z.string()]).optional(),
})

export const AnatomySettings = withOverrides({
  roots: ids,
  containment: ids,
  pins: ids,
  colorBy: z.string().optional(),
})

export const LearningPathSettings = withOverrides({
  relationshipTypes: ids, // A -> B: A is needed to understand B
  targets: ConceptFilter.optional(),
  minSteps: z.number().int().min(0).optional(),
  coreShared: z.number().int().min(1).optional(),
})

export const LineageSettings = withOverrides({
  relationshipTypes: ids, // older -> newer
  tags: ids.optional(),
  groupBy: z.string().optional(),
})

export const QuadrantSettings = withOverrides({
  x: z.string().min(1),
  y: z.string().min(1),
  tags: ids.optional(),
  progression: z.boolean().optional(),
  evidence: ids.optional(),
})

export const RatesSettings = withOverrides({
  group: z.string().min(1),
  low: z.string().min(1),
  high: z.string().min(1),
  direction: z.string().min(1),
  method: z.string().optional(),
  sourceRelationship: z.string().optional(),
  independence: z.string().optional(),
})

const hideRead = z.boolean().default(false)
const NoPersonalSettings = z.strictObject({})

/**
 * Where a View Type's settings refer to Relationship Types, Kinds and
 * Concepts, as dotted paths (`rows.kinds` style for filters;
 * `columns[].concept` reaches into each item of a list). Each path holds an id
 * or a list of ids. The per-View overrides (`placement`, `order`, `hide`,
 * `fold`) refer to Concepts in every View Type and are not listed. Used by
 * converters and by anything that rewrites references (import re-mints
 * Concept ids).
 */
export type SettingsRefs = {
  relTypes: readonly string[]
  kinds: readonly string[]
  concepts: readonly string[]
}

type ViewTypeSpec = {
  version: number
  shared: z.ZodType<Record<string, unknown>>
  personal: z.ZodType<Record<string, unknown>>
  refs: SettingsRefs
}

export const VIEW_TYPES = {
  "comparison-table": {
    version: 1,
    shared: ComparisonTableSettings,
    personal: NoPersonalSettings,
    refs: {
      relTypes: [],
      kinds: ["rows.kinds"],
      concepts: ["columns[].concept"],
    },
  },
  outline: {
    version: 1,
    shared: OutlineSettings,
    personal: z.strictObject({ hideRead }),
    refs: { relTypes: ["relationshipTypes"], kinds: [], concepts: [] },
  },
  evidence: {
    version: 1,
    shared: EvidenceSettings,
    personal: NoPersonalSettings,
    refs: {
      relTypes: ["supports", "challenges"],
      kinds: ["claimKinds"],
      concepts: [],
    },
  },
  "cause-and-effect": {
    version: 1,
    shared: CauseEffectSettings,
    personal: NoPersonalSettings,
    refs: {
      relTypes: ["positive", "negative"],
      kinds: ["levers.kinds"],
      concepts: ["outcomes"],
    },
  },
  map: {
    version: 1,
    shared: MapSettings,
    personal: NoPersonalSettings,
    refs: {
      relTypes: ["relationshipTypes"],
      kinds: ["kinds"],
      concepts: ["home"],
    },
  },
  timeline: {
    version: 1,
    shared: TimelineSettings,
    personal: NoPersonalSettings,
    refs: { relTypes: [], kinds: [], concepts: [] },
  },
  anatomy: {
    version: 1,
    shared: AnatomySettings,
    personal: NoPersonalSettings,
    refs: { relTypes: ["containment", "pins"], kinds: [], concepts: ["roots"] },
  },
  "learning-path": {
    version: 1,
    shared: LearningPathSettings,
    personal: z.strictObject({
      showAllSteps: z.boolean().default(false),
      hideRead,
    }),
    refs: {
      relTypes: ["relationshipTypes"],
      kinds: ["targets.kinds"],
      concepts: [],
    },
  },
  lineage: {
    version: 1,
    shared: LineageSettings,
    personal: NoPersonalSettings,
    refs: { relTypes: ["relationshipTypes"], kinds: [], concepts: [] },
  },
  quadrant: {
    version: 1,
    shared: QuadrantSettings,
    personal: NoPersonalSettings,
    refs: { relTypes: ["evidence"], kinds: [], concepts: [] },
  },
  rates: {
    version: 1,
    shared: RatesSettings,
    personal: NoPersonalSettings,
    refs: { relTypes: ["sourceRelationship"], kinds: [], concepts: [] },
  },
} as const satisfies Record<ViewTypeId, ViewTypeSpec>

export type SharedSettings<T extends ViewTypeId> = z.infer<
  (typeof VIEW_TYPES)[T]["shared"]
>
export type PersonalSettings<T extends ViewTypeId> = z.output<
  (typeof VIEW_TYPES)[T]["personal"]
>

/** Validates a View's shared settings against its View Type's current schema. */
export function parseSharedSettings(viewType: ViewTypeId, settings: unknown) {
  return (
    VIEW_TYPES[viewType].shared as z.ZodType<Record<string, unknown>>
  ).safeParse(settings)
}

/** A reader's personal settings, with the View Type's defaults filled in. */
export function parsePersonalSettings(
  viewType: ViewTypeId,
  settings: unknown = {}
) {
  return (
    VIEW_TYPES[viewType].personal as z.ZodType<Record<string, unknown>>
  ).safeParse(settings)
}

export function currentSettingsVersion(viewType: ViewTypeId): number {
  return VIEW_TYPES[viewType].version
}
