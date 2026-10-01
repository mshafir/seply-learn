import { describe, expect, it } from "vitest"
import { fieldKey } from "./fields.ts"
import type { OpBody } from "./ops.ts"
import {
  isStale,
  itemRefs,
  orderItems,
  previewProposals,
  proposalBase,
  proposalStatusOf,
  staleness,
  withDependencies,
  type ProposalItemLike,
} from "./proposals.ts"
import { isLive, relKey } from "./state.ts"
import { PART_OF, PREREQ, concept, rel, seeded } from "./test/harness.ts"

const set = (target: string, path: string, value: unknown): OpBody =>
  ({ kind: "concept.set", target, path, value }) as OpBody

/** An item suggested against the harness's state now. */
function item(
  h: ReturnType<typeof seeded>,
  id: string,
  ops: OpBody[]
): ProposalItemLike {
  return { id, ops, base: proposalBase(h.state, ops) }
}

describe("proposalBase", () => {
  it("records the values a change expects to replace", () => {
    const h = seeded()
    const base = proposalBase(h.state, [
      set("green", "summary", "Steamed or pan-fired"),
      set("green", "overview", "Green tea is…"),
      set("green", "attributes.price", 5),
      { kind: "concept.tag.add", target: "green", value: "japan" },
    ])
    expect(base).toEqual({
      [fieldKey("concept", "green", "summary")]: "Unoxidised",
      [fieldKey("concept", "green", "overview")]: null,
      [fieldKey("concept", "green", "attributes.price")]: 4,
      [fieldKey("concept", "green", "tag:japan")]: null,
    })
  })

  it("has none for new Concepts, sections and Relationships", () => {
    const h = seeded()
    expect(
      proposalBase(h.state, [
        concept("oolong", "Oolong"),
        set("oolong", "summary", "Partly oxidised"),
        rel("oolong", PART_OF, "topic"),
        {
          kind: "section.create",
          target: "s1",
          value: { conceptId: "green", orderKey: "i", heading: "", md: "…" },
        },
      ])
    ).toEqual({})
  })
})

describe("stale detection", () => {
  it("is fresh while nothing it replaces has changed", () => {
    const h = seeded()
    const it1 = item(h, "i1", [set("green", "summary", "Steamed")])
    h.commit("ben", [set("black", "summary", "Changed elsewhere")])
    const s = staleness(h.state, it1)
    expect(isStale(s)).toBe(false)
  })

  it("goes stale when a based field changed since, with both versions", () => {
    const h = seeded()
    const it1 = item(h, "i1", [set("green", "summary", "Steamed")])
    h.commit("ben", [set("green", "summary", "Ben's summary")])
    const s = staleness(h.state, it1)
    expect(isStale(s)).toBe(true)
    expect(s.gone).toEqual([])
    expect(s.changed).toEqual([
      {
        entity: "concept",
        id: "green",
        field: "summary",
        base: "Unoxidised",
        current: "Ben's summary",
        proposed: "Steamed",
      },
    ])
  })

  it("treats a field set since it was suggested as changed", () => {
    const h = seeded()
    const it1 = item(h, "i1", [set("green", "overview", "Mine")])
    h.commit("ben", [set("green", "overview", "Ben's")])
    expect(staleness(h.state, it1).changed[0]).toMatchObject({
      base: null,
      current: "Ben's",
      proposed: "Mine",
    })
    // Set back to what it was: fresh again.
    h.commit("ben", [set("green", "overview", null)])
    expect(isStale(staleness(h.state, it1))).toBe(false)
  })

  it("New Concepts and Relationships go stale only if an endpoint was deleted", () => {
    const h = seeded()
    const newConcept = item(h, "c", [concept("oolong", "Oolong")])
    const link = item(h, "r", [rel("leaf", PREREQ, "black")])
    // Unrelated edits to the ends don't make them stale.
    h.commit("ben", [
      set("leaf", "summary", "Changed"),
      set("black", "title", "Red tea"),
    ])
    expect(isStale(staleness(h.state, newConcept))).toBe(false)
    expect(isStale(staleness(h.state, link))).toBe(false)
    h.commit("ben", [{ kind: "concept.delete", target: "black" }])
    expect(staleness(h.state, link)).toEqual({ changed: [], gone: ["black"] })
  })

  it("a Relationship to a new Concept is fresh while another item creates it", () => {
    const h = seeded()
    const c = item(h, "c", [concept("oolong", "Oolong")])
    const r = item(h, "r", [rel("oolong", PART_OF, "topic")])
    expect(isStale(staleness(h.state, r, [c, r]))).toBe(false)
    // Without that item (dismissed), the new end is missing.
    expect(staleness(h.state, r, [r]).gone).toEqual(["oolong"])
    // Accepted, then undone (the Concept is tombstoned) and pending again:
    // the item that creates it brings it back, so neither is stale.
    h.commit("ana", [...c.ops, ...r.ops])
    h.commit("ana", [{ kind: "concept.delete", target: "oolong" }])
    expect(isStale(staleness(h.state, r, [c, r]))).toBe(false)
    expect(withDependencies(h.state, [c, r], ["r"]).ids).toEqual(["c", "r"])
  })

  it("an article for a Concept deleted since is stale", () => {
    const h = seeded()
    const article = item(h, "a", [
      {
        kind: "section.create",
        target: "s1",
        value: { conceptId: "leaf", orderKey: "i", heading: "", md: "…" },
      },
    ])
    h.commit("ben", [{ kind: "concept.delete", target: "leaf" }])
    expect(staleness(h.state, article).gone).toEqual(["leaf"])
  })
})

