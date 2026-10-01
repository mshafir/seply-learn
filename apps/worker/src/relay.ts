// The Relay over Expedition rooms (Durable Objects, one per Expedition).
import { opsMessage } from "@seply/domain"
import type { Relay } from "@seply/server"
import type { ExpeditionRoom } from "./room.ts"
import { JOIN_HEADER } from "./room.ts"

export function roomRelay(ns: DurableObjectNamespace<ExpeditionRoom>): Relay {
  const room = (expeditionId: string) => ns.get(ns.idFromName(expeditionId))
  return {
    async published(expeditionId, batch) {
      // Small batches go out as `ops`; large ones never cross into the room.
      const msg = opsMessage(batch)
      if (msg?.t === "ops") await room(expeditionId).ops(msg)
      else if (msg) await room(expeditionId).poke(msg.headSeq)
    },
    async build(expeditionId, evt) {
      await room(expeditionId).build(evt)
    },
    async kick(expeditionId, userId, reason) {
      await room(expeditionId).kick(userId, reason)
    },
    async agentPresence(expeditionId, agent) {
      await room(expeditionId).agentPresence(agent)
    },
    handleUpgrade(req, join) {
      // A copy with our own join header: whatever the client sent is replaced.
      const inner = new Request(req)
      inner.headers.set(JOIN_HEADER, JSON.stringify(join))
      return room(join.expeditionId).fetch(inner)
    },
  }
}
