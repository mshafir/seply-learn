// The live relay on Node (spec §2.4): in-process rooms, one per Expedition
// with sockets connected to this instance, each running `@seply/server`'s
// `Room` (the same protocol code as the Durable Object) over `ws` sockets
// and memory. Postgres LISTEN/NOTIFY fans out to the other instances on one
// database: `exp_ops` carries `ops` and `poke` after a commit, `exp_live`
// carries builds, kicks, agents and collaborators' presence. Payloads stay
// under 8 KB: `ops` too large for one become a `poke` for the other
// instances (their clients pull), and a build event drops its preview nodes.
//
// Each instance applies its own events at once and ignores their echo.
// Collaborators connected elsewhere show here as timed participants
// (`Room.remotePresence`): every instance re-announces its own every
// `REFRESH_MS`, and one that dies stops, so its people leave after `TTL_MS`.
import { randomUUID } from "node:crypto"
import {
  opsMessage,
  type BuildEvent,
  type LoggedOp,
  type Participant,
  type RoomMessage,
  type RoomOps,
} from "@seply/domain"
import {
  Room,
  type AgentPresence,
  type Attachment,
  type Relay,
  type RoomJoin,
  type RoomStorage,
} from "@seply/server"
import pg from "pg"
import { WebSocket } from "ws"

export const OPS_CHANNEL = "exp_ops"
export const LIVE_CHANNEL = "exp_live"
/** NOTIFY's limit is 8000 bytes; leave room for the envelope. */
export const NOTIFY_MAX_BYTES = 7500
/** How often an instance re-announces its collaborators to the others. */
export const REFRESH_MS = 15_000
/** How long another instance's collaborator shows without news of them. */
export const TTL_MS = 3 * REFRESH_MS
/** Pings keep idle sockets open through proxies and find dead ones. */
const PING_MS = 30_000

/** What travels between instances. */
export type BusEvent =
  | { k: "ops"; msg: RoomOps }
  | { k: "poke"; headSeq: number }
  | { k: "build"; evt: BuildEvent }
  | { k: "kick"; userId: string | null; reason: string }
  | { k: "agent"; agent: AgentPresence }
  | { k: "presence"; p: Participant }
  | { k: "leave"; id: string }
  /** A new instance asks the others to announce their collaborators. */
  | { k: "sync" }

type Envelope = { o: string; e: string; ev: BusEvent }

/** A room's storage in memory, with one alarm as a timer. */
class MemoryStorage implements RoomStorage {
  data = new Map<string, unknown>()
  private timer: NodeJS.Timeout | null = null
  constructor(private readonly onAlarm: () => void) {}
  async get<T>(key: string) {
    return structuredClone(this.data.get(key)) as T | undefined
  }
  async put(key: string, value: unknown) {
    this.data.set(key, structuredClone(value))
  }
  async list<T>(prefix: string) {
    return new Map(
      [...this.data]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, structuredClone(v) as T])
    )
  }
  async delete(keys: string[]) {
    for (const k of keys) this.data.delete(k)
  }
  async setAlarm(at: number) {
    this.clear()
    this.timer = setTimeout(this.onAlarm, Math.max(0, at - Date.now()))
    this.timer.unref()
  }
  async deleteAlarm() {
    this.clear()
  }
  clear() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

type Conn = { tags: string[]; attachment: Attachment | null; alive: boolean }

class LocalRoom {
  readonly conns = new Map<WebSocket, Conn>()
  /** Sockets being let in (the room must not be dropped meanwhile). */
  joining = 0
  /** Whether open jobs were read in from the database yet. */
  seeded = false
  readonly storage: MemoryStorage
  readonly room: Room<WebSocket>
  constructor(
    forward: (msg: RoomMessage) => void,
    onAlarm: (r: LocalRoom) => void
  ) {
    this.storage = new MemoryStorage(() => onAlarm(this))
    const conns = this.conns
    this.room = new Room<WebSocket>({
      storage: this.storage,
      forward,
      sockets: {
        accept: (ws, tags) =>
          void conns.set(ws, { tags, attachment: null, alive: true }),
        sockets: (tag) =>
          [...conns]
            .filter(
              ([ws, c]) =>
                ws.readyState === WebSocket.OPEN &&
                (!tag || c.tags.includes(tag))
            )
            .map(([ws]) => ws),
        attachment: (ws) => structuredClone(conns.get(ws)?.attachment ?? null),
        attach: (ws, a) => {
          const c = conns.get(ws)
          if (c) c.attachment = structuredClone(a)
        },
        send: (ws, data) => ws.send(data),
        close: (ws, code, reason) => ws.close(code, reason),
      },
    })
  }
  /** Nothing here worth keeping: no sockets, builds or timed participants. */
  get idle() {
    return (
      this.conns.size === 0 &&
      this.joining === 0 &&
      [...this.storage.data.keys()].every((k) => k === "headSeq")
    )
  }
}

