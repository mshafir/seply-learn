// The Expedition room's behaviour (spec §2.4), written once for both
// runtimes: the hibernating Durable Object on Cloudflare (apps/worker) and
// the in-process rooms on Node (apps/server-node). Each runtime hands it a
// `RoomHost`: its sockets (with tags and a small attachment each) and a
// key-value storage with one alarm. The room keeps nothing in memory itself,
// so a Durable Object can be evicted while its sockets stay open.
//
// - Each socket's join and presence live in its attachment; its tags are its
//   access and `u:<userId>`, so kicks and fan-out find sockets without
//   reading attachments.
// - Storage holds the head seq, the latest event of each running build, and
//   timed participants with their expiry (an alarm clears them): agents via
//   MCP and, on Node, collaborators connected to another instance.
//
// Who hears what (relay.ts `RoomAccess`): collaborators send and hear
// presence; signed-in readers of a link hear `ops`, `poke` and `build`;
// anonymous readers hear `ops` and `poke` only. It never touches Postgres:
// the app checks access and passes the join (with the Collaborator role) and
// head seq in.
//
// Roles (WP-5.1): the room takes no ops from anyone, whatever their role;
// ops arrive through /push, which checks the role on every op, and reach the
// room after they commit. A viewer's presence never claims to be `editing`.
// When someone is removed or their role changes, the app kicks their
// sockets (`kick`), and their tab reconnects only by opening the Expedition
// again, which reads their new access.
import {
  buildKey,
  IDLE_PRESENCE,
  parseClientMessage,
  TERMINAL_JOB_STATUSES,
  type BuildEvent,
  type JobStatus,
  type Participant,
  type PresenceState,
  type Role,
  type RoomMessage,
  type RoomOps,
} from "@seply/domain"
import type { AgentPresence, RoomAccess, RoomJoin } from "./relay.ts"

/** A running build's events older than this are dropped from `hello`. */
export const ROOM_STALE_MS = 24 * 60 * 60 * 1000

/** A client frame larger than this is ignored (presence is tiny). */
export const MAX_FRAME = 4096

/** The close code sent with `kick`. */
export const KICK_CODE = 4001

const BUILD_PREFIX = "build:"
const AGENT_PREFIX = "agent:"
const REMOTE_PREFIX = "remote:"
const TIMED_PREFIXES = [AGENT_PREFIX, REMOTE_PREFIX]
const HEAD_SEQ = "headSeq"

export type Attachment = {
  /** This connection's participant id. */
  id: string
  userId: string | null
  name: string
  access: RoomAccess
  /** The Collaborator role at join (null for readers of a link). */
  role: Role | null
  /** Null until the client sends presence, and again once it leaves. */
  presence: PresenceState | null
}

/** A participant shown until `until` (ms) unless renewed. */
type TimedParticipant = { participant: Participant; until: number }

/** The runtime's sockets. Calls on a closed socket may throw; the room catches. */
export interface RoomSockets<S> {
  accept(ws: S, tags: string[]): void
  /** The open sockets with this tag; every open socket without one. */
  sockets(tag?: string): S[]
  attachment(ws: S): Attachment | null
  attach(ws: S, a: Attachment): void
  send(ws: S, data: string): void
  close(ws: S, code: number, reason: string): void
}

/** The room's durable state (a Durable Object's storage, or memory on Node). */
export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  list<T>(prefix: string): Promise<Map<string, T>>
  delete(keys: string[]): Promise<unknown>
  /** One alarm per room: `alarm()` runs at `at` (ms). */
  setAlarm(at: number): Promise<void>
  deleteAlarm(): Promise<void>
}

export type RoomHost<S> = {
  sockets: RoomSockets<S>
  storage: RoomStorage
  /**
   * Told about presence and leaves from this room's own sockets, so another
   * instance can show them (Node's LISTEN/NOTIFY). The Durable Object has
   * none: it is the only room.
   */
  forward?(msg: RoomMessage): void
  now?: () => number
}

const userTag = (userId: string) => `u:${userId}`

export class Room<S> {
  private readonly sockets: RoomSockets<S>
  private readonly storage: RoomStorage
  private readonly now: () => number

  constructor(private readonly host: RoomHost<S>) {
    this.sockets = host.sockets
    this.storage = host.storage
    this.now = host.now ?? Date.now
  }

