import type { BuildEvent, Participant, RoomMessage } from "@seply/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RoomClient, roomUrl } from "./room.ts"

/** A WebSocket stand-in for partysocket: event listeners and readyState. */
class FakeSocket extends EventTarget {
  static all: FakeSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readyState = 0
  binaryType = "blob"
  sent: unknown[] = []
  constructor(readonly url: string) {
    super()
    FakeSocket.all.push(this)
  }
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event("open"))
  }
  /** A frame from the server. */
  push(msg: RoomMessage | string) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: typeof msg === "string" ? msg : JSON.stringify(msg),
      })
    )
  }
  /** The server went away. */
  drop(code = 1006) {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event("close"), { code }))
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
  }
}

const evt = (over: Partial<BuildEvent>): BuildEvent => ({
  jobId: "J",
  kind: "fake",
  status: "running",
  step: "Working",
  progress: 0.5,
  at: "2026-09-30T00:00:00.000Z",
  ...over,
})

const ed: Participant = {
  id: "p-ed",
  userId: "ed",
  name: "Ed",
  view: "v1",
  cursor: { x: 0.5, y: 0.5 },
  selection: [],
}

/** Lets partysocket's connect (a promise chain) run. */
const tick = () => vi.advanceTimersByTimeAsync(0)

async function openRoom(
  over: Partial<ConstructorParameters<typeof RoomClient>[0]> = {}
) {
  const room = new RoomClient({
    url: "ws://x/live",
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    ...over,
  })
  await tick()
  const ws = FakeSocket.all.at(-1)!
  ws.open()
  return { room, ws }
}

afterEach(() => {
  FakeSocket.all = []
  vi.useRealTimers()
})

describe("roomUrl", () => {
  it("uses ws or wss on the same origin", () => {
    expect(roomUrl("E1", "https://learn.seply.dev")).toBe(
      "wss://learn.seply.dev/api/expeditions/E1/live"
    )
    expect(roomUrl("E1", "http://localhost:8788")).toBe(
      "ws://localhost:8788/api/expeditions/E1/live"
    )
  })
})

describe("RoomClient", () => {
  it("keeps the running builds and head seq from hello, build, ops and poke", async () => {
    vi.useFakeTimers()
    const { room, ws } = await openRoom()
    const seen: string[] = []
    room.subscribe((m) => seen.push(m.t))
    expect(room.status).toBe("open")

    ws.push({ t: "hello", headSeq: 4, presence: [], builds: [evt({})] })
    expect(room.headSeq).toBe(4)
    expect([...room.builds.keys()]).toEqual(["J"])

    ws.push({ t: "build", ...evt({ viewId: "V", status: "building" }) })
    ws.push({ t: "poke", headSeq: 6 })
    expect(room.headSeq).toBe(6)
    expect([...room.builds.keys()]).toEqual(["J", "J/V"])
    ws.push({
      t: "ops",
      from: 6,
      to: 7,
      ops: [{ opId: "o7", serverSeq: 7 } as never],
    })
    expect(room.headSeq).toBe(7)

    ws.push({ t: "build", ...evt({ status: "complete", progress: 1 }) })
    expect(room.builds.size).toBe(0)
    ws.push("not json")
    ws.push(JSON.stringify({ t: "mystery" }))
    expect(seen).toEqual(["hello", "build", "poke", "ops", "build"])
    room.close()
  })

  it("keeps everyone else's presence, and sends its own throttled", async () => {
    vi.useFakeTimers()
    const { room, ws } = await openRoom({ presenceHz: 10 })
    room.setPresence({ view: "v0" })
    // Not a collaborator yet (no hello): nothing goes out.
    expect(ws.sent).toEqual([])

    ws.push({ t: "hello", headSeq: 0, presence: [ed], builds: [], you: "me" })
    expect([...room.presence.keys()]).toEqual(["p-ed"])
    // Hello sends the presence set so far.
    expect(ws.sent).toEqual([
      { t: "presence", view: "v0", cursor: null, selection: [] },
    ])

    room.setPresence({ cursor: { x: 0.1, y: 0.2 } })
    room.setPresence({ cursor: { x: 0.3, y: 0.4 } })
    expect(ws.sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(ws.sent).toHaveLength(2)
    expect(ws.sent[1]).toMatchObject({ view: "v0", cursor: { x: 0.3, y: 0.4 } })

    ws.push({ t: "presence", ...ed, view: "v2" })
    expect(room.presence.get("p-ed")?.view).toBe("v2")
    ws.push({ t: "leave", id: "p-ed" })
    expect(room.presence.size).toBe(0)

    room.close()
    expect(ws.sent.at(-1)).toEqual({ t: "leave" })
  })

  it("sends nothing when the room greets it without an id (a reader)", async () => {
    vi.useFakeTimers()
    const { room, ws } = await openRoom()
    ws.push({ t: "hello", headSeq: 0, presence: [], builds: [] })
    room.setPresence({ view: "v1" })
    await vi.advanceTimersByTimeAsync(1000)
    room.close()
    expect(ws.sent).toEqual([])
  })

  it("reconnects with backoff until closed, forgetting presence meanwhile", async () => {
    vi.useFakeTimers()
    const { room, ws } = await openRoom({ minDelayMs: 100 })
    const statuses: string[] = []
    room.onStatus((s) => statuses.push(s))
    ws.push({ t: "hello", headSeq: 0, presence: [ed], builds: [], you: "me" })
    ws.drop()
    expect(room.status).toBe("connecting")
    expect(room.presence.size).toBe(0)
    expect(room.you).toBeNull()
    await vi.advanceTimersByTimeAsync(99)
    expect(FakeSocket.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1]!.drop()
    await vi.advanceTimersByTimeAsync(199)
    expect(FakeSocket.all).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all).toHaveLength(3)
    FakeSocket.all[2]!.open()

    room.close()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(FakeSocket.all).toHaveLength(3)
    expect(statuses).toEqual(["connecting", "open", "closed"])
  })

  it("stops for good when kicked", async () => {
    vi.useFakeTimers()
    const { room, ws } = await openRoom({ minDelayMs: 100 })
    const seen: string[] = []
    room.subscribe((m) => seen.push(m.t))
    ws.push({ t: "kick", reason: "You were removed" })
    ws.drop(4001)
    expect(room.kicked).toBe("You were removed")
    expect(room.status).toBe("closed")
    await vi.advanceTimersByTimeAsync(20_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(seen).toEqual(["kick"])
  })
})
