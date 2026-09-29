import { describe, expect, it } from "vitest"

import { resumeFrom, samePlace } from "@/expedition/continue.ts"

const pos = (over: Partial<Parameters<typeof samePlace>[0] & object> = {}) => ({
  expeditionId: "e1",
  viewId: "v1",
  focusConceptId: "c1",
  step: null,
  panelDepth: "article" as const,
  at: "2026-09-01T00:00:00.000Z",
  ...over,
})
const all = () => true
const none = () => false

describe("resumeFrom", () => {
  it("lands on the saved View with the Concept open at its depth", () => {
    expect(resumeFrom(pos(), all, all)).toEqual({
      viewId: "v1",
      stack: [{ conceptId: "c1", depth: "article" }],
    })
  })

  it("drops what no longer exists", () => {
    expect(resumeFrom(pos(), none, all)).toEqual({
      viewId: null,
      stack: [{ conceptId: "c1", depth: "article" }],
    })
    expect(resumeFrom(pos(), all, none)).toEqual({ viewId: "v1", stack: null })
    expect(resumeFrom(pos(), none, none)).toBeNull()
  })

  it("defaults the depth to the overview, and needs a position", () => {
    expect(resumeFrom(pos({ panelDepth: null }), all, all)?.stack).toEqual([
      { conceptId: "c1", depth: "overview" },
    ])
    expect(resumeFrom(null, all, all)).toBeNull()
  })
})

describe("samePlace", () => {
  it("compares View, Concept and depth", () => {
    const place = { viewId: "v1", focusConceptId: "c1", panelDepth: "article" as const }
    expect(samePlace(pos(), place)).toBe(true)
    expect(samePlace(pos(), { ...place, panelDepth: "overview" })).toBe(false)
    expect(samePlace(null, place)).toBe(false)
  })
})
