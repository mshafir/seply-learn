// The Expedition screen's live room (spec §2.4; @seply/sync's RoomClient):
// one per open Expedition, for every reader, signed in or not.
//
// - `ops` are applied to the sync client at once (`receiveRelayed`); `hello`
//   (every (re)connect) and `poke` (large batches, gaps) pull when the log
//   has moved past the client's head. Other people's and other tabs' edits
//   arrive without polling.
// - While the room isn't open (connecting, a server without a live room,
//   kicked) the client falls back to pulling every few seconds while the
//   page is visible, and at once when it becomes visible again.
// - The tab says `leave` on `pagehide`, so its presence clears at once.
// - A `kick` closes the room for good and calls `onKicked` (the screen
//   reopens, which checks access again).
//
// Off (reading the offline copy), there is no room and no polling.
import * as React from "react"
import {
  RoomClient,
  roomUrl,
  type RoomStatus,
  type SyncClient,
} from "@seply/sync"

/** How often the client pulls while the room isn't open (and the page is visible). */
export const FALLBACK_POLL_MS = 3000

export type Room = {
  /** The room, once it has opened; null before and while off. */
  room: RoomClient | null
  status: RoomStatus
}

export function useRoom({
  expeditionId,
  client,
  enabled,
  onKicked,
}: {
  expeditionId: string
  client: SyncClient
  enabled: boolean
  onKicked?: (reason: string) => void
}): Room {
  const [room, setRoom] = React.useState<RoomClient | null>(null)
  const [status, setStatus] = React.useState<RoomStatus>("connecting")
  const onKickedRef = React.useRef(onKicked)
  React.useEffect(() => {
    onKickedRef.current = onKicked
  })

  React.useEffect(() => {
    if (!enabled) return
    const r = new RoomClient({ url: roomUrl(expeditionId) })
    const unsubscribe = r.subscribe((msg) => {
      if (msg.t === "ops") client.receiveRelayed(msg)
      else if (msg.t === "hello" || msg.t === "poke")
        client.catchUp(msg.headSeq)
      else if (msg.t === "kick") onKickedRef.current?.(msg.reason)
    })

    // The fallback: pull now and then while the room isn't open.
    const visible = () => document.visibilityState === "visible"
    const pull = () => {
      // A failed poll changes nothing; the next one tries again.
      if (r.status !== "open" && visible()) client.pull().catch(() => {})
    }
    const timer = setInterval(pull, FALLBACK_POLL_MS)
    document.addEventListener("visibilitychange", pull)
    // The screen gets the room once it opens (until then there is nothing
    // to show or send).
    const stopStatus = r.onStatus((s) => {
      setStatus(s)
      if (s === "open") setRoom(r)
    })
    const leave = () => r.leave()
    window.addEventListener("pagehide", leave)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", pull)
      window.removeEventListener("pagehide", leave)
      stopStatus()
      unsubscribe()
      r.close()
      setRoom(null)
    }
  }, [expeditionId, client, enabled])

  return { room: enabled ? room : null, status }
}
