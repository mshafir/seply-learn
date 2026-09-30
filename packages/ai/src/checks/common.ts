// Shared by the checks: findings, and the few structural reads they need
// from an Expedition's state.
import {
  isLive,
  type Concept,
  type ConceptFilter,
  type DomainState,
  type Relationship,
} from "@seply/domain"

/**
 * One thing a check found. A **problem** blocks the commit (spec §5.3); a
 * **warning** is for the agent to look at.
 */
export type Finding = {
  severity: "problem" | "warning"
  /** Stable, for tests and for the agent to group by: "dangling-ref", "column-fill", … */
  code: string
  message: string
  /** The Concepts it is about, when there are any. */
  concepts?: string[]
}

export const problem = (
  code: string,
  message: string,
  concepts?: string[]
): Finding => ({
  severity: "problem",
  code,
  message,
  ...(concepts && { concepts }),
})
export const warning = (
  code: string,
  message: string,
  concepts?: string[]
): Finding => ({
  severity: "warning",
  code,
  message,
  ...(concepts && { concepts }),
})

/** A built-in id (`builtin:part-of`) or a plain one (`part-of`) by its name. */
export const named = (id: string) =>
  id.startsWith("builtin:") ? id.slice("builtin:".length) : id

export const liveConcepts = (s: DomainState): Concept[] =>
  Object.values(s.concepts).filter(isLive)
export const liveRelationships = (s: DomainState): Relationship[] =>
  Object.values(s.relationships).filter(isLive)

/** "Title" (for messages); the id when the Concept is gone. */
export const titleOf = (s: DomainState, id: string) =>
  s.concepts[id]?.title ?? id
export const quoted = (xs: readonly string[], max = 5) =>
  xs
    .slice(0, max)
    .map((x) => `'${x}'`)
    .join(", ") + (xs.length > max ? ` and ${xs.length - max} more` : "")

/** The same filter the Views apply (`@seply/views` `matchesFilter`). */
export function matchesFilter(c: Concept, f: ConceptFilter | undefined) {
  if (!f) return true
  return (
    (!f.kinds || f.kinds.includes(c.kind)) &&
    (!f.tags || c.tags.some((t) => f.tags!.includes(t))) &&
    (!f.hasAttribute || c.attributes[f.hasAttribute] !== undefined)
  )
}

export const PART_OF = "part-of"
export const isType = (type: string, name: string) => named(type) === name
