import { describe, expect, it } from "vitest"
import type { LoggedOp } from "./history.ts"
import { opsMessage, parseClientMessage, parseRoomMessage } from "./room.ts"

const op = (serverSeq: number, size = 0) =>
  ({
    opId: `op${serverSeq}`,
    serverSeq,
    pad: "x".repeat(size),
  }) as unknown as LoggedOp

describe("opsMessage", () => {
  it("sends a small contiguous batch as ops after the head it follows", () => {
    expect(opsMessage([op(4), op(5)])).toEqual({
      t: "ops",
      from: 3,
      to: 5,
      ops: [op(4), op(5)],
    })
  })

  it("pokes for a large batch or a gap", () => {
    expect(opsMessage([op(4, 100), op(5, 100)], 150)).toEqual({
      t: "poke",
      headSeq: 5,
    })
    expect(opsMessage([op(4), op(6)])).toEqual({ t: "poke", headSeq: 6 })
    expect(opsMessage([])).toBeNull()
  })

  it("round-trips through the parser", () => {
    const msg = opsMessage([op(1)])!
    expect(parseRoomMessage(JSON.stringify(msg))).toEqual(msg)
    expect(
      parseRoomMessage(JSON.stringify({ t: "ops", from: 0, to: 1, ops: [{}] }))
    ).toBeNull()
  })
})

describe("client messages", () => {
  it("accepts presence and leave, and nothing else", () => {
    const presence = {
      t: "presence",
      view: "v1",
      cursor: { x: 0.2, y: 0.4, on: { id: "c1", x: 0.5, y: 0.5 } },
      selection: ["c1"],
      editing: "c1",
    }
    expect(parseClientMessage(JSON.stringify(presence))).toEqual(presence)
    expect(parseClientMessage('{"t":"leave"}')).toEqual({ t: "leave" })
    expect(parseClientMessage('{"t":"ops"}')).toBeNull()
    expect(parseClientMessage("{")).toBeNull()
    expect(
      parseClientMessage(
        JSON.stringify({ ...presence, cursor: { x: "a", y: 0 } })
      )
    ).toBeNull()
  })
})
