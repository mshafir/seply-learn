import { describe, expect, it } from "vitest"
import { builtinId } from "./builtins.ts"
import {
  effectiveOverrides,
  higherReadingState,
  liveAttributes,
  mergeConcepts,
  removeKind,
  removeRelType,
} from "./commands.ts"
import { undoChange } from "./history.ts"
import { relKey } from "./state.ts"
import { IDEA, PART_OF, PREREQ, concept, rel, seeded } from "./test/harness.ts"

/** Seeded, plus a duplicate of "green" with its own links, tags, provenance and View overrides. */
function withDuplicate() {
  const h = seeded()
  h.commit("ana", [
    concept("matcha", "Matcha", {
      aliases: ["Powdered green tea"],
      tags: ["japan"],
      prov: [{ source: "chat1", segment: "t4" }],
    }),
    rel("matcha", PART_OF, "topic"), // duplicates green → topic: folds into it
    rel("matcha", PREREQ, "black", "contrast"), // moves to green → black
    rel("leaf", PREREQ, "matcha"), // duplicates leaf → green
    {
      kind: "concept.set",
      target: "green",
      path: "prov",
      value: [{ source: "chat1", segment: "t1" }],
    },
    {
      kind: "view.set",
      target: "outline",
      path: "settings.placement.matcha",
      value: "topic",
    },
    {
      kind: "view.set",
      target: "outline",
      path: "settings.placement.leaf",
      value: "matcha",
    },
    {
      kind: "view.set",
      target: "outline",
      path: "settings.order.topic",
      value: ["matcha", "black", "green"],
    },
    {
      kind: "view.set",
      target: "outline",
      path: "settings.order.matcha",
      value: ["leaf"],
    },
    {
      kind: "view.set",
      target: "outline",
      path: "settings.hide",
      value: ["matcha"],
    },
    {
      kind: "view.set",
      target: "outline",
      path: "settings.fold.black",
      value: ["matcha", "leaf"],
    },
  ])
  return h
}

describe("Merge", () => {
  it("moves Relationships, Tags and provenance, keeps the title as an alias, and tombstones the loser", () => {
    const h = withDuplicate()
    h.commit(
      "ana",
      mergeConcepts(h.state, "green", "matcha"),
      "merge",
      "Merged Matcha into Green tea"
    )
    const s = h.state
    expect(s.concepts.matcha.deletedAt).not.toBeNull()
    expect(s.concepts.green.aliases).toEqual(["Matcha"])
    expect(s.concepts.green.tags).toEqual(["japan"])
    expect(s.concepts.green.prov).toEqual([
      { source: "chat1", segment: "t1" },
      { source: "chat1", segment: "t4" },
    ])
    const live = Object.entries(s.relationships)
      .filter(([, r]) => r.deletedAt === null)
      .map(([k]) => k)
      .sort()
    expect(live).toEqual(
      [
        relKey("black", PART_OF, "topic"),
        relKey("green", PART_OF, "topic"),
        relKey("green", PREREQ, "black"),
        relKey("leaf", PREREQ, "green"),
      ].sort()
    )
    expect(s.relationships[relKey("green", PREREQ, "black")].note).toBe(
      "contrast"
    )
    // Loser Relationships are removed explicitly, not by cascade, so restoring the loser won't duplicate them.
    expect(
      s.relationships[relKey("matcha", PART_OF, "topic")].deletedWith
    ).toBeUndefined()
  })

  it("points per-View overrides at the survivor", () => {
    const h = withDuplicate()
    h.commit("ana", mergeConcepts(h.state, "green", "matcha"), "merge")
    expect(h.state.views.outline.settings).toMatchObject({
      placement: { green: "topic", leaf: "green" },
      order: { topic: ["green", "black"], green: ["leaf"] },
      hide: ["green"],
      fold: { black: ["green", "leaf"] },
    })
  })

  it("is one Change that undo reverses", () => {
    const h = withDuplicate()
    const before = h.state
    const c = h.commit(
      "ana",
      mergeConcepts(h.state, "green", "matcha"),
      "merge"
    )
    const r = undoChange({
      initial: h.initial,
      log: h.log,
      changeId: c,
      at: "2026-09-04T00:00:00.000Z",
    })
    expect(r.kept).toEqual([])
    h.commit("ana", r.ops)
    expect(h.state.concepts).toEqual(before.concepts)
    expect(h.state.views).toEqual(before.views)
    const liveKeys = (s: typeof before) =>
      Object.keys(s.relationships)
        .filter((k) => s.relationships[k].deletedAt === null)
        .sort()
    expect(liveKeys(h.state)).toEqual(liveKeys(before))
  })

  it("refuses to merge a Concept into itself or a deleted one", () => {
    const h = seeded()
    expect(() => mergeConcepts(h.state, "green", "green")).toThrow()
    h.commit("ana", [{ kind: "concept.delete", target: "black" }])
    expect(() => mergeConcepts(h.state, "green", "black")).toThrow()
  })

  it("the survivor takes the higher Reading status", () => {
    expect(higherReadingState("read", "known")).toBe("known")
    expect(higherReadingState("read", undefined)).toBe("read")
    expect(higherReadingState(undefined, undefined)).toBe("unread")
  })
})

