import { describe, expect, it } from "vitest"
import { builtinId } from "./builtins.ts"
import {
  effectiveOverrides,
  higherReadingState,
  liveAttributes,
  hideInView,
  mergeConcepts,
  mergedPairs,
  orderInView,
  parentInView,
  removeAttribute,
  removeKind,
  removeRelType,
  reparent,
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
    expect(s.concepts.green.aliases).toEqual(["Matcha", "Powdered green tea"])
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

  it("marks the survivor in the log, so Reading status can follow it", () => {
    const h = withDuplicate()
    // Same title, no aliases to add: the aliases op is still there.
    h.commit("ana", [
      {
        kind: "concept.set",
        target: "matcha",
        path: "title",
        value: "Green tea",
      },
      { kind: "concept.set", target: "matcha", path: "aliases", value: [] },
    ])
    const ops = mergeConcepts(h.state, "green", "matcha")
    expect(mergedPairs(ops)).toEqual([{ survivor: "green", loser: "matcha" }])
    expect(
      mergedPairs([...ops, ...mergeConcepts(h.state, "black", "leaf")])
    ).toEqual([
      { survivor: "green", loser: "matcha" },
      { survivor: "black", loser: "leaf" },
    ])
    expect(mergedPairs([{ kind: "concept.delete", target: "x" }])).toEqual([])
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

  it("reassigns an Attribute’s values to another of the same type, then deletes it", () => {
    const h = seeded()
    h.commit("ana", [
      {
        kind: "attribute.define",
        target: "cost",
        value: { label: "Cost", type: "money", unit: "$" },
      },
      {
        kind: "concept.set",
        target: "black",
        path: "attributes.price",
        value: 3,
      },
      {
        kind: "concept.set",
        target: "black",
        path: "attributes.cost",
        value: 5,
      },
    ])
    const ops = removeAttribute(h.state, "price", { reassignTo: "cost" })
    expect(ops.at(-1)).toEqual({ kind: "attribute.delete", target: "price" })
    h.commit("ana", ops)
    expect(h.state.attributes.price.deletedAt).not.toBeNull()
    // Green had only a price; Black's own cost wins over its old price.
    expect(liveAttributes(h.state, h.state.concepts.green)).toEqual({ cost: 4 })
    expect(liveAttributes(h.state, h.state.concepts.black)).toEqual({ cost: 5 })
  })

  it("refuses to reassign an Attribute to one of another type", () => {
    const h = seeded()
    h.commit("ana", [
      {
        kind: "attribute.define",
        target: "origin",
        value: { label: "Origin", type: "text" },
      },
    ])
    expect(() =>
      removeAttribute(h.state, "price", { reassignTo: "origin" })
    ).toThrow(/types are fixed/)
    expect(removeAttribute(h.state, "price", { deleteMembers: true })).toEqual([
      { kind: "attribute.delete", target: "price" },
    ])
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

/** Seeded, plus Oolong under the topic, a second Outline and an Anatomy. */
function withViews() {
  const h = seeded()
  h.commit("ana", [
    concept("oolong", "Oolong", { summary: "Partly oxidised" }),
    rel("oolong", PART_OF, "topic"),
    {
      kind: "view.create",
      target: "outline2",
      value: {
        viewType: "outline",
        label: "Another outline",
        orderKey: "j",
        settings: { relationshipTypes: [PART_OF], rootTag: "topic" },
      },
    },
    {
      kind: "view.create",
      target: "table",
      value: {
        viewType: "comparison-table",
        label: "Teas",
        orderKey: "k",
        settings: { rows: { tags: [] }, columns: [] },
      },
    },
  ])
  return h
}

describe("re-parenting", () => {
  it("“Just this View” places the Concept in one View and leaves the others", () => {
    const h = withViews()
    const ops = reparent(h.state, "outline", "oolong", "green", "view")
    expect(ops).toEqual([
      {
        kind: "view.set",
        target: "outline",
        path: "settings.placement.oolong",
        value: "green",
      },
    ])
    h.commit("ana", ops)
    expect(parentInView(h.state, h.state.views.outline, "oolong")).toBe("green")
    expect(parentInView(h.state, h.state.views.outline2, "oolong")).toBe(
      "topic"
    )
    expect(
      h.state.relationships[relKey("oolong", PART_OF, "topic")].deletedAt
    ).toBeNull()
    // Back under the shared parent: the override is cleared, not duplicated.
    h.commit("ana", reparent(h.state, "outline", "oolong", "topic", "view"))
    expect(h.state.views.outline.settings.placement).toEqual({})
  })

  it("“Everywhere” moves the shared Relationship, keeping its note and provenance", () => {
    const h = withViews()
    h.commit("ana", [
      {
        kind: "relationship.set",
        target: relKey("oolong", PART_OF, "topic"),
        path: "note",
        value: "a family",
      },
      {
        kind: "view.set",
        target: "outline",
        path: "settings.placement.oolong",
        value: "black",
      },
      {
        kind: "view.set",
        target: "outline2",
        path: "settings.placement.black",
        value: "green",
      },
    ])
    h.commit(
      "ana",
      reparent(h.state, "outline", "oolong", "green", "everywhere")
    )
    const s = h.state
    expect(
      s.relationships[relKey("oolong", PART_OF, "topic")].deletedAt
    ).not.toBeNull()
    expect(s.relationships[relKey("oolong", PART_OF, "green")]).toMatchObject({
      note: "a family",
      deletedAt: null,
    })
    // This View's own placement gave way; the other View's overrides stay.
    expect(s.views.outline.settings.placement).toEqual({})
    expect(s.views.outline2.settings.placement).toEqual({ black: "green" })
    expect(parentInView(s, s.views.outline2, "oolong")).toBe("green")
  })

  it("is one Change that undo reverses", () => {
    const h = withViews()
    const before = h.state
    const c = h.commit(
      "ana",
      reparent(h.state, "outline", "oolong", "green", "everywhere")
    )
    h.commit(
      "ana",
      undoChange({
        initial: h.initial,
        log: h.log,
        changeId: c,
        at: "2026-09-04T00:00:00.000Z",
      }).ops
    )
    expect(parentInView(h.state, h.state.views.outline, "oolong")).toBe("topic")
    expect(
      h.state.relationships[relKey("oolong", PART_OF, "green")].deletedAt
    ).not.toBeNull()
    expect(h.state.views).toEqual(before.views)
  })

  it("refuses cycles and Views without structure", () => {
    const h = withViews()
    h.commit("ana", reparent(h.state, "outline", "oolong", "green", "view"))
    expect(() =>
      reparent(h.state, "outline", "green", "oolong", "view")
    ).toThrow(/inside itself/)
    expect(() =>
      reparent(h.state, "outline", "green", "green", "view")
    ).toThrow()
    // In the other Outline Oolong is not under Green, so it may go there.
    expect(() =>
      reparent(h.state, "outline2", "green", "oolong", "view")
    ).not.toThrow()
    // Everywhere checks the shared structure too.
    h.commit(
      "ana",
      reparent(h.state, "outline2", "oolong", "green", "everywhere")
    )
    expect(() =>
      reparent(h.state, "outline2", "green", "oolong", "everywhere")
    ).toThrow(/inside itself/)
    expect(() => reparent(h.state, "table", "oolong", "green", "view")).toThrow(
      /no structure/
    )
  })
})

describe("per-View hide and order", () => {
  it("hides a Concept in one View and shows it again", () => {
    const h = withViews()
    h.commit("ana", hideInView(h.state.views.outline, "oolong", true))
    expect(h.state.views.outline.settings.hide).toEqual(["oolong"])
    expect(h.state.views.outline2.settings.hide).toBeUndefined()
    expect(hideInView(h.state.views.outline, "oolong", true)).toEqual([])
    h.commit("ana", hideInView(h.state.views.outline, "oolong", false))
    expect(h.state.views.outline.settings.hide).toEqual([])
  })

  it("orders siblings in one View", () => {
    const h = withViews()
    const drawn = ["green", "black", "oolong"]
    h.commit(
      "ana",
      orderInView(h.state.views.outline, "topic", drawn, "oolong", 0)
    )
    expect(h.state.views.outline.settings.order).toEqual({
      topic: ["oolong", "green", "black"],
    })
    expect(h.state.views.outline2.settings.order).toBeUndefined()
    expect(
      orderInView(
        h.state.views.outline,
        "topic",
        ["oolong", "green", "black"],
        "oolong",
        0
      )
    ).toEqual([])
  })
})
