// The in-memory shape `apply` folds ops into: one Expedition's shared,
// logged state. Plain columns (owner, Visibility, forked_from, trash) and
// per-reader state live outside it.
import type {
  AttributeType,
  AttributeValue,
  ExpeditionStatus,
  PaletteColor,
  Prov,
  SourceKind,
  ViewStatus,
  WeightPin,
} from "./common.ts"
import type { ViewTypeId } from "./view-types.ts"

/** ISO time of a tombstone, or null when live. */
export type Tombstone = string | null

export type ExpeditionState = {
  id: string
  title: string
  summary: string
  status: ExpeditionStatus
  bestViewId: string | null
  tags: string[]
}

export type Concept = {
  id: string
  title: string
  aliases: string[]
  kind: string
  tags: string[]
  summary?: string
  overview?: string
  overviewProv: Prov
  attributes: Record<string, AttributeValue>
  date?: string
  dateEnd?: string
  dateApprox?: boolean
  lane?: string
  lat?: number
  lon?: number
  weightPin?: WeightPin
  prov: Prov
  deletedAt: Tombstone
}

export type ArticleSection = {
  id: string
  conceptId: string
  orderKey: string
  heading: string
  md: string
  prov: Prov
  deletedAt: Tombstone
}

export type Relationship = {
  from: string
  type: string
  to: string
  note?: string
  prov: Prov
  deletedAt: Tombstone
  /**
   * Set when the Relationship was tombstoned by deleting this Concept, so
   * restoring the Concept brings it back (spec §1.3).
   */
  deletedWith?: string
}

export type KindDefState = {
  id: string
  label?: string
  color?: PaletteColor
  icon?: string
  hidden: boolean
}

export type RelTypeDefState = {
  id: string
  label?: string
  inverseLabel?: string
  color?: PaletteColor
  dashed?: boolean
  hidden: boolean
}

export type AttributeDef = {
  id: string
  label: string
  type: AttributeType
  unit?: string
  enumValues?: string[]
  deletedAt: Tombstone
}

export type View = {
  id: string
  viewType: ViewTypeId
  label: string
  question?: string
  orderKey: string
  settings: Record<string, unknown>
  settingsVersion: number
  status: ViewStatus
  failReason?: string
  deletedAt: Tombstone
}

export type Source = {
  id: string
  kind: SourceKind
  title: string
  blobKey?: string
  segmentsKey?: string
  mime?: string
  size?: number
  addedBy: string
  addedAt: string
}

export type DomainState = {
  expedition: ExpeditionState
  concepts: Record<string, Concept>
  sections: Record<string, ArticleSection>
  /** Keyed by `relKey(from, type, to)`. */
  relationships: Record<string, Relationship>
  /** Custom Kinds, plus rows that hide a built-in. */
  kinds: Record<string, KindDefState>
  relTypes: Record<string, RelTypeDefState>
  attributes: Record<string, AttributeDef>
  views: Record<string, View>
  sources: Record<string, Source>
}

export function emptyState(expeditionId: string, title = ""): DomainState {
  return {
    expedition: {
      id: expeditionId,
      title,
      summary: "",
      status: "draft",
      bestViewId: null,
      tags: [],
    },
    concepts: {},
    sections: {},
    relationships: {},
    kinds: {},
    relTypes: {},
    attributes: {},
    views: {},
    sources: {},
  }
}

export const relKey = (from: string, type: string, to: string) =>
  `${from}|${type}|${to}`
export function parseRelKey(key: string): {
  from: string
  type: string
  to: string
} {
  const [from, type, to, ...rest] = key.split("|")
  if (!from || !type || !to || rest.length)
    throw new Error(`bad Relationship key: ${key}`)
  return { from, type, to }
}

export const isLive = (e: { deletedAt: Tombstone } | undefined): boolean =>
  !!e && e.deletedAt === null
