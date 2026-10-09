// The Expedition room (spec §2.4): one Durable Object per Expedition, named
// by its id, on the hibernation API, so an idle room costs nothing. It keeps
// no state in memory: everything it needs survives being evicted while its
// sockets stay open.
//
// The behaviour (who hears what, leave once, kick, agents' TTL) is
// `@seply/server`'s `Room`, shared with the Node rooms (WP-6.1): each
// socket's join and presence live in its attachment (well under the 16 KB
// limit), its tags are its access and `u:<userId>`, and storage holds the
// head seq, running builds and agents' presence (an alarm clears them).
import type { BuildEvent, RoomOps } from "@seply/domain"
import type { AgentPresence } from "@seply/server"
import { KICK_CODE, Room, type Attachment, type RoomJoin } from "@seply/server"
import { DurableObject } from "cloudflare:workers"

export { KICK_CODE, type Attachment }

/** Carries the Worker's `RoomJoin` into the room. Set only by the Worker. */
export const JOIN_HEADER = "x-seply-room-join"

export class ExpeditionRoom extends DurableObject {
  /**
   * The room's behaviour (`@seply/server`'s `Room`, shared with the Node
   * rooms) over this object's hibernatable sockets and storage. Built per
   * instance; it holds nothing but these handles.
   */
  private readonly room = new Room<WebSocket>({
    sockets: {
      accept: (ws, tags) => this.ctx.acceptWebSocket(ws, tags),
      sockets: (tag) => this.ctx.getWebSockets(tag),
      attachment: (ws) => ws.deserializeAttachment() as Attachment | null,
      attach: (ws, a) => ws.serializeAttachment(a),
      send: (ws, data) => ws.send(data),
      close: (ws, code, reason) => ws.close(code, reason),
    },
    storage: {
      get: (key) => this.ctx.storage.get(key),
      put: (key, value) => this.ctx.storage.put(key, value),
      list: (prefix) => this.ctx.storage.list({ prefix }),
      delete: (keys) => this.ctx.storage.delete(keys),
      setAlarm: (at) => this.ctx.storage.setAlarm(at),
      deleteAlarm: () => this.ctx.storage.deleteAlarm(),
    },
  })

  /** A WebSocket upgrade the Worker has already authorised. */
  async fetch(req: Request): Promise<Response> {
    const raw = req.headers.get(JOIN_HEADER)
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket" || !raw)
      return new Response("expected a WebSocket upgrade", { status: 426 })
    const join = JSON.parse(raw) as RoomJoin
    const { 0: client, 1: server } = new WebSocketPair()
    await this.join(server, join)
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Accepts a socket into the room and greets it with `hello`. */
  join(ws: WebSocket, join: RoomJoin): Promise<void> {
    return this.room.join(ws, join)
  }

  /** A job's progress (RPC from the Worker or a Workflow). Not for anonymous readers. */
  build(evt: BuildEvent): Promise<void> {
    return this.room.build(evt)
  }

  /**
   * Newly logged ops (RPC from the Worker's relay after a push commits,
   * already small enough to send; larger batches come as `poke`).
   */
  ops(msg: RoomOps): Promise<void> {
    return this.room.ops(msg)
  }

  /** New ops were logged up to `headSeq`: everyone pulls. */
  poke(headSeq: number): Promise<void> {
    return this.room.poke(headSeq)
  }

  /**
   * Closes a user's sockets (or, with null, every reader's and anonymous
   * reader's) with `kick`.
   */
  kick(userId: string | null, reason: string): Promise<void> {
    return this.room.kick(userId, reason)
  }

  /** An agent via MCP is working here; it shows until `ttlMs` passes without a call. */
  agentPresence(agent: AgentPresence): Promise<void> {
    return this.room.agentPresence(agent)
  }

  /** Agents whose TTL ran out leave. */
  alarm(): Promise<void> {
    return this.room.alarm()
  }

  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    return this.room.message(ws, data)
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    return this.room.closed(ws, code, reason)
  }

  webSocketError(ws: WebSocket) {
    return this.room.errored(ws)
  }
}
