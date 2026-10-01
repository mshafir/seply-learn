// The Expedition room (spec §2.4): one Durable Object per Expedition, named
// by its id, on the hibernation API, so an idle room costs nothing. It keeps
// no state in memory: everything it needs survives being evicted while its
// sockets stay open.
//
// - Each socket's join and presence live in its attachment (well under the
//   16 KB limit); its tags are its access and `u:<userId>`, so kicks and
//   fan-out find sockets without reading attachments.
// - Storage holds the head seq, the latest event of each running build, and
//   agents' presence with their expiry (an alarm clears them).
//
// Who hears what (relay.ts `RoomAccess`): collaborators send and hear
// presence; signed-in readers of a link hear `ops`, `poke` and `build`;
// anonymous readers hear `ops` and `poke` only. It never touches Postgres:
// the Worker checks access and passes the join and head seq in.
import {
  buildKey,
  IDLE_PRESENCE,
  parseClientMessage,
  TERMINAL_JOB_STATUSES,
  type BuildEvent,
  type JobStatus,
  type Participant,
  type PresenceState,
  type RoomMessage,
  type RoomOps,
} from "@seply/domain"
import type { AgentPresence, RoomAccess, RoomJoin } from "@seply/server"
import { DurableObject } from "cloudflare:workers"

/** Carries the Worker's `RoomJoin` into the room. Set only by the Worker. */
export const JOIN_HEADER = "x-seply-room-join"

/** A running build's events older than this are dropped from `hello`. */
const STALE_MS = 24 * 60 * 60 * 1000

/** A client frame larger than this is ignored (presence is tiny). */
const MAX_FRAME = 4096

/** The close code sent with `kick`. */
export const KICK_CODE = 4001

const BUILD_PREFIX = "build:"
const AGENT_PREFIX = "agent:"
const HEAD_SEQ = "headSeq"

export type Attachment = {
  /** This connection's participant id. */
  id: string
  userId: string | null
  name: string
  access: RoomAccess
  /** Null until the client sends presence, and again once it leaves. */
  presence: PresenceState | null
}

type StoredAgent = { participant: Participant; until: number }

const userTag = (userId: string) => `u:${userId}`

export class ExpeditionRoom extends DurableObject {
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
  async join(ws: WebSocket, join: RoomJoin): Promise<void> {
    const tags: string[] = [join.access]
    if (join.userId) tags.push(userTag(join.userId))
    this.ctx.acceptWebSocket(ws, tags)
    const me: Attachment = {
      id: crypto.randomUUID(),
      userId: join.userId,
      name: join.name,
      access: join.access,
      presence: null,
    }
    ws.serializeAttachment(me)
    const known = (await this.ctx.storage.get<number>(HEAD_SEQ)) ?? 0
    const collaborator = join.access === "collaborator"
    this.send(ws, {
      t: "hello",
      headSeq: Math.max(known, join.headSeq),
      presence: collaborator ? await this.participants(ws) : [],
      builds: join.access === "anonymous" ? [] : await this.builds(),
      ...(collaborator && { you: me.id }),
    })
  }

