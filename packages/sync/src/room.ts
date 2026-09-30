// The Expedition room client (spec §2.4): one WebSocket to
// `/api/expeditions/:id/live`, reconnecting with backoff, that keeps the
// latest `build` event of each running job and View and the head seq, and
// tells listeners about every message. Minimal for WP-3.2 (`hello`, `build`,
// `poke`); WP-4.1 moves it onto partysocket and adds `ops` and presence.
import {
  buildKey,
  parseRoomMessage,
  TERMINAL_JOB_STATUSES,
  type BuildEvent,
  type JobStatus,
  type RoomMessage,
} from "@seply/domain"

export type RoomStatus = "connecting" | "open" | "closed"

export type RoomClientOptions = {
  /** `ws:` or `wss:` URL of the room; see `roomUrl`. */
  url: string
  /** Defaults to the global WebSocket. */
  WebSocket?: typeof WebSocket
  /** First reconnect delay, doubled up to `maxDelayMs` (default 500 ms, 10 s). */
  minDelayMs?: number
  maxDelayMs?: number
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

const isJobEnd = (evt: BuildEvent) =>
  !evt.viewId && TERMINAL_JOB_STATUSES.includes(evt.status as JobStatus)

export class RoomClient {
  /** The latest event of each running job and each View it builds, by `buildKey`. */
  readonly builds = new Map<string, BuildEvent>()
  headSeq = 0
  status: RoomStatus = "connecting"

  private ws: WebSocket | null = null
  private listeners = new Set<RoomListener>()
  private statusListeners = new Set<(s: RoomStatus) => void>()
  private delay: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(private readonly opts: RoomClientOptions) {
    this.delay = opts.minDelayMs ?? 500
    this.connect()
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

  /** Closes the socket for good. */
  close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close(1000, "closed")
    this.setStatus("closed")
  }

  private connect() {
    if (this.closed) return
    const WS = this.opts.WebSocket ?? WebSocket
    this.setStatus("connecting")
    const ws = new WS(this.opts.url)
    this.ws = ws
    ws.onopen = () => {
      this.delay = this.opts.minDelayMs ?? 500
      this.setStatus("open")
    }
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return
      const msg = parseRoomMessage(e.data)
      if (msg) this.receive(msg)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.closed) return
      this.setStatus("connecting")
      this.timer = setTimeout(() => this.connect(), this.delay)
      this.delay = Math.min(this.delay * 2, this.opts.maxDelayMs ?? 10_000)
    }
  }

  private receive(msg: RoomMessage) {
    switch (msg.t) {
      case "hello":
        this.headSeq = Math.max(this.headSeq, msg.headSeq)
        this.builds.clear()
        for (const b of msg.builds) this.builds.set(buildKey(b), b)
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
    }
    for (const l of this.listeners) l(msg, this)
  }

  private setStatus(s: RoomStatus) {
    if (this.status === s) return
    this.status = s
    for (const l of this.statusListeners) l(s)
  }
}