export type NodeRooms = {
  relay: Relay
  /** Accepts an upgraded socket into its Expedition's room. */
  accept(ws: WebSocket, join: RoomJoin): Promise<void>
  /** Starts listening (and the refresh timer). */
  start(): Promise<void>
  /** Says goodbye to every socket (1001: clients reconnect elsewhere) and stops. */
  stop(): Promise<void>
  /** This instance's id on the bus. */
  readonly instance: string
  /** For tests: the Expeditions with a room here. */
  rooms(): string[]
}

export function createNodeRooms(opts: {
  databaseUrl: string
  /** Sends a NOTIFY (through the pool). */
  notify: (channel: string, payload: string) => Promise<void>
  /** Reads an Expedition's head seq (to poke rooms after the listener reconnects). */
  headSeq: (expeditionId: string) => Promise<number | null>
  /**
   * The Expedition's open jobs, as `build` events, for a room this instance
   * opens: rooms live in memory, so after a restart `hello` still lists the
   * builds that are running (the Durable Object keeps them in storage).
   */
  openBuilds?: (expeditionId: string) => Promise<BuildEvent[]>
}): NodeRooms {
  const instance = randomUUID()
  const rooms = new Map<string, LocalRoom>()
  let listener: pg.Client | null = null
  let stopped = false
  let everConnected = false
  let refresh: NodeJS.Timeout | null = null
  let pinger: NodeJS.Timeout | null = null
  /** NOTIFYs in flight, so `stop` can wait for them. */
  const pending = new Set<Promise<void>>()

  const publish = (channel: string, expeditionId: string, ev: BusEvent) => {
    if (stopped) return
    const payload = JSON.stringify({
      o: instance,
      e: expeditionId,
      ev,
    } satisfies Envelope)
    if (Buffer.byteLength(payload) > NOTIFY_MAX_BYTES) {
      console.error(
        `live: a ${ev.k} event is too large to share (${payload.length} bytes)`
      )
      return
    }
    const sent = opts
      .notify(channel, payload)
      .catch((err) => console.error("live: notify failed", err.message))
      .finally(() => pending.delete(sent))
    pending.add(sent)
  }

  /** Anything too large for NOTIFY goes as something smaller. */
  const shrink = (ev: BusEvent): BusEvent => {
    const size = () => Buffer.byteLength(JSON.stringify(ev))
    if (size() < NOTIFY_MAX_BYTES - 200) return ev
    if (ev.k === "ops") return { k: "poke", headSeq: ev.msg.to }
    if (ev.k === "build") {
      const rest = { ...ev.evt }
      delete rest.previewNodes
      return { k: "build", evt: rest }
    }
    return ev
  }

  const gc = (id: string, r: LocalRoom) => {
    if (!r.idle || rooms.get(id) !== r) return
    r.storage.clear()
    rooms.delete(id)
  }

  const room = (id: string, create = true): LocalRoom | undefined => {
    let r = rooms.get(id)
    if (!r && create) {
      r = new LocalRoom(
        (msg) => {
          if (msg.t === "presence") {
            const p: Participant & { t?: string } = { ...msg }
            delete p.t
            publish(LIVE_CHANNEL, id, { k: "presence", p })
          } else if (msg.t === "leave")
            publish(LIVE_CHANNEL, id, { k: "leave", id: msg.id })
        },
        (lr) => void lr.room.alarm().then(() => gc(id, lr))
      )
      rooms.set(id, r)
    }
    return r
  }

  /** Applies an event to this instance's room for the Expedition. */
  const apply = async (id: string, ev: BusEvent) => {
    await applyTo(id, ev)
    const r = rooms.get(id)
    if (r) gc(id, r)
  }
  const applyTo = async (id: string, ev: BusEvent) => {
    switch (ev.k) {
      case "ops":
        return room(id, false)?.room.ops(ev.msg)
      case "poke":
        return room(id, false)?.room.poke(ev.headSeq)
      case "build":
        return room(id)!.room.build(ev.evt)
      case "kick":
        return room(id, false)?.room.kick(ev.userId, ev.reason)
      case "agent":
        return room(id)!.room.agentPresence(ev.agent)
      case "presence":
        return room(id)!.room.remotePresence(ev.p, TTL_MS)
      case "leave":
        return room(id, false)?.room.remoteLeave(ev.id)
      case "sync":
        return announce()
    }
  }

  /** Local first, then the other instances. */
  const emit = async (channel: string, id: string, ev: BusEvent) => {
    await apply(id, ev)
    publish(channel, id, shrink(ev))
  }

  /** Tells the others about this instance's collaborators (the refresh). */
  const announce = () => {
    for (const [id, r] of rooms)
      for (const p of r.room.localParticipants())
        publish(LIVE_CHANNEL, id, { k: "presence", p })
  }

  const onNotification = (msg: pg.Notification) => {
    if (!msg.payload) return
    let env: Envelope
    try {
      env = JSON.parse(msg.payload) as Envelope
    } catch {
      return
    }
    if (env.o === instance || typeof env.e !== "string" || !env.ev) return
    apply(env.e, env.ev).catch((err) =>
      console.error(`live: applying ${env.ev.k} failed`, err)
    )
  }

  const connect = async (delayMs = 500): Promise<void> => {
    if (stopped) return
    const client = new pg.Client({ connectionString: opts.databaseUrl })
    client.on("notification", onNotification)
    client.on("error", (err) =>
      console.error("live: listener error", err.message)
    )
    client.on("end", () => {
      if (listener !== client || stopped) return
      listener = null
      console.error("live: listener disconnected; reconnecting")
      setTimeout(() => void connect(), delayMs).unref()
    })
    try {
      await client.connect()
      await client.query(`LISTEN ${OPS_CHANNEL}`)
      await client.query(`LISTEN ${LIVE_CHANNEL}`)
    } catch (err) {
      console.error("live: listener connect failed", (err as Error).message)
      await client.end().catch(() => {})
      if (stopped) return
      const next = Math.min(delayMs * 2, 10_000)
      setTimeout(() => void connect(next), delayMs).unref()
      return
    }
    listener = client
    // Ask the others who is here, and say who is here.
    publish(LIVE_CHANNEL, "", { k: "sync" })
    announce()
    if (everConnected) {
      // Events may have been missed while disconnected: everyone catches up.
      for (const id of rooms.keys())
        opts
          .headSeq(id)
          .then(async (seq) => {
            if (seq !== null) await room(id, false)?.room.poke(seq)
          })
          .catch(() => {})
    }
    everConnected = true
  }

  const relay: Relay = {
    async published(id, batch: readonly LoggedOp[]) {
      const msg = opsMessage(batch)
      if (msg?.t === "ops") await emit(OPS_CHANNEL, id, { k: "ops", msg })
      else if (msg)
        await emit(OPS_CHANNEL, id, { k: "poke", headSeq: msg.headSeq })
    },
    build: (id, evt) => emit(LIVE_CHANNEL, id, { k: "build", evt }),
    poke: (id, headSeq) => emit(OPS_CHANNEL, id, { k: "poke", headSeq }),
    kick: (id, userId, reason) =>
      emit(LIVE_CHANNEL, id, { k: "kick", userId, reason }),
    agentPresence: (id, agent) => emit(LIVE_CHANNEL, id, { k: "agent", agent }),
    // The HTTP server performs the upgrade (server.ts); see `accept`.
  }

  return {
    instance,
    relay,
    rooms: () => [...rooms.keys()],
    async accept(ws, join) {
      const r = room(join.expeditionId)!
      r.joining++
      try {
        if (!r.seeded && opts.openBuilds) {
          r.seeded = true
          const known = await r.storage.list("build:")
          if (!known.size)
            for (const evt of await opts.openBuilds(join.expeditionId))
              await r.room.build(evt)
        }
      } catch (err) {
        console.error("live: reading open jobs failed", err)
      }
      ws.on("pong", () => {
        const c = r.conns.get(ws)
        if (c) c.alive = true
      })
      ws.on("message", (data, isBinary) => {
        const frame = isBinary
          ? new ArrayBuffer(0)
          : Array.isArray(data)
            ? Buffer.concat(data).toString("utf8")
            : Buffer.from(data as ArrayBuffer).toString("utf8")
        r.room
          .message(ws, frame)
          .catch((err) => console.error("live: message", err))
      })
      ws.on("close", (code, reason) => {
        r.room
          .closed(ws, code, reason.toString())
          .catch((err) => console.error("live: close", err))
          .finally(() => {
            r.conns.delete(ws)
            gc(join.expeditionId, r)
          })
      })
      ws.on("error", () => void r.room.errored(ws))
      try {
        await r.room.join(ws, join)
      } finally {
        r.joining--
      }
    },
    async start() {
      await connect()
      refresh = setInterval(announce, REFRESH_MS)
      refresh.unref()
      pinger = setInterval(() => {
        for (const r of rooms.values())
          for (const [ws, c] of r.conns) {
            if (!c.alive) {
              ws.terminate()
              continue
            }
            c.alive = false
            ws.ping()
          }
      }, PING_MS)
      pinger.unref()
    },
    async stop() {
      if (refresh) clearInterval(refresh)
      if (pinger) clearInterval(pinger)
      // Their collaborators leave the other instances' rooms now.
      for (const [id, r] of rooms)
        for (const p of r.room.localParticipants())
          publish(LIVE_CHANNEL, id, { k: "leave", id: p.id })
      stopped = true
      await Promise.allSettled([...pending])
      for (const r of rooms.values()) {
        for (const ws of r.conns.keys()) ws.close(1001, "server restarting")
        r.storage.clear()
      }
      const l = listener
      listener = null
      await l?.end().catch(() => {})
    },
  }
}
