import { describe, expect, it } from "vitest"
import {
  applyBody,
  emptyState,
  proposalBase,
  relKey,
  type DomainState,
  type OpBody,
  type ProposalItemView,
  type ProposalView,
} from "@seply/domain"

import {
  countPending,
  describeItem,
  entryIds,
  groupPending,
  itemsPhrase,
  planAccept,
  proposalBy,
  staleVersions,
  waitsForPhrase,
} from "@/expedition/suggestions.ts"

const AT = "2026-10-01T00:00:00.000Z"
const PART_OF = "builtin:part-of"
const idea = (id: string, title: string, summary?: string): OpBody => ({
  kind: "concept.create",
  target: id,
  value: { title, kind: "builtin:idea", ...(summary ? { summary } : {}) },
})
const set = (target: string, path: string, value: unknown) =>
  ({ kind: "concept.set", target, path, value }) as OpBody
const rel = (from: string, to: string): OpBody => ({
  kind: "relationship.add",
  target: relKey(from, PART_OF, to),
  value: {},
})
const applyOps = (s: DomainState, ops: OpBody[]) =>
  ops.reduce((st, op) => applyBody(st, op, AT), s)

const base = () =>
  applyOps(emptyState("e1"), [
    idea("attn", "Attention", "Weighs tokens"),
    idea("mla", "MLA"),
  ])

function proposal(
  state: DomainState,
  id: string,
  items: [string, OpBody[]][],
  extra: Partial<ProposalView> = {}
): ProposalView {
  return {
    id,
    expeditionId: "e1",
    author: { id: "ada", name: "Ada", image: null },
    origin: "ai",
    rationale: "What would I need to understand MLA?",
    status: "pending",
    createdAt: AT,
    items: items.map(([itemId, ops], i): ProposalItemView => ({
      id: itemId,
      proposalId: id,
      position: i + 1,
      ops,
      base: proposalBase(state, ops),
      status: "pending",
      changeId: null,
      createdAt: AT,
    })),
    ...extra,
  }
}

