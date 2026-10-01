// Presence hooks over the screen's room (use-room.ts): the header's avatar
// list, re-read only when someone joins, leaves or changes View (so cursor
// moves don't re-render the screen), and sending this reader's pointer.
import * as React from "react"
import type { RoomClient } from "@seply/sync"

import {
  avatarsOf,
  cursorAt,
  type PresenceAvatar,
} from "@/expedition/presence.ts"

/** The room's avatars, re-read when someone joins, leaves or changes View. */
export function usePresenceAvatars(
  room: RoomClient | null,
  selfUserId: string | null
): PresenceAvatar[] {
  const [avatars, setAvatars] = React.useState<PresenceAvatar[]>([])
  React.useEffect(() => {
    if (!room) return
    let key = ""
    const update = () => {
      const next = avatarsOf(room.presence.values(), selfUserId)
      const nextKey = JSON.stringify(next)
      if (nextKey === key) return
      key = nextKey
      setAvatars(next)
    }
    update()
    const unsubscribe = room.subscribe(update)
    const stopStatus = room.onStatus(update)
    return () => {
      unsubscribe()
      stopStatus()
      setAvatars([])
    }
  }, [room, selfUserId])
  return avatars
}

/**
 * Sends this reader's pointer over `pane` as presence: pane fractions, plus
 * the Concept under it. Leaving the pane clears the cursor.
 */
export function useCursorSender(
  room: RoomClient | null,
  paneRef: React.RefObject<HTMLElement | null>
) {
  React.useEffect(() => {
    const pane = paneRef.current
    if (!room || !pane) return
    const move = (e: PointerEvent) => {
      const el =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>("[data-concept]")
          : null
      const concept =
        el && pane.contains(el)
          ? { id: el.dataset.concept!, box: el.getBoundingClientRect() }
          : null
      room.setPresence({
        cursor: cursorAt(
          { x: e.clientX, y: e.clientY },
          pane.getBoundingClientRect(),
          concept
        ),
      })
    }
    const leave = () => room.setPresence({ cursor: null })
    pane.addEventListener("pointermove", move)
    pane.addEventListener("pointerleave", leave)
    return () => {
      pane.removeEventListener("pointermove", move)
      pane.removeEventListener("pointerleave", leave)
    }
  }, [room, paneRef])
}
