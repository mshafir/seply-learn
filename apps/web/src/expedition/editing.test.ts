import { describe, expect, it } from "vitest"
import {
  applyAll,
  builtinId,
  emptyState,
  makeOps,
  relKey,
  ulidSequence,
  type DomainState,
  type OpBody,
} from "@seply/domain"

import {
  attributeVocabulary,
  hasStructure,
  kindVocabulary,
  parentCandidates,
  parseList,
  parseTags,
  placeInView,
  reassignTargets,
  relTypeVocabulary,
  vocabId,
} from "./editing.ts"

const PART_OF = builtinId("part-of")
const IDEA = builtinId("idea")
const nextOpId = ulidSequence(Date.parse("2026-09-01T00:00:00Z"))
let change = 0
const edit = (s: DomainState, bodies: OpBody[]) =>
  applyAll(
    s,
    makeOps(bodies, {
      expeditionId: "e1",
      actor: "ana",
      changeId: `c${++change}`,
      nextOpId,
    })
  )
const concept = (id: string, title: string, kind = IDEA): OpBody => ({
  kind: "concept.create",
  target: id,
  value: { title, kind },
})
const partOf = (from: string, to: string): OpBody => ({
  kind: "relationship.add",
  target: relKey(from, PART_OF, to),
  value: {},
})

/** Tea: a topic with three parts, an Outline, an Anatomy and a table. */
function tea() {
  return edit(emptyState("e1"), [
    concept("topic", "Tea", builtinId("topic")),
    concept("green", "Green tea"),
    concept("black", "Black tea"),
    concept("oolong", "Oolong"),
    concept("leaf", "Tea leaf", builtinId("thing")),
    partOf("green", "topic"),
    partOf("black", "topic"),
    partOf("oolong", "topic"),
    partOf("leaf", "green"),
    {
      kind: "attribute.define",
      target: "price",
      value: { label: "Price", type: "money", unit: "$" },
    },
    {
      kind: "attribute.define",
      target: "cost",
      value: { label: "Cost", type: "money" },
    },
    {
      kind: "attribute.define",
      target: "origin",
      value: { label: "Origin", type: "text" },
    },
    {
      kind: "concept.set",
      target: "green",
      path: "attributes.price",
      value: 4,
    },
    {
      kind: "view.create",
      target: "outline",
      value: {
        viewType: "outline",
        label: "Outline",
        orderKey: "i",
        settings: { relationshipTypes: [PART_OF] },
      },
    },
    {
      kind: "view.create",
      target: "anatomy",
      value: {
        viewType: "anatomy",
        label: "Anatomy",
        orderKey: "j",
        settings: { roots: ["topic"], containment: [PART_OF], pins: [] },
      },
    },
    {
      kind: "view.create",
      target: "table",
      value: {
        viewType: "comparison-table",
        label: "Teas",
        orderKey: "k",
        settings: { rows: {}, columns: [] },
      },
    },
  ])
}

describe("lists typed as text", () => {
  it("splits on commas, trims, drops blanks and repeats", () => {
    expect(parseList(" a, b,, a ,c ")).toEqual(["a", "b", "c"])
    expect(parseList("")).toEqual([])
  })
  it("reads Tags with or without #", () => {
    expect(parseTags("#ml, economics, #ml")).toEqual(["ml", "economics"])
  })
})

describe("vocabulary", () => {
  it("counts what uses each Kind and lists hidden ones last", () => {
    let s = tea()
    s = edit(s, [{ kind: "kind.hide", target: builtinId("goal"), value: true }])
    const kinds = kindVocabulary(s)
    expect(kinds.find((k) => k.id === IDEA)).toMatchObject({
      label: "Idea",
      builtin: true,
      uses: 3,
      hidden: false,
    })
    expect(kinds.at(-1)).toMatchObject({ id: builtinId("goal"), hidden: true })
  })

  it("lists the Expedition's own Kinds and Relationship Types after the built-ins", () => {
    const s = edit(tea(), [
      {
        kind: "kind.define",
        target: "drink",
        value: { label: "Drink", color: "teal" },
      },
      {
        kind: "reltype.define",
        target: "brewed-from",
        value: {
          label: "is brewed from",
          inverseLabel: "brews",
          color: "green",
        },
      },
    ])
    expect(kindVocabulary(s).find((k) => k.id === "drink")).toMatchObject({
      builtin: false,
      uses: 0,
    })
    expect(relTypeVocabulary(s).find((t) => t.id === PART_OF)?.uses).toBe(4)
    expect(
      relTypeVocabulary(s).find((t) => t.id === "brewed-from")
    ).toMatchObject({ detail: "brews", builtin: false })
  })

  it("reassigns an Attribute only to one of the same type", () => {
    const attrs = attributeVocabulary(tea())
    const price = attrs.find((a) => a.id === "price")!
    expect(price).toMatchObject({ uses: 1, detail: "money, $" })
    expect(reassignTargets(attrs, price).map((a) => a.id)).toEqual(["cost"])
    const kinds = kindVocabulary(tea())
    const idea = kinds.find((k) => k.id === IDEA)!
    expect(reassignTargets(kinds, idea)).not.toContainEqual(idea)
  })

  it("mints ids from labels, never a taken one", () => {
    expect(vocabId("Field trip!", new Set())).toBe("field-trip")
    // Built-ins live under `builtin:`, so they never collide.
    expect(vocabId("Idea", new Set([IDEA]))).toBe("idea")
    expect(vocabId("Drink", new Set(["drink", "drink-2"]))).toBe("drink-3")
  })
})

describe("structure in a View", () => {
  it("finds a Concept's parent and siblings as the Outline and the Anatomy draw them", () => {
    const s = tea()
    expect(placeInView(s, "outline", "oolong")).toEqual({
      parentId: "topic",
      siblings: ["green", "black", "oolong"],
    })
    expect(placeInView(s, "anatomy", "leaf")).toEqual({
      parentId: "green",
      siblings: ["leaf"],
    })
    // A top line, and a View Type without structure.
    expect(placeInView(s, "outline", "topic")).toBeNull()
    expect(placeInView(s, "table", "oolong")).toBeNull()
    expect(hasStructure(s, "outline")).toBe(true)
    expect(hasStructure(s, "table")).toBe(false)
  })

  it("follows the View's order and placement", () => {
    const s = edit(tea(), [
      {
        kind: "view.set",
        target: "outline",
        path: "settings.order.topic",
        value: ["oolong", "black"],
      },
      {
        kind: "view.set",
        target: "outline",
        path: "settings.placement.leaf",
        value: "black",
      },
    ])
    expect(placeInView(s, "outline", "green")?.siblings).toEqual([
      "oolong",
      "black",
      "green",
    ])
    expect(placeInView(s, "outline", "leaf")?.parentId).toBe("black")
    expect(placeInView(s, "anatomy", "leaf")?.parentId).toBe("green")
  })

  it("never offers a Concept itself, or what sits inside it, as its new parent", () => {
    const s = tea()
    const options = parentCandidates(s, "outline", "green")
    expect(options).not.toContain("green")
    expect(options).not.toContain("leaf")
    expect(options).toEqual(
      expect.arrayContaining(["topic", "black", "oolong"])
    )
  })
})
