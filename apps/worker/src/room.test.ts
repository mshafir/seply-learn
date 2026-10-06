// The room's protocol over a fake Durable Object context: sockets with tags
// and attachments, storage and an alarm. "Hibernation" is a new room
// instance over the same context: nothing may live in memory.
import {
  parseRoomMessage,
  type LoggedOp,
  type RoomMessage,
  type RoomOps,
} from "@seply/domain"
import type { RoomJoin } from "@seply/server"
import { beforeEach, describe, expect, it } from "vitest"
import { ExpeditionRoom, KICK_CODE } from "./room.ts"

class FakeSocket {
  sent: RoomMessage[] = []
  closed: { code: number; reason: string } | null = null
  private attachment: unknown = null
  send(data: string) {
    if (this.closed) throw new Error("closed")
    this.sent.push(parseRoomMessage(data)!)
  }
  close(code: number, reason: string) {
    this.closed ??= { code, reason }
  }
  serializeAttachment(v: unknown) {
    this.attachment = structuredClone(v)
  }
  deserializeAttachment() {
    return structuredClone(this.attachment)
  }
  /** Messages of one type, in order. */
  of<T extends RoomMessage["t"]>(t: T) {
    return this.sent.filter((m) => m.t === t) as Extract<
      RoomMessage,
      { t: T }
    >[]
  }
}

class FakeContext {
  sockets: { ws: FakeSocket; tags: string[] }[] = []
  data = new Map<string, unknown>()
  alarmAt: number | null = null
  acceptWebSocket(ws: FakeSocket, tags: string[]) {
    this.sockets.push({ ws, tags })
  }
  getWebSockets(tag?: string) {
    return this.sockets
      .filter((s) => !s.ws.closed && (!tag || s.tags.includes(tag)))
      .map((s) => s.ws)
  }
  storage = {
    get: async (k: string) => structuredClone(this.data.get(k)),
    put: async (k: string, v: unknown) => void this.data.set(k, v),
    delete: async (k: string | string[]) => {
      for (const key of [k].flat()) this.data.delete(key)
    },
    list: async ({ prefix }: { prefix: string }) =>
      new Map([...this.data].filter(([k]) => k.startsWith(prefix)).sort()),
    setAlarm: async (at: number) => void (this.alarmAt = at),
    deleteAlarm: async () => void (this.alarmAt = null),
  }
}

let ctx: FakeContext
/** A room instance: a new one models the object waking from hibernation. */
const room = () => new ExpeditionRoom(ctx as never, {} as never)

const join = (
  userId: string | null,
  access: RoomJoin["access"],
  headSeq = 3,
  role: RoomJoin["role"] = access === "collaborator" ? "editor" : null
): RoomJoin => ({
  expeditionId: "exp",
  userId,
  name: userId ? userId.toUpperCase() : "",
  access,
  role,
  headSeq,
})

async function connect(j: RoomJoin) {
  const ws = new FakeSocket()
  await room().join(ws as unknown as WebSocket, j)
  return ws
}

const say = (ws: FakeSocket, msg: unknown) =>
  room().webSocketMessage(ws as unknown as WebSocket, JSON.stringify(msg))

const here = (view: string, x = 0.5) => ({
  t: "presence",
  view,
  cursor: { x, y: 0.25, on: { id: "c1", x: 0.1, y: 0.9 } },
  selection: ["c1"],
})

const op = (serverSeq: number): LoggedOp =>
  ({ opId: `op${serverSeq}`, serverSeq }) as LoggedOp

beforeEach(() => {
  ctx = new FakeContext()
})