  /** Accepts a socket into the room and greets it with `hello`. */
  async join(ws: S, join: RoomJoin): Promise<void> {
    const tags: string[] = [join.access]
    if (join.userId) tags.push(userTag(join.userId))
    this.sockets.accept(ws, tags)
    const me: Attachment = {
      id: crypto.randomUUID(),
      userId: join.userId,
      name: join.name,
      access: join.access,
      role: join.role ?? null,
      presence: null,
    }
    this.sockets.attach(ws, me)
    const known = (await this.storage.get<number>(HEAD_SEQ)) ?? 0
    const collaborator = join.access === "collaborator"
    this.send(ws, {
      t: "hello",
      headSeq: Math.max(known, join.headSeq),
      presence: collaborator ? await this.participants(ws) : [],
      builds: join.access === "anonymous" ? [] : await this.builds(),
      ...(collaborator && { you: me.id }),
    })
  }

  /** A job's progress. Not for anonymous readers. */
  async build(evt: BuildEvent): Promise<void> {
    const ended =
      !evt.viewId && TERMINAL_JOB_STATUSES.includes(evt.status as JobStatus)
    if (ended) {
      // The job is over: its Views' logged statuses tell latecomers the rest.
      const keys = await this.storage.list(`${BUILD_PREFIX}${evt.jobId}`)
      await this.storage.delete([...keys.keys()])
    } else {
      await this.storage.put(BUILD_PREFIX + buildKey(evt), evt)
    }
    this.broadcast({ t: "build", ...evt }, ["collaborator", "reader"])
  }

  /** Newly logged ops, already small enough to send (larger batches come as `poke`). */
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
      ? this.sockets.sockets(userTag(userId))
      : [
          ...this.sockets.sockets("reader"),
          ...this.sockets.sockets("anonymous"),
        ]
    for (const ws of sockets) {
      this.send(ws, { t: "kick", reason })
      this.depart(ws)
      try {
        this.sockets.close(ws, KICK_CODE, reason.slice(0, 120))
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
    await this.remember(AGENT_PREFIX + agent.userId, participant, agent.ttlMs)
  }

  /**
   * A collaborator connected to another instance (Node) moved: shown here
   * until `ttlMs` passes without news of them (that instance re-sends its
   * participants while they stay).
   */
  async remotePresence(participant: Participant, ttlMs: number): Promise<void> {
    const key = REMOTE_PREFIX + participant.id
    const known = await this.storage.get<TimedParticipant>(key)
    if (
      known &&
      JSON.stringify(known.participant) === JSON.stringify(participant)
    ) {
      // Only a renewal (the other instance's refresh): nothing to tell anyone.
      await this.storage.put(key, { ...known, until: this.now() + ttlMs })
      await this.scheduleAlarm()
      return
    }
    await this.remember(key, participant, ttlMs)
  }

  /** A collaborator on another instance left. */
  async remoteLeave(id: string): Promise<void> {
    const key = REMOTE_PREFIX + id
    if (!(await this.storage.get(key))) return
    await this.storage.delete([key])
    await this.scheduleAlarm()
    this.broadcast({ t: "leave", id }, ["collaborator"])
  }

  /** This room's own sockets' participants (what `forward` has told others). */
  localParticipants(): Participant[] {
    const out: Participant[] = []
    for (const ws of this.sockets.sockets("collaborator")) {
      const a = this.sockets.attachment(ws)
      if (a?.presence && a.userId)
        out.push({ ...a.presence, id: a.id, userId: a.userId, name: a.name })
    }
    return out
  }

  /** Timed participants whose TTL ran out leave. */
  async alarm(): Promise<void> {
    const now = this.now()
    for (const prefix of TIMED_PREFIXES) {
      const timed = await this.storage.list<TimedParticipant>(prefix)
      for (const [key, a] of timed) {
        if (a.until > now) continue
        await this.storage.delete([key])
        this.broadcast({ t: "leave", id: a.participant.id }, ["collaborator"])
      }
    }
    await this.scheduleAlarm()
  }

  /** A frame from a socket. */
  async message(ws: S, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== "string" || data.length > MAX_FRAME) return
    const me = this.sockets.attachment(ws)
    // Only collaborators send anything; readers' frames are ignored.
    if (!me || me.access !== "collaborator") return
    const msg = parseClientMessage(data)
    if (!msg) return
    if (msg.t === "leave") {
      this.depart(ws)
      return
    }
    // Viewers can't edit, so they never show as editing.
    const editing = me.role === "viewer" ? undefined : msg.editing
    const presence: PresenceState = {
      view: msg.view,
      cursor: msg.cursor,
      selection: msg.selection,
      ...(editing !== undefined && { editing }),
    }
    this.sockets.attach(ws, { ...me, presence } satisfies Attachment)
    const out: RoomMessage = {
      t: "presence",
      ...presence,
      id: me.id,
      userId: me.userId!,
      name: me.name,
    }
    this.broadcast(out, ["collaborator"], ws)
    this.host.forward?.(out)
  }