  /** A job's progress (RPC from the Worker or a Workflow). Not for anonymous readers. */
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
    this.broadcast({ t: "build", ...evt }, ["collaborator", "reader"])
  }

  /**
   * Newly logged ops (RPC from the Worker's relay after a push commits,
   * already small enough to send; larger batches come as `poke`).
   */
  async ops(msg: RoomOps): Promise<void> {
    await this.advance(msg.to)
    this.broadcast(msg)
  }

  /** New ops were logged up to `headSeq`: everyone pulls. */
  async poke(headSeq: number): Promise<void> {
    await this.advance(headSeq)
    this.broadcast({ t: "poke", headSeq })
  }

  /**
   * Closes a user's sockets (or, with null, every reader's and anonymous
   * reader's) with `kick`.
   */
  async kick(userId: string | null, reason: string): Promise<void> {
    const sockets = userId
      ? this.ctx.getWebSockets(userTag(userId))
      : [
          ...this.ctx.getWebSockets("reader"),
          ...this.ctx.getWebSockets("anonymous"),
        ]
    for (const ws of sockets) {
      this.send(ws, { t: "kick", reason })
      this.depart(ws)
      try {
        ws.close(KICK_CODE, reason.slice(0, 120))
      } catch {
        // Already closed.
      }
    }
  }

  /** An agent via MCP is working here; it shows until `ttlMs` passes without a call. */
  async agentPresence(agent: AgentPresence): Promise<void> {
    const participant: Participant = {
      ...IDLE_PRESENCE,
      id: AGENT_PREFIX + agent.userId,
      userId: agent.userId,
      name: agent.label,
      agent: true,
    }
    const until = Date.now() + agent.ttlMs
    await this.ctx.storage.put(AGENT_PREFIX + agent.userId, {
      participant,
      until,
    } satisfies StoredAgent)
    await this.scheduleAlarm()
    this.broadcast({ t: "presence", ...participant }, ["collaborator"])
  }

  /** Agents whose TTL ran out leave. */
  async alarm(): Promise<void> {
    const now = Date.now()
    const agents = await this.ctx.storage.list<StoredAgent>({
      prefix: AGENT_PREFIX,
    })
    for (const [key, a] of agents) {
      if (a.until > now) continue
      await this.ctx.storage.delete(key)
      this.broadcast({ t: "leave", id: a.participant.id }, ["collaborator"])
    }
    await this.scheduleAlarm()
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > MAX_FRAME) return
    const me = ws.deserializeAttachment() as Attachment | null
    // Only collaborators send anything; readers' frames are ignored.
    if (!me || me.access !== "collaborator") return
    const msg = parseClientMessage(data)
    if (!msg) return
    if (msg.t === "leave") {
      this.depart(ws)
      return
    }
    const presence: PresenceState = {
      view: msg.view,
      cursor: msg.cursor,
      selection: msg.selection,
      ...(msg.editing !== undefined && { editing: msg.editing }),
    }
    ws.serializeAttachment({ ...me, presence } satisfies Attachment)
    this.broadcast(
      {
        t: "presence",
        ...presence,
        id: me.id,
        userId: me.userId!,
        name: me.name,
      },
      ["collaborator"],
      ws
    )
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.depart(ws)
    try {
      ws.close(code, reason)
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket) {
    this.depart(ws)
  }

  /** The socket's participant is gone: tell the others, once. */
  private depart(ws: WebSocket) {
    const me = ws.deserializeAttachment() as Attachment | null
    if (!me?.presence) return
    try {
      ws.serializeAttachment({ ...me, presence: null } satisfies Attachment)
    } catch {
      // A closed socket's attachment can't change; it is gone anyway.
    }
    this.broadcast({ t: "leave", id: me.id }, ["collaborator"], ws)
  }

  /** Everyone with presence here (other sockets and live agents). */
  private async participants(except: WebSocket): Promise<Participant[]> {
    const out: Participant[] = []
    for (const ws of this.ctx.getWebSockets("collaborator")) {
      if (ws === except) continue
      const a = ws.deserializeAttachment() as Attachment | null
      if (a?.presence && a.userId)
        out.push({ ...a.presence, id: a.id, userId: a.userId, name: a.name })
    }
    const now = Date.now()
    const agents = await this.ctx.storage.list<StoredAgent>({
      prefix: AGENT_PREFIX,
    })
    for (const a of agents.values()) if (a.until > now) out.push(a.participant)
    return out
  }

  private async scheduleAlarm() {
    const agents = await this.ctx.storage.list<StoredAgent>({
      prefix: AGENT_PREFIX,
    })
    const next = Math.min(...[...agents.values()].map((a) => a.until))
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next)
    else await this.ctx.storage.deleteAlarm()
  }

  private async advance(headSeq: number) {
    const known = (await this.ctx.storage.get<number>(HEAD_SEQ)) ?? 0
    if (headSeq > known) await this.ctx.storage.put(HEAD_SEQ, headSeq)
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

  /** Sends to every socket with one of `to`'s tags (default: everyone). */
  private broadcast(msg: RoomMessage, to?: RoomAccess[], except?: WebSocket) {
    const data = JSON.stringify(msg)
    const sockets = to
      ? to.flatMap((tag) => this.ctx.getWebSockets(tag))
      : this.ctx.getWebSockets()
    for (const ws of sockets) {
      if (ws === except) continue
      try {
        ws.send(data)
      } catch {
        // A closing socket; its close handler cleans up.
      }
    }
  }

  private send(ws: WebSocket, msg: RoomMessage) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // Closing.
    }
  }
}
