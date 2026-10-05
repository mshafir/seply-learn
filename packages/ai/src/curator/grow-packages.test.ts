// The real Grow run (fixtures/grow/qlora.proposal.json: "What would I need
// to understand QLoRA?", 4 new Concepts and 8 Relationships, 3 of them
// between Concepts already in the Expedition) as the Suggestions tab groups
// it (spec §1.5): one package per new Concept with its Relationships to the
// map nested under it, and the 3 others as their own entries.
import {
  acceptable,
  applyBody,
  emptyState,
  isLive,
  itemRefs,
  orderItems,
  parseRelKey,
  proposalEntries,
  waiting,
  withDependents,
  type DomainState,
  type ProposalView,
} from "@seply/domain"
import { describe, expect, it } from "vitest"
import qlora from "../../fixtures/grow/qlora.proposal.json" with { type: "json" }

const proposal = qlora as unknown as ProposalView
const items = proposal.items
const AT = "2026-10-01T00:00:00.000Z"

/** The Expedition the ask saw, as far as the items need: the Concepts they link that they don't create. */
function before(): DomainState {
  const created = new Set(items.flatMap((i) => [...itemRefs(i).creates]))
  const existing = new Set(
    items.flatMap((i) => [...itemRefs(i).needs]).filter((c) => !created.has(c))
  )
  let s = emptyState(proposal.expeditionId)
  for (const id of existing)
    s = applyBody(
      s,
      {
        kind: "concept.create",
        target: id,
        value: { title: id, kind: "builtin:idea" },
      },
      AT
    )
  return s
}

const titleOf = (id: string) => {
  for (const i of items)
    for (const op of i.ops)
      if (op.kind === "concept.create" && op.target === id)
        return op.value.title
  return id
}

describe("the real Grow ask, grouped", () => {
  it("is 4 Concept packages with their Relationships to the map, and 3 Relationships between Concepts in the map", () => {
    const state = before()
    const entries = proposalEntries(state, items)
    const packages = entries.filter((e) => e.kind === "package")
    expect(packages.map((p) => p.concepts.map(titleOf))).toEqual([
      ["Fine-tuning memory footprint"],
      ["4-bit NormalFloat (NF4)"],
      ["Double quantization"],
      ["Paged optimizers"],
    ])
    expect(packages.map((p) => p.relationships.length)).toEqual([2, 1, 1, 1])
    // Every nested Relationship links its package's Concept to one in the map.
    for (const p of packages)
      for (const id of p.relationships) {
        const op = items.find((i) => i.id === id)!.ops[0]!
        const { from, to } = parseRelKey(op.target)
        expect([from, to]).toContain(p.concepts[0])
        expect(
          [from, to]
            .filter((c) => c !== p.concepts[0])
            .every((c) => isLive(state.concepts[c]))
        ).toBe(true)
      }
    const others = entries.filter((e) => e.kind === "item")
    expect(others).toHaveLength(3)
    expect(others.every((e) => e.waitsFor.length === 0)).toBe(true)
    // Every item is in exactly one entry.
    const all = entries.flatMap((e) => [...e.items, ...e.relationships]).sort()
    expect(all).toEqual(items.map((i) => i.id).sort())
  })

  it("accepts as one batch that applies, and nothing waits once the packages are in", () => {
    const state = before()
    const all = acceptable(
      state,
      items,
      items.map((i) => i.id)
    )
    expect(all.left).toEqual([])
    expect(all.ids).toHaveLength(12)
    let s = state
    for (const i of orderItems(
      state,
      items.filter((i) => all.ids.includes(i.id))
    ))
      for (const op of i.ops) s = applyBody(s, op, AT)
    expect(
      Object.values(s.relationships).filter((r) => isLive(r))
    ).toHaveLength(8)
    // A nested Relationship alone waits for its Concept.
    const nf4 = proposalEntries(state, items).find(
      (e) => e.concepts.map(titleOf)[0] === "4-bit NormalFloat (NF4)"
    )!
    expect(waiting(state, items, nf4.relationships).size).toBe(1)
    expect(
      waiting(state, items, [...nf4.items, ...nf4.relationships]).size
    ).toBe(0)
  })

  it("dismissing a package dismisses its Relationships, and only them", () => {
    const state = before()
    const entries = proposalEntries(state, items)
    for (const p of entries.filter((e) => e.kind === "package"))
      expect(withDependents(state, items, p.items).sort()).toEqual(
        [...p.items, ...p.relationships].sort()
      )
  })

  it("a Relationship between two of its new Concepts would wait for both", () => {
    const state = before()
    const [a, b] = proposal.items
      .filter((i) => i.ops[0]!.kind === "concept.create")
      .map((i) => i.ops[0]!.target)
    const between = {
      id: "between",
      ops: [
        {
          kind: "relationship.add" as const,
          target: `${a}|builtin:prerequisite|${b}`,
          value: {},
        },
      ],
    }
    const entry = proposalEntries(state, [...items, between]).find(
      (e) => e.id === "between"
    )
    expect(entry).toMatchObject({ kind: "item", waitsFor: [a, b] })
  })
})
