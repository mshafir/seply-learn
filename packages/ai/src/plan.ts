// The chosen Views before a build (spec §3.4: "Create Expedition with N
// Views" queues them; Save draft keeps them). A queued View is a real View row
// (status `queued`, the skim's label and question) so the rail can show it and
// a draft keeps it, but nothing has been built: its settings are these
// starting settings, valid for the View Type's schema and naming only
// built-in Kinds and Relationship Types (or nothing). The curator replaces
// them when it builds the View (`view_build` with the View's id).
import {
  builtinId,
  parseSharedSettings,
  type ViewTypeId,
} from "@seply/domain"

/** Stands in for an Attribute a View Type needs before the curator defines it. */
export const UNSET_ATTRIBUTE = "unset"

const rel = (name: string) => builtinId(name)

const STARTING: Record<ViewTypeId, Record<string, unknown>> = {
  "comparison-table": { rows: {}, columns: [{ criteria: "auto" }] },
  outline: { relationshipTypes: [rel("part-of")] },
  evidence: {
    supports: [rel("supports")],
    challenges: [rel("challenges")],
    claimKinds: [builtinId("claim")],
  },
  "cause-and-effect": {
    mode: "mechanism",
    positive: [rel("causes"), rel("raises")],
    negative: [rel("lowers")],
    outcomes: [],
    levers: {},
  },
  map: {},
  timeline: { lanes: [] },
  anatomy: { roots: [], containment: [rel("part-of")], pins: [rel("modifies")] },
  "learning-path": { relationshipTypes: [rel("prerequisite")] },
  lineage: { relationshipTypes: [rel("led-to")] },
  quadrant: { x: UNSET_ATTRIBUTE, y: UNSET_ATTRIBUTE },
  rates: {
    group: UNSET_ATTRIBUTE,
    low: UNSET_ATTRIBUTE,
    high: UNSET_ATTRIBUTE,
    direction: UNSET_ATTRIBUTE,
  },
}

/** A queued View's settings: valid for `viewType`, not yet built. */
export function startingSettings(viewType: ViewTypeId): Record<string, unknown> {
  const settings = structuredClone(STARTING[viewType])
  const parsed = parseSharedSettings(viewType, settings)
  if (!parsed.success) throw new Error(`starting settings for ${viewType} don't parse`)
  return settings
}
