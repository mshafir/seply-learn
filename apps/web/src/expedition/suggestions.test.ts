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
  groupPending,
  itemsPhrase,
  planAccept,
  proposalBy,
  staleVersions,
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
  it("groups pending items by ask, leaving reviewed ones out", () => {
    const s = base()
    const p1 = proposal(s, "p1", [
      ["c", [idea("kv", "KV cache")]],
      ["r", [rel("kv", "attn")]],
    ])
    p1.items[0]!.status = "accepted"
    const p2 = proposal(s, "p2", [["d", [set("mla", "summary", "x")]]], {
      rationale: "Add examples",
    })
    const groups = groupPending(s, [p1, p2])
    expect(
      groups.map((g) => [g.proposal.rationale, g.items.map((i) => i.item.id)])
    ).toEqual([
      ["What would I need to understand MLA?", ["r"]],
      ["Add examples", ["d"]],
    ])
    expect(countPending([p1, p2])).toBe(2)
  })

  it("plans an accept with its dependencies, and stale items to overwrite", () => {
    const s = base()
    const p = proposal(s, "p1", [
      ["c", [idea("kv", "KV cache")]],
      ["r", [rel("kv", "attn")]],
      ["e", [set("attn", "summary", "Mixes values")]],
    ])
    expect(planAccept(s, [p], ["r"])).toEqual({
      ids: ["c", "r"],
      added: ["c"],
      stale: [],
      skipped: [],
    })
    const now = applyOps(s, [set("attn", "summary", "Ada's words")])
    expect(planAccept(now, [p], ["e", "r"])).toEqual({
      ids: ["c", "r", "e"],
      added: ["c"],
      stale: ["e"],
      skipped: [],
    })
    const [stale] = groupPending(now, [p])[0]!.items.filter(
      (i) => i.item.id === "e"
    )
    expect(staleVersions(now, stale!.staleness.changed[0]!)).toEqual({
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
    expect(planAccept(gone, [p], ["r", "e"])).toEqual({
      ids: [],
      added: [],
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