  /** The socket closed: its participant leaves (once). */
  async closed(ws: S, code: number, reason: string): Promise<void> {
    this.depart(ws)
    try {
      this.sockets.close(ws, code, reason)
    } catch {
      // Already closed.
    }
  }

  async errored(ws: S): Promise<void> {
    this.depart(ws)
  }

  /** The socket's participant is gone: tell the others, once. */
  private depart(ws: S) {
    const me = this.sockets.attachment(ws)
    if (!me?.presence) return
    try {
      this.sockets.attach(ws, { ...me, presence: null } satisfies Attachment)
    } catch {
      // A closed socket's attachment can't change; it is gone anyway.
    }
    const msg: RoomMessage = { t: "leave", id: me.id }
    this.broadcast(msg, ["collaborator"], ws)
    this.host.forward?.(msg)
  }

  private async remember(key: string, participant: Participant, ttlMs: number) {
    const until = this.now() + ttlMs
    await this.storage.put(key, {
      participant,
      until,
    } satisfies TimedParticipant)
    await this.scheduleAlarm()
    this.broadcast({ t: "presence", ...participant }, ["collaborator"])
  }

  /** Everyone with presence here (other sockets and timed participants). */
  private async participants(except: S): Promise<Participant[]> {
    const out = this.localParticipants().filter(
      (p) => p.id !== this.sockets.attachment(except)?.id
    )
    const now = this.now()
    for (const prefix of TIMED_PREFIXES) {
      const timed = await this.storage.list<TimedParticipant>(prefix)
      for (const a of timed.values()) if (a.until > now) out.push(a.participant)
    }
    return out
  }

  private async scheduleAlarm() {
    const until: number[] = []
    for (const prefix of TIMED_PREFIXES) {
      const timed = await this.storage.list<TimedParticipant>(prefix)
      for (const a of timed.values()) until.push(a.until)
    }
    const next = Math.min(...until)
    if (Number.isFinite(next)) await this.storage.setAlarm(next)
    else await this.storage.deleteAlarm()
  }

  private async advance(headSeq: number) {
    const known = (await this.storage.get<number>(HEAD_SEQ)) ?? 0
    if (headSeq > known) await this.storage.put(HEAD_SEQ, headSeq)
  }

  private async builds(): Promise<BuildEvent[]> {
    const all = await this.storage.list<BuildEvent>(BUILD_PREFIX)
    const cutoff = this.now() - ROOM_STALE_MS
    const live: BuildEvent[] = []
    const stale: string[] = []
    for (const [key, evt] of all) {
      if (Date.parse(evt.at) < cutoff) stale.push(key)
      else live.push(evt)
    }
    if (stale.length) await this.storage.delete(stale)
    return live.sort((a, b) => a.at.localeCompare(b.at))
  }

  /** Sends to every socket with one of `to`'s tags (default: everyone). */
  private broadcast(msg: RoomMessage, to?: RoomAccess[], except?: S) {
    const data = JSON.stringify(msg)
    const sockets = to
      ? to.flatMap((tag) => this.sockets.sockets(tag))
      : this.sockets.sockets()
    for (const ws of sockets) {
      if (ws === except) continue
      try {
        this.sockets.send(ws, data)
      } catch {
        // A closing socket; its close handler cleans up.
      }
    }
  }

  private send(ws: S, msg: RoomMessage) {
    try {
      this.sockets.send(ws, JSON.stringify(msg))
    } catch {
      // Closing.
    }
  }
}
