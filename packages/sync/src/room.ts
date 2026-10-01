// The Expedition room client (spec §2.4): one WebSocket to
// `/api/expeditions/:id/live` through partysocket's reconnecting socket
// (backoff from 500 ms doubling to 10 s), keeping:
//
// - `headSeq` (from `hello`, `ops` and `poke`): pull when it passes yours;
//   `ops` carry the ops themselves (`SyncClient.receiveRelayed`);
// - `builds`: the latest `build` event of each running job and View;
// - `presence`: everyone else here, by participant id (collaborators only;
//   other readers hear none);
// - `you`: this connection's participant id, when it may send presence.
//
// `setPresence` merges into this tab's presence and sends it, throttled to
// `presenceHz`; it is sent again after every reconnect. `leave()` tells the
// room before the tab goes. A `kick` closes the room for good (`kicked`).
// `subscribe(listener)` gets every `RoomMessage` after that state changes.
import {
  buildKey,
  IDLE_PRESENCE,
  parseRoomMessage,
  PRESENCE_HZ,
  TERMINAL_JOB_STATUSES,
  type BuildEvent,
  type ClientMessage,
  type JobStatus,
  type Participant,
  type PresenceState,
  type RoomMessage,
} from "@seply/domain"
import ReconnectingWebSocket from "partysocket/ws"

export type RoomStatus = "connecting" | "open" | "closed"

export type RoomClientOptions = {
  /** `ws:` or `wss:` URL of the room; see `roomUrl`. */
  url: string
  /** Defaults to the global WebSocket. */
  WebSocket?: typeof WebSocket
  /** First reconnect delay, doubled up to `maxDelayMs` (default 500 ms, 10 s). */
  minDelayMs?: number
  maxDelayMs?: number
  /** Presence sends per second, at most (default `PRESENCE_HZ`). */
  presenceHz?: number
}

export type RoomListener = (msg: RoomMessage, room: RoomClient) => void

/** The room's URL for an Expedition, on the page's own origin by default. */
export function roomUrl(expeditionId: string, origin = location.origin) {
  const u = new URL(
    `/api/expeditions/${encodeURIComponent(expeditionId)}/live`,
    origin
  )
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
  return u.toString()
}

/** The close code the room kicks with (apps/worker room.ts). */
const KICK_CODE = 4001

const isJobEnd = (evt: BuildEvent) =>
  !evt.viewId && TERMINAL_JOB_STATUSES.includes(evt.status as JobStatus)

export class RoomClient {
  /** The latest event of each running job and each View it builds, by `buildKey`. */
  readonly builds = new Map<string, BuildEvent>()
  /** Everyone else in the room, by participant id. */
  readonly presence = new Map<string, Participant>()
  headSeq = 0
  status: RoomStatus = "connecting"
  /** This connection's participant id; null when it may not send presence. */
  you: string | null = null
  /** Why the room closed this connection, once it has. */
  kicked: string | null = null

  private ws: ReconnectingWebSocket
  private listeners = new Set<RoomListener>()
  private statusListeners = new Set<(s: RoomStatus) => void>()
  private mine: PresenceState = IDLE_PRESENCE
  private lastSent = 0
  private presenceTimer: ReturnType<typeof setTimeout> | null = null
  /** Closed for good (closed by us, or kicked). */
  private done = false

  constructor(private readonly opts: RoomClientOptions) {
    this.ws = new ReconnectingWebSocket(opts.url, undefined, {
      WebSocket: opts.WebSocket,
      minReconnectionDelay: opts.minDelayMs ?? 500,
      maxReconnectionDelay: opts.maxDelayMs ?? 10_000,
      reconnectionDelayGrowFactor: 2,
      // Presence is resent on open; nothing stale is queued.
      maxEnqueuedMessages: 0,
      shouldReconnectOnClose: (e) => e.code !== KICK_CODE,
    })
    this.ws.onopen = () => this.setStatus("open")
    this.ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return
      const msg = parseRoomMessage(e.data)
      if (msg) this.receive(msg)
    }
    this.ws.onclose = () => {
      // Whoever was here may have gone while we were away; `hello` refills it.
      this.presence.clear()
      this.you = null
      this.setStatus(this.done ? "closed" : "connecting")
    }
  }

  /** Every message, after the client's own state is updated. Returns an unsubscribe. */
  subscribe(listener: RoomListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStatus(listener: (s: RoomStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /**
   * Updates this tab's presence (merged into what it was) and sends it,
   * at most `presenceHz` times a second; the latest always goes out.
   */
  setPresence(patch: Partial<PresenceState>) {
    this.mine = { ...this.mine, ...patch }
    if (this.presenceTimer) return
    const gap = 1000 / (this.opts.presenceHz ?? PRESENCE_HZ)
    const wait = this.lastSent + gap - Date.now()
    if (wait <= 0) this.sendPresence()
    else
      this.presenceTimer = setTimeout(() => {
        this.presenceTimer = null
        this.sendPresence()
      }, wait)
  }

  /** Tells the room this tab is leaving (e.g. on `pagehide`). */
  leave() {
    this.sendFrame({ t: "leave" })
  }

  /** Leaves and closes the socket for good. */
  close() {
    if (this.presenceTimer) clearTimeout(this.presenceTimer)
    this.presenceTimer = null
    this.leave()
    this.done = true
    this.ws.close(1000, "closed")
    this.setStatus("closed")
  }

  private sendPresence() {
    this.lastSent = Date.now()
    this.sendFrame({ t: "presence", ...this.mine })
  }

  private sendFrame(msg: ClientMessage) {
    // Only a collaborator's connection may send (the room ignores the rest).
    if (this.you && this.status === "open") this.ws.send(JSON.stringify(msg))
  }

  private receive(msg: RoomMessage) {
    switch (msg.t) {
      case "hello":
        this.headSeq = Math.max(this.headSeq, msg.headSeq)
        this.builds.clear()
        for (const b of msg.builds) this.builds.set(buildKey(b), b)
        this.presence.clear()
        for (const p of msg.presence) this.presence.set(p.id, p)
        this.you = msg.you ?? null
        if (this.you) this.sendPresence()
        break
      case "build": {
        const evt: BuildEvent = msg
        if (isJobEnd(evt)) {
          for (const [k, b] of this.builds)
            if (b.jobId === evt.jobId) this.builds.delete(k)
        } else this.builds.set(buildKey(evt), evt)
        break
      }
      case "poke":
        this.headSeq = Math.max(this.headSeq, msg.headSeq)
        break
      case "ops":
        this.headSeq = Math.max(this.headSeq, msg.to)
        break
      case "presence": {
        const { t, ...p } = msg
        void t
        this.presence.set(p.id, p satisfies Participant)
        break
      }
      case "leave":
        this.presence.delete(msg.id)
        break
      case "kick":
        this.kicked = msg.reason
        this.done = true
        this.ws.close(KICK_CODE, "kicked")
        this.setStatus("closed")
        break
    }
    for (const l of this.listeners) l(msg, this)
  }

  private setStatus(s: RoomStatus) {
    if (this.status === s) return
    this.status = s
    for (const l of this.statusListeners) l(s)
  }
}
