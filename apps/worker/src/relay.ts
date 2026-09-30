// The Relay over Expedition rooms (Durable Objects, one per Expedition).
import type { Relay } from "@seply/server"
import type { ExpeditionRoom } from "./room.ts"
import { JOIN_HEADER } from "./room.ts"

export function roomRelay(ns: DurableObjectNamespace<ExpeditionRoom>): Relay {
  const room = (expeditionId: string) => ns.get(ns.idFromName(expeditionId))
  return {
    async published(expeditionId, batch) {
      const last = batch.at(-1)
      if (last) await room(expeditionId).poke(last.serverSeq)
    },
    async build(expeditionId, evt) {
      await room(expeditionId).build(evt)
    },
    handleUpgrade(req, join) {
      // A copy with our own join header: whatever the client sent is replaced.
      const inner = new Request(req)
      inner.headers.set(JOIN_HEADER, JSON.stringify(join))
      return room(join.expeditionId).fetch(inner)
    },
  }
}
