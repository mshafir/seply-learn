// Editing in place (spec §3.7, §1.3, §1.6; WP-4.5): the pure parts. Lists
// typed as text, the Expedition's vocabulary (Kinds, Relationship Types,
// Attributes) with what uses each, and where a Concept sits in a View's
// structure (its parent, its siblings, where it may move). Pure functions of
// the domain state, so they are unit tested without a browser.
import {
  BUILTIN_KINDS,
  BUILTIN_REL_TYPES,
  isLive,
  parentInView,
  structureTypes,
  type AttributeType,
  type DomainState,
  type PaletteColor,
} from "@seply/domain"
import {
  anatomy,
  expeditionFromState,
  outlineTree,
  type AnatomyPart,
  type OutlineItem,
} from "@seply/views"

// ─── Lists typed as text ───────────────────────────────────────────────────

/** "a, b,, a" → ["a", "b"]: trimmed, no blanks, no repeats, in order. */
export function parseList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ]
}

/** Tags as typed: "#ml, Economics" → ["ml", "Economics"]. */
export const parseTags = (text: string) =>
  parseList(text.replace(/(^|,)\s*#/g, "$1"))

// ─── Vocabulary ────────────────────────────────────────────────────────────

/** A Kind, Relationship Type or Attribute, as the vocabulary dialog lists it. */
export type VocabItem = {
  id: string
  label: string
  /** The Relationship Type's inverse label; the Attribute's type (and unit). */
  detail?: string
  color?: PaletteColor
  builtin: boolean
  /** Hidden (Kinds, Relationship Types) or deleted (Attributes). */
  hidden: boolean
  /** Concepts of this Kind; Relationships of this Type; Concepts with a value. */
  uses: number
  attributeType?: AttributeType
}

const byHiddenThenLabel = (a: VocabItem, b: VocabItem) =>
  Number(a.hidden) - Number(b.hidden) || a.label.localeCompare(b.label)

/** Built-in Kinds (hidden or not), then the Expedition's own. */
export function kindVocabulary(state: DomainState): VocabItem[] {
  const uses = new Map<string, number>()
  for (const c of Object.values(state.concepts))
    if (isLive(c)) uses.set(c.kind, (uses.get(c.kind) ?? 0) + 1)
  const builtins = BUILTIN_KINDS.map((k): VocabItem => ({
    id: k.id,
    label: k.label,
    color: k.color,
    builtin: true,
    hidden: state.kinds[k.id]?.hidden ?? false,
    uses: uses.get(k.id) ?? 0,
  }))
  const own = Object.values(state.kinds)
    .filter((k) => !builtins.some((b) => b.id === k.id))
    .map((k): VocabItem => ({
      id: k.id,
      label: k.label ?? k.id,
      color: k.color,
      builtin: false,
      hidden: k.hidden,
      uses: uses.get(k.id) ?? 0,
    }))
  return [...builtins, ...own].sort(byHiddenThenLabel)
}

export function relTypeVocabulary(state: DomainState): VocabItem[] {
  const uses = new Map<string, number>()
  for (const r of Object.values(state.relationships))
    if (isLive(r)) uses.set(r.type, (uses.get(r.type) ?? 0) + 1)
  const builtins = BUILTIN_REL_TYPES.map((t): VocabItem => ({
    id: t.id,
    label: t.label,
    detail: t.inverseLabel,
    color: t.color,
    builtin: true,
    hidden: state.relTypes[t.id]?.hidden ?? false,
    uses: uses.get(t.id) ?? 0,
  }))
  const own = Object.values(state.relTypes)
    .filter((t) => !builtins.some((b) => b.id === t.id))
    .map((t): VocabItem => ({
      id: t.id,
      label: t.label ?? t.id,
      detail: t.inverseLabel,
      color: t.color,
      builtin: false,
      hidden: t.hidden,
      uses: uses.get(t.id) ?? 0,
    }))
  return [...builtins, ...own].sort(byHiddenThenLabel)
}

export function attributeVocabulary(state: DomainState): VocabItem[] {
  const uses = new Map<string, number>()
  for (const c of Object.values(state.concepts))
    if (isLive(c))
      for (const k of Object.keys(c.attributes))
        uses.set(k, (uses.get(k) ?? 0) + 1)
  return Object.values(state.attributes)
    .map((a): VocabItem => ({
      id: a.id,
      label: a.label,
      detail: a.unit ? `${a.type}, ${a.unit}` : a.type,
      builtin: false,
      hidden: !isLive(a),
      uses: uses.get(a.id) ?? 0,
      attributeType: a.type,
    }))
    .sort(byHiddenThenLabel)
}

/** What a removed item's members may be reassigned to: the other visible items (of the same type, for Attributes). */
export function reassignTargets(
  items: readonly VocabItem[],
  removing: VocabItem
): VocabItem[] {
  return items.filter(
    (i) =>
      i.id !== removing.id &&
      !i.hidden &&
      (removing.attributeType === undefined ||
        i.attributeType === removing.attributeType)
  )
}

/** A fresh id for something the Expedition defines ("Field trip" → "field-trip"), unique among `taken`. */
export function vocabId(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .slice(0, 40) || "item"
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

// ─── Structure in a View ───────────────────────────────────────────────────

/** Where a Concept sits in a View: its parent line and its siblings, in the order the View draws them. */
export type PlaceInView = { parentId: string; siblings: string[] }

/**
 * A Concept's parent and siblings as an Outline or Anatomy View draws them
 * (null: not drawn, a top line, or a View Type without structure). Only
 * these Views order siblings by the View's `order`.
 */
export function placeInView(
  state: DomainState,
  viewId: string,
  conceptId: string
): PlaceInView | null {
  const expedition = expeditionFromState(state)
  const view = expedition.views.find((v) => v.id === viewId)
  if (!view) return null
  if (view.viewType === "outline") {
    const model = outlineTree(expedition, view.settings)
    const find = (items: OutlineItem[]): PlaceInView | null => {
      for (const item of items) {
        if (item.children.some((k) => k.concept.id === conceptId))
          return {
            parentId: item.concept.id,
            siblings: item.children.map((k) => k.concept.id),
          }
        const inner = find(item.children)
        if (inner) return inner
      }
      return null
    }
    return find([...model.roots, ...model.unsorted])
  }
  if (view.viewType === "anatomy") {
    const model = anatomy(expedition, view.settings)
    const find = (parts: AnatomyPart[]): PlaceInView | null => {
      for (const part of parts) {
        if (part.parts.some((k) => k.concept.id === conceptId))
          return {
            parentId: part.concept.id,
            siblings: part.parts.map((k) => k.concept.id),
          }
        const inner = find(part.parts)
        if (inner) return inner
      }
      return null
    }
    return find(model.roots)
  }
  return null
}

/** Whether a View has a structure to re-parent in (Outline, Anatomy). */
export function hasStructure(state: DomainState, viewId: string): boolean {
  const view = state.views[viewId]
  return isLive(view) && structureTypes(view).length > 0
}

/** The Concepts a Concept may move under in a View: any live one but itself and what sits inside it. */
export function parentCandidates(
  state: DomainState,
  viewId: string,
  conceptId: string
): string[] {
  const view = state.views[viewId]
  if (!isLive(view)) return []
  const inside = (id: string) => {
    const seen = new Set<string>()
    for (
      let p: string | undefined = id;
      p && !seen.has(p);
      p = parentInView(state, view, p)
    ) {
      if (p === conceptId) return true
      seen.add(p)
    }
    return false
  }
  return Object.values(state.concepts)
    .filter((c) => isLive(c) && !inside(c.id))
    .map((c) => c.id)
}