describe("the Expedition room", () => {
  it("greets a collaborator with the others' presence and their own id", async () => {
    const ada = await connect(join("ada", "collaborator"))
    const [hello] = ada.of("hello")
    expect(hello).toMatchObject({ headSeq: 3, presence: [], builds: [] })
    expect(hello!.you).toBeTruthy()
    await say(ada, here("v1"))

    const ed = await connect(join("ed", "collaborator", 5))
    const [edHello] = ed.of("hello")
    expect(edHello!.headSeq).toBe(5)
    expect(edHello!.presence).toEqual([
      {
        id: hello!.you,
        userId: "ada",
        name: "ADA",
        view: "v1",
        cursor: { x: 0.5, y: 0.25, on: { id: "c1", x: 0.1, y: 0.9 } },
        selection: ["c1"],
      },
    ])
  })

  it("fans presence out to the other collaborators only, and leave on close", async () => {
    const ada = await connect(join("ada", "collaborator"))
    const ed = await connect(join("ed", "collaborator"))
    const eve = await connect(join("eve", "reader"))
    const anon = await connect(join(null, "anonymous"))
    await say(ed, here("v2", 0.75))
    expect(ada.of("presence")).toEqual([
      expect.objectContaining({ t: "presence", userId: "ed", view: "v2" }),
    ])
    expect(ed.of("presence")).toEqual([])
    expect(eve.of("presence")).toEqual([])
    expect(anon.of("presence")).toEqual([])

    const edId = ed.of("hello")[0]!.you
    await room().webSocketClose(ed as unknown as WebSocket, 1001, "gone")
    expect(ada.of("leave")).toEqual([{ t: "leave", id: edId }])
    expect(eve.of("leave")).toEqual([])
  })

  it("ignores presence from readers and anonymous readers, and junk", async () => {
    const ada = await connect(join("ada", "collaborator"))
    const eve = await connect(join("eve", "reader"))
    const anon = await connect(join(null, "anonymous"))
    expect(eve.of("hello")[0]!.you).toBeUndefined()
    expect(anon.of("hello")[0]!.you).toBeUndefined()
    await say(eve, here("v1"))
    await say(anon, here("v1"))
    await say(ada, { t: "presence", view: 3 })
    await room().webSocketMessage(ada as unknown as WebSocket, "not json")
    await room().webSocketMessage(
      ada as unknown as WebSocket,
      JSON.stringify({ ...here("v1"), selection: ["x".repeat(5000)] })
    )
    const ed = await connect(join("ed", "collaborator"))
    expect(ed.of("hello")[0]!.presence).toEqual([])
    expect(ada.of("presence")).toEqual([])
  })

  it("says leave once, when the client leaves before closing", async () => {
    const ada = await connect(join("ada", "collaborator"))
    const ed = await connect(join("ed", "collaborator"))
    await say(ed, here("v1"))
    await say(ed, { t: "leave" })
    await room().webSocketClose(ed as unknown as WebSocket, 1000, "bye")
    expect(ada.of("leave")).toHaveLength(1)
  })

  it("sends ops and pokes to everyone, builds to the signed in only", async () => {
    const ada = await connect(join("ada", "collaborator"))
    const eve = await connect(join("eve", "reader"))
    const anon = await connect(join(null, "anonymous"))
    const msg: RoomOps = { t: "ops", from: 3, to: 5, ops: [op(4), op(5)] }
    await room().ops(msg)
    await room().poke(9)
    await room().build({
      jobId: "j1",
      kind: "fake",
      status: "running",
      step: "Building",
      progress: 0.5,
      at: new Date().toISOString(),
    })
    for (const ws of [ada, eve, anon]) {
      expect(ws.of("ops")).toEqual([msg])
      expect(ws.of("poke")).toEqual([{ t: "poke", headSeq: 9 }])
    }
    expect(ada.of("build")).toHaveLength(1)
    expect(eve.of("build")).toHaveLength(1)
    expect(anon.of("build")).toHaveLength(0)
    // The head seq is kept for latecomers; anonymous readers get no builds.
    const late = await connect(join(null, "anonymous", 2))
    expect(late.of("hello")[0]).toMatchObject({ headSeq: 9, builds: [] })
    const lateEve = await connect(join("eve", "reader", 2))
    expect(lateEve.of("hello")[0]!.builds).toHaveLength(1)
  })

  it("kicks a user's sockets, or every non-collaborator's", async () => {
    const ada = await connect(join("ada", "collaborator"))
    const ed1 = await connect(join("ed", "collaborator"))
    const ed2 = await connect(join("ed", "collaborator"))
    const eve = await connect(join("eve", "reader"))
    const anon = await connect(join(null, "anonymous"))
    await say(ed1, here("v1"))
    await room().kick("ed", "You were removed")
    for (const ws of [ed1, ed2]) {
      expect(ws.of("kick")).toEqual([{ t: "kick", reason: "You were removed" }])
      expect(ws.closed?.code).toBe(KICK_CODE)
    }
    expect(ada.of("leave")).toHaveLength(1)
    expect(ada.closed).toBeNull()

    await room().kick(null, "Visibility changed")
    expect(eve.closed?.code).toBe(KICK_CODE)
    expect(anon.closed?.code).toBe(KICK_CODE)
    expect(ada.closed).toBeNull()
  })

  it("takes no ops from any client; a viewer never shows as editing", async () => {
    const ada = await connect(join("ada", "collaborator", 3, "owner"))
    const vi = await connect(join("vi", "collaborator", 3, "viewer"))
    const ed = await connect(join("ed", "collaborator", 3, "editor"))
    // Ops only come from the Worker after /push commits; a client's are junk.
    await say(vi, { t: "ops", from: 3, to: 4, ops: [op(4)] })
    await say(ed, { t: "ops", from: 3, to: 4, ops: [op(4)] })
    await say(vi, { t: "poke", headSeq: 99 })
    expect(ada.of("ops")).toEqual([])
    expect(ada.of("poke")).toEqual([])
    await say(vi, { ...here("v1"), editing: "c1" })
    await say(ed, { ...here("v1"), editing: "c1" })
    const shown = ada.of("presence")
    expect(shown.find((p) => p.userId === "vi")!.editing).toBeUndefined()
    expect(shown.find((p) => p.userId === "ed")!.editing).toBe("c1")
    // And a latecomer hears the same.
    const late = await connect(join("bo", "collaborator"))
    const seen = late.of("hello")[0]!.presence
    expect(seen.find((p) => p.userId === "vi")!.editing).toBeUndefined()
  })

  it("kicks a downgraded editor at once, mid-edit, across hibernation", async () => {
    const ada = await connect(join("ada", "collaborator", 3, "owner"))
    const ed = await connect(join("ed", "collaborator", 3, "editor"))
    await say(ed, { ...here("v1"), editing: "c1" })
    expect(ada.of("presence")[0]!.editing).toBe("c1")
    // A fresh instance (as after hibernation) still finds his socket by tag.
    await room().kick("ed", "The owner made you a viewer")
    expect(ed.of("kick")).toEqual([
      { t: "kick", reason: "The owner made you a viewer" },
    ])
    expect(ed.closed?.code).toBe(KICK_CODE)
    expect(ada.of("leave")).toEqual([
      { t: "leave", id: ed.of("hello")[0]!.you },
    ])
    // Rejoining (the screen reopens, reading his new access) he's a viewer.
    const again = await connect(join("ed", "collaborator", 3, "viewer"))
    await say(again, { ...here("v1"), editing: "c1" })
    expect(ada.of("presence").at(-1)!.editing).toBeUndefined()
  })

  it("shows an agent until its TTL runs out", async () => {
    const ada = await connect(join("ada", "collaborator"))
    await room().agentPresence({
      userId: "ada",
      label: "Claude (via MCP)",
      ttlMs: 60_000,
    })
    expect(ada.of("presence")).toEqual([
      expect.objectContaining({
        id: "agent:ada",
        name: "Claude (via MCP)",
        agent: true,
      }),
    ])
    expect(ctx.alarmAt).toBeGreaterThan(Date.now())
    const ed = await connect(join("ed", "collaborator"))
    expect(ed.of("hello")[0]!.presence.map((p) => p.id)).toEqual(["agent:ada"])

    // Not yet expired: the alarm keeps it.
    await room().alarm()
    expect(ada.of("leave")).toEqual([])
    // Expired.
    const stored = ctx.data.get("agent:ada") as { until: number }
    stored.until = Date.now() - 1
    await room().alarm()
    expect(ada.of("leave")).toEqual([{ t: "leave", id: "agent:ada" }])
    expect(ctx.alarmAt).toBeNull()
  })

  it("keeps presence across hibernation: every call is a fresh instance", async () => {
    // Each `room()` above is already a new instance; spell it out once.
    const ada = await connect(join("ada", "collaborator"))
    await say(ada, here("v1"))
    const woken = room()
    const ed = new FakeSocket()
    await woken.join(ed as unknown as WebSocket, join("ed", "collaborator"))
    expect(ed.of("hello")[0]!.presence.map((p) => p.userId)).toEqual(["ada"])
    await room().webSocketMessage(
      ed as unknown as WebSocket,
      JSON.stringify(here("v3"))
    )
    expect(ada.of("presence").at(-1)).toMatchObject({
      userId: "ed",
      view: "v3",
    })
  })
})
