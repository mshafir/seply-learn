import { describe, expect, it } from "vitest"
import { fieldKey } from "./fields.ts"
import type { OpBody } from "./ops.ts"
import {
  acceptable,
  isStale,
  itemRefs,
  orderItems,
  previewProposals,
  proposalBase,
  proposalEntries,
  proposalStatusOf,
  staleness,
  waiting,
  withDependencies,
  withDependents,
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

  it("handles per-View structure and merges (WP-4.5's ops)", () => {
    const h = seeded()
    const placement: OpBody = {
      kind: "view.set",
      target: "outline",
      path: "settings.placement.leaf",
      value: "green",
    }
    const it1 = item(h, "p", [placement])
    expect(it1.base).toEqual({
      [fieldKey("view", "outline", "settings.placement.leaf")]: null,
    })
    expect(isStale(staleness(h.state, it1))).toBe(false)
    // Someone re-parents it elsewhere in this View: stale, both versions.
    h.commit("ben", [{ ...placement, value: "black" } as OpBody])
    expect(staleness(h.state, it1).changed[0]).toMatchObject({
      current: "black",
      proposed: "green",
    })
    // A merge tombstones the loser: items that need it are gone.
    const r = item(h, "r", [rel("leaf", PREREQ, "black")])
    h.commit("ben", [{ kind: "concept.delete", target: "leaf" }], "merge")
    expect(staleness(h.state, r).gone).toEqual(["leaf"])
    // The preview still applies what applies.
    const p = previewProposals(h.state, [it1, r])
    expect(p.skipped).toEqual(["r"])
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

describe("Concept packages", () => {
  // Grow-style: two new Concepts, each with a Relationship to the map; one
  // Relationship between them; one between Concepts already in the map.
  const pool = (h: ReturnType<typeof seeded>) => [
    item(h, "r-map", [rel("black", PREREQ, "green")]),
    item(h, "c-oolong", [
      concept("oolong", "Oolong", { summary: "Partly oxidised" }),
    ]),
    item(h, "c-tie", [concept("tie", "Tieguanyin")]),
    item(h, "r-oolong", [rel("oolong", PART_OF, "topic")]),
    item(h, "r-between", [rel("tie", PART_OF, "oolong")]),
    item(h, "r-tie", [rel("leaf", PREREQ, "tie")]),
    item(h, "a-oolong", [
      {
        kind: "section.create",
        target: "s1",
        value: { conceptId: "oolong", orderKey: "i", heading: "", md: "…" },
      },
    ]),
    item(h, "a-oolong-edit", [
      { kind: "section.set", target: "s1", path: "md", value: "More" },
    ] as OpBody[]),
    item(h, "e-green", [set("green", "summary", "Steamed")]),
  ]

  it("groups a new Concept with its article and its Relationships to the map", () => {
    const h = seeded()
    expect(proposalEntries(h.state, pool(h))).toEqual([
      {
        id: "r-map",
        kind: "item",
        concepts: [],
        items: ["r-map"],
        relationships: [],
        waitsFor: [],
      },
      {
        id: "c-oolong",
        kind: "package",
        concepts: ["oolong"],
        items: ["c-oolong", "a-oolong", "a-oolong-edit"],
        relationships: ["r-oolong"],
        waitsFor: [],
      },
      {
        id: "c-tie",
        kind: "package",
        concepts: ["tie"],
        items: ["c-tie"],
        relationships: ["r-tie"],
        waitsFor: [],
      },
      {
        id: "r-between",
        kind: "item",
        concepts: [],
        items: ["r-between"],
        relationships: [],
        waitsFor: ["tie", "oolong"],
      },
      {
        id: "e-green",
        kind: "item",
        concepts: [],
        items: ["e-green"],
        relationships: [],
        waitsFor: [],
      },
    ])
  })

  it("a Relationship between suggested Concepts stays its own entry and waits until both are in the map", () => {
    const h = seeded()
    const items = pool(h)
    const accepted: string[] = []
    const accept = (ids: string[]) => {
      h.commit(
        "ana",
        orderItems(
          h.state,
          items.filter((i) => ids.includes(i.id))
        ).flatMap((i) => i.ops)
      )
      accepted.push(...ids)
    }
    const between = () =>
      proposalEntries(
        h.state,
        items.map((i) => ({
          ...i,
          status: accepted.includes(i.id) ? ("accepted" as const) : undefined,
        }))
      ).find((e) => e.id === "r-between")
    accept(["c-oolong", "r-oolong"])
    expect(between()).toMatchObject({ kind: "item", waitsFor: ["tie"] })
    accept(["c-tie", "r-tie"])
    expect(between()).toMatchObject({ kind: "item", waitsFor: [] })
    expect(waiting(h.state, items, ["r-between"]).size).toBe(0)
  })

  it("refuses an item alone until what it needs is in the map or accepted with it", () => {
    const h = seeded()
    const items = pool(h)
    expect(waiting(h.state, items, ["r-between"])).toEqual(
      new Map([["r-between", ["tie", "oolong"]]])
    )
    expect(waiting(h.state, items, ["r-oolong"])).toEqual(
      new Map([["r-oolong", ["oolong"]]])
    )
    expect(waiting(h.state, items, ["a-oolong-edit"])).toEqual(
      new Map([["a-oolong-edit", ["s1"]]])
    )
    expect(
      waiting(h.state, items, ["c-oolong", "c-tie", "r-between"]).size
    ).toBe(0)
    expect(waiting(h.state, items, ["r-map", "e-green"]).size).toBe(0)
  })

  it("Accept all takes everything that can go in together, in an order that applies", () => {
    const h = seeded()
    const items = pool(h)
    const all = acceptable(
      h.state,
      items,
      items.map((i) => i.id)
    )
    expect(all.left).toEqual([])
    expect(all.ids.indexOf("c-tie")).toBeLessThan(all.ids.indexOf("r-between"))
    expect(all.ids.indexOf("c-oolong")).toBeLessThan(
      all.ids.indexOf("r-between")
    )
    h.commit(
      "ana",
      all.ids.flatMap((id) => items.find((i) => i.id === id)!.ops)
    )
    expect(
      isLive(h.state.relationships[relKey("tie", PART_OF, "oolong")])
    ).toBe(true)
  })

  it("leaves out what waits for a Concept that isn't accepted with it, or is gone", () => {
    const h = seeded()
    const items = pool(h)
    expect(
      acceptable(h.state, items, ["c-oolong", "r-oolong", "r-between"])
    ).toEqual({ ids: ["c-oolong", "r-oolong"], left: ["r-between"] })
    h.commit("ben", [{ kind: "concept.delete", target: "leaf" }])
    expect(
      acceptable(h.state, items, ["c-tie", "r-tie", "c-oolong", "r-between"])
    ).toEqual({ ids: ["c-oolong", "c-tie", "r-between"], left: ["r-tie"] })
  })

  it("dismissing a Concept dismisses everything that depends on it", () => {
    const h = seeded()
    const items = pool(h)
    expect(withDependents(h.state, items, ["c-oolong"])).toEqual([
      "c-oolong",
      "r-oolong",
      "r-between",
      "a-oolong",
      "a-oolong-edit",
    ])
    expect(withDependents(h.state, items, ["r-tie"])).toEqual(["r-tie"])
    // A Concept already in the map keeps what needs it.
    h.commit("ana", [...items.find((i) => i.id === "c-tie")!.ops])
    expect(withDependents(h.state, items, ["c-tie"])).toEqual(["c-tie"])
  })
})
