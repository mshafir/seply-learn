// Live cursors (spec §3.6; DIVERGENCES.md #4): the other collaborators'
// pointers on the View this reader has open, drawn over the canvas pane in
// each person's colour with a name tag. Each cursor sits on the Concept it
// points at when this reader's View shows it (presence.ts `placeCursor`), so
// it stays put while either reader pans or zooms; positions are re-read every
// animation frame, outside React.
// The other half, sending this reader's pointer, is use-presence.ts.
import * as React from "react"
import { MousePointer2Icon } from "lucide-react"

import { Badge } from "@seply/ui/components/badge"
import { kindColor } from "@seply/ui/lib/kinds"
import type { Participant } from "@seply/domain"
import type { RoomClient } from "@seply/sync"

import { cursorsOn, hueFor, placeCursor } from "@/expedition/presence.ts"

const conceptIn = (pane: HTMLElement, id: string) =>
  pane.querySelector<HTMLElement>(`[data-concept="${CSS.escape(id)}"]`)

export function LiveCursors({
  room,
  paneRef,
  viewId,
  selfUserId,
}: {
  room: RoomClient | null
  paneRef: React.RefObject<HTMLElement | null>
  viewId: string | null
  selfUserId: string | null
}) {
  const [cursors, setCursors] = React.useState<Participant[]>([])
  const latest = React.useRef<Participant[]>([])
  const nodes = React.useRef(new Map<string, HTMLDivElement>())

  React.useEffect(() => {
    if (!room) return
    const update = () => {
      const next = cursorsOn(room.presence.values(), viewId, selfUserId)
      latest.current = next
      // Re-render only when who is pointing changes; moves are drawn below.
      setCursors((prev) =>
        prev.length === next.length &&
        prev.every((p, i) => p.id === next[i]!.id && p.name === next[i]!.name)
          ? prev
          : next
      )
    }
    update()
    const unsubscribe = room.subscribe(update)
    const stopStatus = room.onStatus(update)
    return () => {
      unsubscribe()
      stopStatus()
      latest.current = []
      setCursors([])
    }
  }, [room, viewId, selfUserId])

  React.useEffect(() => {
    if (!cursors.length) return
    let frame = 0
    const draw = () => {
      const pane = paneRef.current
      if (pane) {
        const box = pane.getBoundingClientRect()
        for (const p of latest.current) {
          const node = nodes.current.get(p.id)
          if (!node || !p.cursor) continue
          const at = placeCursor(p.cursor, box, (id) => {
            const el = conceptIn(pane, id)
            return el ? el.getBoundingClientRect() : null
          })
          node.style.transform = `translate(${at.x}px, ${at.y}px)`
        }
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [cursors, paneRef])

  if (!cursors.length) return null
  return (
    <div
      aria-hidden
      data-testid="live-cursors"
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
    >
      {cursors.map((p) => {
        const color = kindColor(hueFor(p.userId))
        return (
          <div
            key={p.id}
            ref={(el) => {
              if (el) nodes.current.set(p.id, el)
              else nodes.current.delete(p.id)
            }}
            data-testid="live-cursor"
            data-user={p.userId}
            className="absolute top-0 left-0 transition-transform duration-75 ease-linear will-change-transform"
          >
            <MousePointer2Icon
              className="size-4 -translate-x-px -translate-y-px stroke-background"
              style={{ fill: color }}
            />
            <Badge
              className="ml-3 border-transparent text-background shadow-sm"
              style={{ backgroundColor: color }}
            >
              {p.name}
            </Badge>
          </div>
        )
      })}
    </div>
  )
}
