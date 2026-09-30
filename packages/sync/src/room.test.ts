import type { BuildEvent, RoomMessage } from "@seply/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RoomClient, roomUrl } from "./room.ts"

class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  open() {
    this.onopen?.()
  }
  send(msg: RoomMessage | string) {
    this.onmessage?.({
      data: typeof msg === "string" ? msg : JSON.stringify(msg),
    })
  }
  drop() {
    this.onclose?.()
  }
  close() {
    this.closed = true
    this.onclose?.()
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
  it("keeps the running builds and head seq from hello, build and poke", () => {
    const room = new RoomClient({
      url: "ws://x/live",
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    })
    const seen: string[] = []
    room.subscribe((m) => seen.push(m.t))
    const ws = FakeSocket.all[0]!
    ws.open()
    expect(room.status).toBe("open")

    ws.send({ t: "hello", headSeq: 4, presence: [], builds: [evt({})] })
    expect(room.headSeq).toBe(4)
    expect([...room.builds.keys()]).toEqual(["J"])

    ws.send({ t: "build", ...evt({ viewId: "V", status: "building" }) })
    ws.send({ t: "poke", headSeq: 6 })
    expect(room.headSeq).toBe(6)
    expect([...room.builds.keys()]).toEqual(["J", "J/V"])

    ws.send({ t: "build", ...evt({ status: "complete", progress: 1 }) })
    expect(room.builds.size).toBe(0)

    ws.send("not json")
    ws.send(JSON.stringify({ t: "mystery" }))
    expect(seen).toEqual(["hello", "build", "poke", "build"])
  })

  it("reconnects with backoff until closed", () => {
    vi.useFakeTimers()
    const room = new RoomClient({
      url: "ws://x/live",
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      minDelayMs: 100,
    })
    const statuses: string[] = []
    room.onStatus((s) => statuses.push(s))
    FakeSocket.all[0]!.open()
    FakeSocket.all[0]!.drop()
    expect(room.status).toBe("connecting")
    vi.advanceTimersByTime(99)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1]!.drop()
    vi.advanceTimersByTime(199)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)

    room.close()
    expect(FakeSocket.all[2]!.closed).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.all).toHaveLength(3)
    expect(statuses).toEqual(["open", "connecting", "closed"])
  })
})
