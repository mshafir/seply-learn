import { describe, expect, it } from "vitest"

import { detailsChanges } from "@/expedition/editing.ts"

describe("the Expedition's details", () => {
  const before = {
    title: "Swiss rail",
    summary: "Trains.",
    tags: ["travel", "synthetic"],
  }

  it("saves only what changed", () => {
    expect(detailsChanges(before, { ...before })).toEqual({})
    expect(
      detailsChanges(before, { ...before, tags: ["synthetic", "travel"] })
    ).toEqual({})
    expect(
      detailsChanges(before, {
        title: " Swiss rail ",
        summary: "Trains, briefly. ",
        tags: ["travel"],
      })
    ).toEqual({ summary: "Trains, briefly.", tags: ["travel"] })
  })

  it("never saves an empty title, and clears the summary", () => {
    expect(
      detailsChanges(before, { title: "  ", summary: "", tags: before.tags })
    ).toEqual({ summary: "" })
  })
})
