import { describe, expect, it } from "vitest"
import { applyBody } from "./apply.ts"
import { BUILTIN_KINDS, BUILTIN_REL_TYPES } from "./builtins.ts"
import { keyBetween, keysAfter } from "./order-key.ts"
import {
  VIEW_TYPE_IDS,
  VIEW_TYPES,
  parsePersonalSettings,
  parseSharedSettings,
} from "./view-types.ts"
import { seeded } from "./test/harness.ts"

const AT = "2026-09-02T00:00:00.000Z"

describe("View Type settings", () => {
  it("has shared and personal schemas for all 11 View Types", () => {
    expect(VIEW_TYPE_IDS).toHaveLength(11)
    for (const id of VIEW_TYPE_IDS) {
      expect(VIEW_TYPES[id].version).toBe(1)
      expect(parsePersonalSettings(id).success).toBe(true)
    }
  })

  it("accepts the per-View overrides on every View Type", () => {
    const overrides = {
      placement: { a: "b" },
      order: { b: ["a", "c"] },
      hide: ["d"],
      fold: { b: ["e"] },
    }
    const minimal: Record<string, Record<string, unknown>> = {
      "comparison-table": { rows: {}, columns: [{ criteria: "auto" }] },
      outline: { relationshipTypes: [] },
      evidence: { supports: [], challenges: [], claimKinds: [] },
      "cause-and-effect": {
        mode: "risk",
        positive: [],
        negative: [],
        outcomes: [],
        levers: {},
      },
      map: {},
      timeline: { lanes: [] },
      anatomy: { roots: [], containment: [], pins: [] },
      "learning-path": { relationshipTypes: [] },
      lineage: { relationshipTypes: [] },
      quadrant: { x: "a", y: "b" },
      rates: { group: "g", low: "l", high: "h", direction: "d" },
    }
    for (const id of VIEW_TYPE_IDS) {
      expect(parseSharedSettings(id, minimal[id]).success, id).toBe(true)
      expect(
        parseSharedSettings(id, { ...minimal[id], ...overrides }).success,
        id
      ).toBe(true)
      expect(
        parseSharedSettings(id, { ...minimal[id], unknownKnob: 1 }).success,
        id
      ).toBe(false)
    }
  })

  it("replaces fold-by-Relationship-Type with the explicit fold map", () => {
    const base = {
      mode: "risk",
      positive: [],
      negative: [],
      outcomes: [],
      levers: {},
    }
    expect(
      parseSharedSettings("cause-and-effect", { ...base, fold: ["part-of"] })
        .success
    ).toBe(false)
    expect(
      parseSharedSettings("cause-and-effect", {
        ...base,
        fold: { lever: ["step"] },
      }).success
    ).toBe(true)
  })

  it("personal settings default from the schema only", () => {
    expect(parsePersonalSettings("learning-path").data).toEqual({
      showAllSteps: false,
      hideRead: false,
    })
    expect(parsePersonalSettings("outline", { hideRead: true }).data).toEqual({
      hideRead: true,
    })
    expect(parsePersonalSettings("map").data).toEqual({})
  })
})

describe("path-level view.set", () => {
  it("edits to different paths by different people do not collide", () => {
    const s = seeded().state
    // Two concurrent edits, applied in either order, keep both entries.
    const a = {
      kind: "view.set",
      target: "outline",
      path: "settings.placement.leaf",
      value: "topic",
    } as const
    const b = {
      kind: "view.set",
      target: "outline",
      path: "settings.placement.black",
      value: "green",
    } as const
    const ab = applyBody(applyBody(s, a, AT), b, AT)
    const ba = applyBody(applyBody(s, b, AT), a, AT)
    expect(ab.views.outline.settings.placement).toEqual({
      leaf: "topic",
      black: "green",
    })
    expect(ba.views.outline).toEqual(ab.views.outline)
  })

  it("the same path is last writer wins, and null removes the entry", () => {
    const s = seeded().state
    let n = applyBody(
      s,
      {
        kind: "view.set",
        target: "outline",
        path: "settings.order.topic",
        value: ["green", "black"],
      },
      AT
    )
    n = applyBody(
      n,
      {
        kind: "view.set",
        target: "outline",
        path: "settings.order.topic",
        value: ["black", "green"],
      },
      AT
    )
    expect(n.views.outline.settings.order).toEqual({
      topic: ["black", "green"],
    })
    n = applyBody(
      n,
      {
        kind: "view.set",
        target: "outline",
        path: "settings.order.topic",
        value: null,
      },
      AT
    )
    expect(n.views.outline.settings.order).toEqual({})
  })

  it("validates the result against the View Type schema", () => {
    const s = seeded().state
    expect(() =>
      applyBody(
        s,
        {
          kind: "view.set",
          target: "outline",
          path: "settings.placement.leaf",
          value: 3,
        },
        AT
      )
    ).toThrow()
    expect(() =>
      applyBody(
        s,
        {
          kind: "view.set",
          target: "outline",
          path: "settings.relationshipTypes",
          value: null,
        },
        AT
      )
    ).toThrow()
    expect(() =>
      applyBody(
        s,
        {
          kind: "view.set",
          target: "outline",
          path: "settings.bogus",
          value: 1,
        },
        AT
      )
    ).toThrow()
  })
})

describe("built-ins", () => {
  it("ships 16 Kinds and 18 Relationship Types with stable ids", () => {
    expect(BUILTIN_KINDS).toHaveLength(16)
    expect(BUILTIN_REL_TYPES).toHaveLength(18)
    expect(
      BUILTIN_REL_TYPES.find((r) => r.id === "builtin:corrects")?.inverseLabel
    ).toBe("is corrected by")
    for (const d of [...BUILTIN_KINDS, ...BUILTIN_REL_TYPES])
      expect(d.id).toMatch(/^builtin:[a-z-]+$/)
  })
})

describe("order keys", () => {
  it("makes keys between any two", () => {
    const keys = keysAfter(null, 30)
    expect([...keys].sort()).toEqual(keys)
    const mid = keyBetween(keys[3], keys[4])
    expect(mid > keys[3] && mid < keys[4]).toBe(true)
    expect(keyBetween(null, keys[0]) < keys[0]).toBe(true)
  })
})
