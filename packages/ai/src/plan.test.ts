import { parseSharedSettings, VIEW_TYPE_IDS } from "@seply/domain"
import { describe, expect, it } from "vitest"
import { startingSettings } from "./plan.ts"

describe("startingSettings", () => {
  it("is valid for every View Type, and a fresh copy each time", () => {
    for (const t of VIEW_TYPE_IDS) {
      expect(parseSharedSettings(t, startingSettings(t)).success, t).toBe(true)
    }
    const a = startingSettings("outline")
    ;(a.relationshipTypes as string[]).push("x")
    expect(startingSettings("outline").relationshipTypes).toEqual(["builtin:part-of"])
  })
})
