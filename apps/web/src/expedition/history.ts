// What History says (spec §3.9): a Change's line ("Accepted 12 suggestions ·
// Ana · 2h ago"), the labels of the Changes undo and restore make, and the
// report of edits an undo kept ("2 edits kept: changed since by Ana").
import type { KeptEdit } from "@seply/domain"

import type { ChangeSummary } from "@/lib/api.ts"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

/** "just now", "5m ago", "2h ago", "3d ago", then the date. */
export function relativeTime(at: string, now = Date.now()): string {
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return ""
  const ago = Math.max(0, now - ms)
  if (ago < MINUTE) return "just now"
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d ago`
  return dateOnly.format(new Date(ms))
}

/** Who made a Change, as History shows it: "You" for the reader. */
export const authorName = (change: ChangeSummary, me: string | null) =>
  change.author.id === me ? "You" : change.author.name

/** "Ana · 2h ago" */
export const changeMeta = (
  change: ChangeSummary,
  me: string | null,
  now = Date.now()
) => `${authorName(change, me)} · ${relativeTime(change.at, now)}`

const quoted = (label: string) => `“${label}”`

/** The label of the Change an undo makes. */
export const undoLabel = (change: ChangeSummary) =>
  `Undid ${quoted(change.label)}`

/** The label of the Change "Restore to here" makes. */
export const restoreLabel = (change: ChangeSummary) =>
  `Restored to ${quoted(change.label)}`

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

/**
 * "2 edits kept: changed since by Ana" (spec §1.4). `nameOf` maps a user id
 * to a name (null: unknown); unknown writers read "someone else".
 */
export function keptMessage(
  kept: readonly KeptEdit[],
  nameOf: (userId: string) => string | null
): string | null {
  if (!kept.length) return null
  const names: string[] = []
  for (const k of kept) {
    const name = (k.by && nameOf(k.by.actor)) ?? "someone else"
    if (!names.includes(name)) names.push(name)
  }
  const n = kept.length === 1 ? "1 edit" : `${kept.length} edits`
  return `${n} kept: changed since by ${listNames(names)}`
}