describe("dependency inclusion", () => {
  const pool = (h: ReturnType<typeof seeded>) => [
    item(h, "c-oolong", [
      concept("oolong", "Oolong", { summary: "Partly oxidised" }),
    ]),
    item(h, "r-part", [rel("oolong", PART_OF, "topic")]),
    item(h, "c-tie", [concept("tie", "Tieguanyin")]),
    item(h, "r-tie", [rel("tie", PART_OF, "oolong")]),
    item(h, "s-green", [set("green", "summary", "Steamed")]),
  ]

  it("accepting a Relationship to a new Concept includes that Concept", () => {
    const h = seeded()
    expect(withDependencies(h.state, pool(h), ["r-part"])).toEqual({
      ids: ["c-oolong", "r-part"],
      added: ["c-oolong"],
    })
  })

  it("follows dependencies transitively, in an order that applies", () => {
    const h = seeded()
    const r = withDependencies(h.state, pool(h), ["r-tie"])
    expect(r.ids).toEqual(["c-oolong", "c-tie", "r-tie"])
    expect(r.added.sort()).toEqual(["c-oolong", "c-tie"])
  })

  it("adds nothing for items whose Concepts exist", () => {
    const h = seeded()
    expect(withDependencies(h.state, pool(h), ["s-green"])).toEqual({
      ids: ["s-green"],
      added: [],
    })
  })

  it("Accept all applies in dependency order even when suggested out of order", () => {
    const h = seeded()
    const items = [
      item(h, "r", [rel("oolong", PART_OF, "topic")]),
      item(h, "c", [concept("oolong", "Oolong")]),
    ]
    expect(orderItems(h.state, items).map((i) => i.id)).toEqual(["c", "r"])
    const all = withDependencies(h.state, items, ["r", "c"])
    expect(all).toEqual({ ids: ["c", "r"], added: [] })
    h.commit(
      "ana",
      all.ids.flatMap((id) => items.find((i) => i.id === id)!.ops)
    )
    expect(
      isLive(h.state.relationships[relKey("oolong", PART_OF, "topic")])
    ).toBe(true)
  })

  it("an existing Concept counts once it's live, not while it's deleted", () => {
    const h = seeded()
    const r = item(h, "r", [rel("leaf", PREREQ, "black")])
    expect(itemRefs(r).needs).toEqual(new Set(["leaf", "black"]))
    h.commit("ben", [{ kind: "concept.delete", target: "leaf" }])
    expect(withDependencies(h.state, [r], ["r"])).toEqual({
      ids: ["r"],
      added: [],
    })
  })
})

describe("previewProposals", () => {
  it("applies what applies and names what to draw dashed", () => {
    const h = seeded()
    const items = [
      item(h, "r", [rel("oolong", PART_OF, "topic")]),
      item(h, "c", [concept("oolong", "Oolong")]),
      item(h, "s", [set("green", "summary", "Steamed")]),
      item(h, "bad", [rel("ghost", PART_OF, "topic")]),
    ]
    const p = previewProposals(h.state, items, "2026-09-03T00:00:00.000Z")
    expect(p.skipped).toEqual(["bad"])
    expect(p.state.concepts.oolong?.title).toBe("Oolong")
    expect(p.state.concepts.green?.summary).toBe("Steamed")
    expect([...p.suggested.concepts].sort()).toEqual(["green", "oolong"])
    expect([...p.suggested.relationships]).toEqual([
      relKey("oolong", PART_OF, "topic"),
    ])
    // The live state is untouched.
    expect(h.state.concepts.oolong).toBeUndefined()
  })
})

describe("proposalStatusOf", () => {
  it("follows its items", () => {
    expect(proposalStatusOf(["pending", "pending"])).toBe("pending")
    expect(proposalStatusOf(["accepted", "pending"])).toBe("partly")
    expect(proposalStatusOf(["accepted", "accepted"])).toBe("accepted")
    expect(proposalStatusOf(["dismissed", "dismissed"])).toBe("rejected")
    expect(proposalStatusOf(["accepted", "dismissed"])).toBe("partly")
  })
})
