// Presence on the Expedition screen (spec §3.6), as pure functions: who to
// show in the header, each person's colour, and where a cursor goes.
//
// - Everyone else in the room is a participant per tab; the header shows
//   one avatar per person (`userId`), never the reader themselves (their
//   other tabs included), agents via MCP last.
// - A person's colour is one of the 12 Kind hues, picked from their user id,
//   so it is the same in every tab and on every screen.
// - A cursor is sent as fractions of the canvas pane and, over a Concept,
//   fractions of that Concept's box (`data-concept`, which every View
//   renderer sets). It is drawn on the same Concept when this reader's View
//   shows it, else at the same place in the pane.
import type { Participant, RoomCursor } from "@seply/domain"
import { KIND_HUES, type KindHue } from "@seply/ui/lib/kinds"

/** A stable hue per user. */
export function hueFor(userId: string): KindHue {
  let h = 0
  for (let i = 0; i < userId.length; i++)
    h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return KIND_HUES[h % KIND_HUES.length]!
}

export type PresenceAvatar = {
  userId: string
  name: string
  agent: boolean
  /** The Views they have open (one per tab). */
  views: string[]
}

/** One avatar per person other than `selfUserId`, people first, by name. */
export function avatarsOf(
  participants: Iterable<Participant>,
  selfUserId: string | null
): PresenceAvatar[] {
  const byUser = new Map<string, PresenceAvatar>()
  for (const p of participants) {
    if (!p.agent && p.userId === selfUserId) continue
    const key = p.agent ? p.id : p.userId
    const a = byUser.get(key) ?? {
      userId: p.userId,
      name: p.name,
      agent: !!p.agent,
      views: [],
    }
    if (p.view && !a.views.includes(p.view)) a.views.push(p.view)
    byUser.set(key, a)
  }
  return [...byUser.values()].sort(
    (a, b) => Number(a.agent) - Number(b.agent) || a.name.localeCompare(b.name)
  )
}

/** The participants whose cursor shows on this View: others, on it, pointing. */
export function cursorsOn(
  participants: Iterable<Participant>,
  viewId: string | null,
  selfUserId: string | null
): Participant[] {
  if (!viewId) return []
  return [...participants].filter(
    (p) =>
      !p.agent && p.userId !== selfUserId && p.view === viewId && !!p.cursor
  )
}

type Box = { left: number; top: number; width: number; height: number }

const fraction = (v: number) => Math.round(v * 10_000) / 10_000

/** The cursor to send for a pointer at (x, y) over `pane`, maybe over a Concept. */
export function cursorAt(
  point: { x: number; y: number },
  pane: Box,
  concept?: { id: string; box: Box } | null
): RoomCursor {
  const cursor: RoomCursor = {
    x: fraction((point.x - pane.left) / (pane.width || 1)),
    y: fraction((point.y - pane.top) / (pane.height || 1)),
  }
  if (concept && concept.box.width > 0 && concept.box.height > 0)
    cursor.on = {
      id: concept.id,
      x: fraction((point.x - concept.box.left) / concept.box.width),
      y: fraction((point.y - concept.box.top) / concept.box.height),
    }
  return cursor
}

/**
 * Where to draw a cursor, in px from the pane's top-left: on its Concept
 * when `boxOf` finds it on screen, else at the same fractions of the pane.
 */
export function placeCursor(
  cursor: RoomCursor,
  pane: Box,
  boxOf: (conceptId: string) => Box | null
): { x: number; y: number } {
  const box = cursor.on ? boxOf(cursor.on.id) : null
  if (cursor.on && box && box.width > 0)
    return {
      x: box.left - pane.left + cursor.on.x * box.width,
      y: box.top - pane.top + cursor.on.y * box.height,
    }
  return { x: cursor.x * pane.width, y: cursor.y * pane.height }
}
