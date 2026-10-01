import type { Participant } from "@seply/domain"
import { KIND_HUES } from "@seply/ui/lib/kinds"
import { describe, expect, it } from "vitest"

import {
  avatarsOf,
  cursorAt,
  cursorsOn,
  hueFor,
  placeCursor,
} from "@/expedition/presence.ts"

const p = (over: Partial<Participant>): Participant => ({
  id: "p1",
  userId: "ed",
  name: "Ed",
  view: "v1",
  cursor: null,
  selection: [],
  ...over,
})

describe("hueFor", () => {
  it("is one of the Kind hues, the same every time", () => {
    expect(KIND_HUES).toContain(hueFor("ed"))
    expect(hueFor("ed")).toBe(hueFor("ed"))
  })
})

describe("avatarsOf", () => {
  it("shows one avatar per person, not me, agents last", () => {
    const avatars = avatarsOf(
      [
        p({ id: "a", userId: "ed", view: "v1" }),
        p({ id: "b", userId: "ed", view: "v2" }),
        p({ id: "c", userId: "me", name: "Me" }),
        p({
          id: "agent:me",
          userId: "me",
          name: "Claude (via MCP)",
          agent: true,
          view: null,
        }),
        p({ id: "d", userId: "ada", name: "Ada", view: "v1" }),
      ],
      "me"
    )
    expect(avatars).toEqual([
      { userId: "ada", name: "Ada", agent: false, views: ["v1"] },
      { userId: "ed", name: "Ed", agent: false, views: ["v1", "v2"] },
      { userId: "me", name: "Claude (via MCP)", agent: true, views: [] },
    ])
  })
})

describe("cursors", () => {
  it("shows others pointing on this View only", () => {
    const here = p({ id: "a", cursor: { x: 0.5, y: 0.5 } })
    const list = [
      here,
      p({ id: "b", view: "v2", cursor: { x: 0.5, y: 0.5 } }),
      p({ id: "c" }),
      p({ id: "d", userId: "me", cursor: { x: 0.5, y: 0.5 } }),
    ]
    expect(cursorsOn(list, "v1", "me")).toEqual([here])
    expect(cursorsOn(list, null, "me")).toEqual([])
  })

  it("lands on the same Concept, wherever it is drawn", () => {
    const pane = { left: 100, top: 50, width: 1000, height: 500 }
    const sent = cursorAt({ x: 600, y: 300 }, pane, {
      id: "c1",
      box: { left: 550, top: 280, width: 200, height: 40 },
    })
    expect(sent).toEqual({ x: 0.5, y: 0.5, on: { id: "c1", x: 0.25, y: 0.5 } })

    // Another reader's pane, with c1 panned elsewhere.
    const theirPane = { left: 0, top: 0, width: 800, height: 400 }
    const at = placeCursor(sent, theirPane, (id) =>
      id === "c1" ? { left: 100, top: 100, width: 400, height: 80 } : null
    )
    expect(at).toEqual({ x: 200, y: 140 })
    // Not on their screen: the same place in the pane.
    expect(placeCursor(sent, theirPane, () => null)).toEqual({ x: 400, y: 200 })
  })
})
