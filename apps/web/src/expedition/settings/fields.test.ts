import { describe, expect, it } from "vitest"
import { VIEW_TYPES, VIEW_TYPE_IDS } from "@seply/domain"

import {
  getAt,
  parseTags,
  setAt,
  settingsFields,
  type SettingsField,
} from "./fields.ts"

const byKey = (fields: SettingsField[]) =>
  Object.fromEntries(fields.map((f) => [f.path.join("."), f]))

describe("settingsFields", () => {
  it("reads Learning path's shared schema", () => {
    const spec = VIEW_TYPES["learning-path"]
    const f = byKey(settingsFields(spec.shared, spec.refs))
    expect(Object.keys(f)).toEqual([
      "relationshipTypes",
      "targets",
      "minSteps",
      "coreShared",
    ])
    expect(f.relationshipTypes!.control).toEqual({
      type: "refs",
      ref: "relTypes",
    })
    expect(f.minSteps!.optional).toBe(true)
    expect(f.minSteps!.control).toEqual({
      type: "number",
      integer: true,
      min: 0,
    })
    expect(f.coreShared!.control).toMatchObject({ type: "number", min: 1 })
    const targets = f.targets!.control
    expect(targets.type).toBe("group")
    if (targets.type !== "group") return
    const t = byKey(targets.fields)
    expect(t["targets.kinds"]!.control).toEqual({ type: "refs", ref: "kinds" })
    expect(t["targets.tags"]!.control).toEqual({ type: "tags" })
    expect(t["targets.hasAttribute"]!.control).toEqual({
      type: "ref",
      ref: "attributes",
    })
  })

  it("leaves the structure overrides out", () => {
    for (const id of VIEW_TYPE_IDS) {
      const keys = settingsFields(VIEW_TYPES[id].shared).map((f) => f.path[0])
      for (const k of ["placement", "order", "hide", "fold"])
        expect(keys).not.toContain(k)
    }
  })

  it("maps enums, single refs and what it can't draw", () => {
    const ce = VIEW_TYPES["cause-and-effect"]
    const f = byKey(settingsFields(ce.shared, ce.refs))
    expect(f.mode!.control).toEqual({
      type: "enum",
      options: ["mechanism", "risk"],
    })
    expect(f.outcomes!.control).toEqual({ type: "refs", ref: "concepts" })
    const map = VIEW_TYPES.map
    expect(byKey(settingsFields(map.shared, map.refs)).home!.control).toEqual({
      type: "ref",
      ref: "concepts",
    })
    const ct = VIEW_TYPES["comparison-table"]
    expect(byKey(settingsFields(ct.shared, ct.refs)).columns!.control).toEqual({
      type: "json",
    })
    const tl = VIEW_TYPES.timeline
    const tf = byKey(settingsFields(tl.shared, tl.refs))
    expect(tf.lanes!.control).toEqual({ type: "json" })
    expect(tf.focus!.control).toEqual({ type: "json" })
  })

  it("reads personal settings with their defaults", () => {
    const f = settingsFields(VIEW_TYPES["learning-path"].personal)
    expect(f).toEqual([
      {
        path: ["showAllSteps"],
        label: "Show all steps",
        optional: true,
        defaultValue: false,
        control: { type: "boolean" },
      },
      {
        path: ["hideRead"],
        label: "Hide what I've read",
        optional: true,
        defaultValue: false,
        control: { type: "boolean" },
      },
    ])
    expect(settingsFields(VIEW_TYPES.evidence.personal)).toEqual([])
  })
})

describe("paths", () => {
  it("gets and sets nested values without touching the original", () => {
    const s = { rows: { kinds: ["a"] }, sortBy: "x" }
    expect(getAt(s, ["rows", "kinds"])).toEqual(["a"])
    expect(getAt(s, ["rows", "tags"])).toBeUndefined()
    const t = setAt(s, ["rows", "tags"], ["t"])
    expect(t).toEqual({ rows: { kinds: ["a"], tags: ["t"] }, sortBy: "x" })
    expect(s.rows).toEqual({ kinds: ["a"] })
    expect(setAt(s, ["sortBy"], undefined)).toEqual({ rows: { kinds: ["a"] } })
  })

  it("parses tags", () => {
    expect(parseTags(" #a, b,,a , c ")).toEqual(["a", "b", "c"])
    expect(parseTags("")).toEqual([])
  })
})
