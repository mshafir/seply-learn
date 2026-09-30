// The Expedition room (spec §2.4): one Durable Object per Expedition, named
// by its id. Minimal for WP-3.2: it greets each socket with `hello` (head
// seq, the running builds), fans out `build` events and `poke`s after
// commits. Sockets use the hibernation API, so an idle room costs nothing.
// It never touches Postgres: the Worker checks access and passes the head
// seq in. Presence, `ops`, `leave` and `kick` come with WP-4.1.
import {
  buildKey,
  TERMINAL_JOB_STATUSES,
  type BuildEvent,
  type JobStatus,
  type RoomMessage,
} from "@seply/domain"
import type { RoomJoin } from "@seply/server"
import { DurableObject } from "cloudflare:workers"

/** Carries the Worker's `RoomJoin` into the room. Set only by the Worker. */
export const JOIN_HEADER = "x-seply-room-join"

/** A running build's events older than this are dropped from `hello`. */
const STALE_MS = 24 * 60 * 60 * 1000

const BUILD_PREFIX = "build:"
const HEAD_SEQ = "headSeq"

type Attachment = { userId: string }

export class ExpeditionRoom extends DurableObject {
  /** A WebSocket upgrade the Worker has already authorised. */
  async fetch(req: Request): Promise<Response> {
    const raw = req.headers.get(JOIN_HEADER)
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket" || !raw)
      return new Response("expected a WebSocket upgrade", { status: 426 })
    const join = JSON.parse(raw) as RoomJoin
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server, [join.userId])
    server.serializeAttachment({ userId: join.userId } satisfies Attachment)
    const known = (await this.ctx.storage.get<number>(HEAD_SEQ)) ?? 0
    this.send(server, {
      t: "hello",
      headSeq: Math.max(known, join.headSeq),
      presence: [],
      builds: await this.builds(),
    })
    return new Response(null, { status: 101, webSocket: client })
  }

  /** A job's progress (RPC from the Worker or a Workflow). */
  async build(evt: BuildEvent): Promise<void> {
    const ended =
      !evt.viewId && TERMINAL_JOB_STATUSES.includes(evt.status as JobStatus)
    if (ended) {
      // The job is over: its Views' logged statuses tell latecomers the rest.
      const keys = await this.ctx.storage.list({
        prefix: `${BUILD_PREFIX}${evt.jobId}`,
      })
      await this.ctx.storage.delete([...keys.keys()])
    } else {
      await this.ctx.storage.put(BUILD_PREFIX + buildKey(evt), evt)
    }
    this.broadcast({ t: "build", ...evt })
  }

  /** New ops were logged up to `headSeq` (RPC from the Worker's relay). */
  async poke(headSeq: number): Promise<void> {
    const known = (await this.ctx.storage.get<number>(HEAD_SEQ)) ?? 0
    if (headSeq > known) await this.ctx.storage.put(HEAD_SEQ, headSeq)
    this.broadcast({ t: "poke", headSeq })
  }

  /** Clients send nothing yet (presence is WP-4.1); anything else is ignored. */
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason)
    } catch {
      // Already closed.
    }
  }

  private async builds(): Promise<BuildEvent[]> {
    const all = await this.ctx.storage.list<BuildEvent>({
      prefix: BUILD_PREFIX,
    })
    const cutoff = Date.now() - STALE_MS
    const live: BuildEvent[] = []
    const stale: string[] = []
    for (const [key, evt] of all) {
      if (Date.parse(evt.at) < cutoff) stale.push(key)
      else live.push(evt)
    }
    if (stale.length) await this.ctx.storage.delete(stale)
    return live.sort((a, b) => a.at.localeCompare(b.at))
  }

  private broadcast(msg: RoomMessage) {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data)
      } catch {
        // A closing socket; its close handler cleans up.
      }
    }
  }

  private send(ws: WebSocket, msg: RoomMessage) {
    ws.send(JSON.stringify(msg))
  }
}