describe("Suggestions", () => {
  it("groups pending items by ask into Concept packages, leaving reviewed ones out", () => {
    const s = base()
    const p1 = proposal(s, "p1", [
      ["c", [idea("kv", "KV cache")]],
      ["r", [rel("kv", "attn")]],
      ["c2", [idea("rope", "RoPE")]],
      ["r2", [rel("rope", "attn")]],
      ["between", [rel("rope", "kv")]],
    ])
    p1.items[2]!.status = "accepted"
    p1.items[3]!.status = "accepted"
    const p2 = proposal(s, "p2", [["d", [set("mla", "summary", "x")]]], {
      rationale: "Add examples",
    })
    const now = applyOps(s, [idea("rope", "RoPE"), rel("rope", "attn")])
    const groups = groupPending(now, [p1, p2])
    expect(
      groups.map((g) => [
        g.proposal.rationale,
        g.count,
        g.entries.map((e) => [
          e.kind,
          e.items.map((i) => i.item.id),
          e.relationships.map((i) => i.item.id),
          e.waitsFor,
        ]),
      ])
    ).toEqual([
      [
        "What would I need to understand MLA?",
        3,
        [
          ["package", ["c"], ["r"], []],
          // Between two suggested Concepts: its own entry, waiting for KV cache.
          ["item", ["between"], [], ["kv"]],
        ],
      ],
      ["Add examples", 1, [["item", ["d"], [], []]]],
    ])
    expect(countPending([p1, p2])).toBe(4)
    expect(entryIds(groups[0]!.entries[0]!, new Set(["r"]))).toEqual(["c"])
    expect(
      waitsForPhrase(applyOps(now, [idea("kv", "KV cache")]), ["kv"])
    ).toBe("Accept KV cache first")
    expect(
      waitsForPhrase(applyOps(now, [idea("kv", "KV cache")]), ["kv", "rope"])
    ).toBe("Accept KV cache and RoPE first")
  })

  it("plans an accept in an order that applies, with stale items to overwrite", () => {
    const s = base()
    const p = proposal(s, "p1", [
      ["r", [rel("kv", "attn")]],
      ["c", [idea("kv", "KV cache")]],
      ["e", [set("attn", "summary", "Mixes values")]],
    ])
    expect(planAccept(s, [p], ["r", "c"], { dismiss: [] })).toMatchObject({
      ids: ["c", "r"],
      dismiss: [],
      stale: [],
      skipped: [],
      counts: { concepts: 1, relationships: 1, between: 0, other: 0 },
      all: false,
    })
    // A Relationship alone waits for its Concept: left out.
    expect(planAccept(s, [p], ["r"])).toMatchObject({ ids: [], skipped: ["r"] })
    const now = applyOps(s, [set("attn", "summary", "Ada's words")])
    expect(planAccept(now, [p], ["e", "r", "c"], { all: true })).toMatchObject({
      ids: ["c", "r", "e"],
      stale: ["e"],
      skipped: [],
      counts: { concepts: 1, relationships: 1, between: 0, other: 1 },
      all: true,
    })
    const stale = groupPending(now, [p])[0]!.entries.find((e) => e.id === "e")!
      .items[0]!
    expect(staleVersions(now, stale.staleness.changed[0]!)).toEqual({
      field: "summary",
      now: "Ada's words",
      suggested: "Mixes values",
    })
  })

  it("leaves out what can't apply, and what needs it", () => {
    const s = base()
    const p = proposal(s, "p1", [
      ["r", [rel("mla", "attn")]],
      ["e", [set("mla", "summary", "x")]],
    ])
    const gone = applyOps(s, [{ kind: "concept.delete", target: "mla" }])
    expect(planAccept(gone, [p], ["r", "e"])).toMatchObject({
      ids: [],
      stale: [],
      skipped: ["r", "e"],
    })
  })

  it("describes items in plain words", () => {
    const s = base()
    const preview = applyOps(s, [idea("kv", "KV cache", "Stores keys")])
    expect(
      describeItem(preview, { ops: [idea("kv", "KV cache", "Stores keys")] })
    ).toEqual({
      kind: "concept",
      label: "New Concept",
      title: "KV cache",
      detail: "Stores keys",
    })
    expect(describeItem(preview, { ops: [rel("kv", "attn")] })).toMatchObject({
      kind: "relationship",
      title: "KV cache is part of Attention",
    })
    expect(
      describeItem(preview, {
        ops: [
          {
            kind: "section.create",
            target: "s1",
            value: {
              conceptId: "mla",
              orderKey: "i",
              heading: "Why",
              md: "One two three",
            },
          },
          {
            kind: "section.create",
            target: "s2",
            value: {
              conceptId: "mla",
              orderKey: "j",
              heading: "How",
              md: "Four five",
            },
          },
        ],
      })
    ).toMatchObject({
      kind: "article",
      title: "for MLA",
      detail: "2 sections · about 5 words",
    })
    expect(
      describeItem(preview, { ops: [set("attn", "summary", "New words")] })
    ).toMatchObject({
      kind: "edit",
      title: "Summary of Attention",
      detail: "New words",
    })
  })

  it("says who suggested it, and what, for the MCP toast", () => {
    const s = base()
    const p = proposal(
      s,
      "p1",
      [
        ["a", [idea("kv", "KV cache")]],
        ["b", [idea("rope", "RoPE")]],
        ["c", [rel("kv", "attn")]],
      ],
      { origin: "mcp" }
    )
    expect(proposalBy(p, "ada")).toBe("Your agent (via MCP)")
    expect(proposalBy(p, "ben")).toBe("Ada's agent (via MCP)")
    expect(proposalBy({ ...p, origin: "ai" }, "ben")).toBe("Ada's ask")
    expect(itemsPhrase(s, p.items)).toBe("2 Concepts and 1 Relationship")
  })
})