describe("overrides and deletes", () => {
  it("ignores overrides pointing at a deleted Concept until it is restored", () => {
    const h = withDuplicate()
    h.commit("ana", [{ kind: "concept.delete", target: "matcha" }])
    const view = h.state.views.outline
    expect(effectiveOverrides(h.state, view)).toEqual({
      placement: {},
      order: { topic: ["black", "green"] },
      hide: [],
      fold: { black: ["leaf"] },
    })
    h.commit("ana", [{ kind: "concept.restore", target: "matcha" }])
    expect(effectiveOverrides(h.state, h.state.views.outline).hide).toEqual([
      "matcha",
    ])
  })
})

describe("removing Kinds, Relationship Types and Attributes in use", () => {
  it("reassigns a Kind’s Concepts, then hides it, in one Change", () => {
    const h = seeded()
    const ops = removeKind(h.state, IDEA, { reassignTo: builtinId("thing") })
    expect(ops.at(-1)).toEqual({ kind: "kind.hide", target: IDEA, value: true })
    h.commit("ana", ops)
    expect(
      Object.values(h.state.concepts).every(
        (c) => c.kind === builtinId("thing")
      )
    ).toBe(true)
  })

  it("deletes a Kind’s Concepts when asked", () => {
    const h = seeded()
    h.commit("ana", removeKind(h.state, IDEA, { deleteMembers: true }))
    expect(
      Object.values(h.state.concepts).every((c) => c.deletedAt !== null)
    ).toBe(true)
  })

  it("reassigns a Relationship Type’s Relationships", () => {
    const h = seeded()
    h.commit(
      "ana",
      removeRelType(h.state, PREREQ, { reassignTo: builtinId("uses") })
    )
    expect(
      h.state.relationships[relKey("leaf", builtinId("uses"), "green")]
    ).toMatchObject({
      note: "what is being processed",
      deletedAt: null,
    })
    expect(
      h.state.relationships[relKey("leaf", PREREQ, "green")].deletedAt
    ).not.toBeNull()
    expect(h.state.relTypes[PREREQ].hidden).toBe(true)
  })

  it("hides the values of a deleted Attribute, and undo restores them", () => {
    const h = seeded()
    const c = h.commit("ana", [{ kind: "attribute.delete", target: "price" }])
    expect(liveAttributes(h.state, h.state.concepts.green)).toEqual({})
    h.commit(
      "ana",
      undoChange({
        initial: h.initial,
        log: h.log,
        changeId: c,
        at: "2026-09-04T00:00:00.000Z",
      }).ops
    )
    expect(liveAttributes(h.state, h.state.concepts.green)).toEqual({
      price: 4,
    })
  })
})
