import { describe, expect, it } from "vitest"

import type { BuildEstimate, Draft, DraftSource, ProposedView } from "@/lib/api.ts"

import {
  addProposals,
  chosenInOrder,
  counterLabel,
  createLabel,
  estimateLabel,
  existingOf,
  formatTokens,
  formatUsd,
  fromDraft,
  fromProposal,
  hasOwnTitle,
  planViews,
  sourceChars,
  sourceMeta,
  sourcesKey,
  toggle,
  withSavedIds,
} from "./flow.ts"

const src = (over: Partial<DraftSource>): DraftSource => ({
  id: "s1",
  kind: "chat",
  title: "A chat",
  addedAt: "2026-09-30T00:00:00Z",
  segments: { kind: "chat", format: "chat-paste", count: 6, chars: 1200 },
  ...over,
})

const pv = (id: string, viewType: string, question: string, on = false): ProposedView => ({
  id,
  viewType,
  label: id.slice(2),
  question,
  why: "because",
  on,
  confidence: "high",
})

const draft = (views: Draft["views"]): Draft => ({
  expedition: { id: "e", title: "", summary: "", status: "draft", role: "owner", bestViewId: null },
  sources: [src({})],
  views,
  counts: { concepts: 0, sources: 1 },
})

describe("Sources", () => {
  it("describes each Source", () => {
    expect(sourceMeta(src({}))).toBe("Pasted chat · 6 turns")
    expect(
      sourceMeta(src({ kind: "file", segments: { kind: "document", format: "pdf", count: 1, chars: 10 } }))
    ).toBe("PDF · 1 page")
    expect(
      sourceMeta(src({ kind: "file", segments: { kind: "document", format: "markdown", count: 12, chars: 10 } }))
    ).toBe("Markdown · 12 sections")
    expect(sourceMeta(src({ kind: "file", segments: { kind: "chat", format: "claude-export", count: 40, chars: 10 } }))).toBe(
      "Claude export · 40 turns"
    )
    expect(sourceMeta(src({ kind: "prompt", segments: { kind: "document", format: "prompt", count: 1, chars: 10 } }))).toBe(
      "Prompt · background knowledge"
    )
    expect(sourceMeta(src({ kind: "file", segments: null }))).toBe("No text stored")
  })

  it("adds up the characters, and keys the set by id", () => {
    expect(sourceChars([src({}), src({ id: "s2", segments: null })])).toBe(1200)
    expect(sourcesKey([src({ id: "b" }), src({ id: "a" })])).toBe("a,b")
  })

  it("formats the estimate like the spec: ~420k tokens, about $1.10", () => {
    const usage = (n: number) => ({ input: n, cacheRead: 0, cacheWrite: 0, output: 0 })
    const e: BuildEstimate = {
      sourceTokens: 50_000,
      overCap: false,
      concepts: 80,
      views: 6,
      usd: 1.1,
      capUsd: 2.2,
      stages: {
        skim: { model: "a", usage: usage(20_000), usd: 0.01 },
        curator: { model: "b", usage: usage(300_000), usd: 0.8 },
        writer: { model: "c", usage: usage(100_000), usd: 0.29 },
      },
    }
    expect(estimateLabel(e)).toBe("~420k tokens, about $1.10")
    expect(formatTokens(1_500_000)).toBe("~1.5M tokens")
    expect(formatTokens(900)).toBe("~900 tokens")
    expect(formatUsd(0.004)).toBe("under $0.01")
  })
})

describe("Choose Views", () => {
  const skim = [
    pv("v-path", "learning-path", "What first?", true),
    pv("v-parts", "anatomy", "What is it made of?", true),
    pv("v-stages", "outline", "What are the stages?", true),
    pv("v-dense", "cause-and-effect", "Why dense?"),
  ]

  it("pre-selects what the skim turned on, and saves the chosen ones best first", () => {
    let c = fromProposal(skim)
    expect(c.chosen).toEqual(["v-path", "v-parts", "v-stages"])
    c = toggle(c, "v-path", false)
    c = toggle(c, "v-dense", true)
    // Rank order, not click order: the first chosen card is the best View.
    expect(chosenInOrder(c).map((p) => p.key)).toEqual(["v-parts", "v-stages", "v-dense"])
    expect(planViews(c)).toEqual([
      { viewType: "anatomy", label: "parts", question: "What is it made of?" },
      { viewType: "outline", label: "stages", question: "What are the stages?" },
      { viewType: "cause-and-effect", label: "dense", question: "Why dense?" },
    ])
    expect(createLabel(3)).toBe("Create Expedition with 3 Views")
    expect(createLabel(1)).toBe("Create Expedition with 1 View")
  })

  it("adds more without repeats; a specific request is chosen at once", () => {
    const c = fromProposal(skim)
    const more = addProposals(c, [pv("v-when", "timeline", "When?"), pv("v-x", "outline", "what are the STAGES")], false)
    expect(more.proposals.map((p) => p.key)).toEqual(["v-path", "v-parts", "v-stages", "v-dense", "v-when"])
    expect(more.chosen).toEqual(c.chosen)
    const asked = addProposals(more, [pv("v-map", "map", "Where?")], true)
    expect(asked.chosen.at(-1)).toBe("v-map")
    expect(existingOf(asked).takenIds).toContain("v-map")
  })

  it("shows a draft's saved Views, and keeps saved ids after a save", () => {
    const saved = fromDraft(
      draft([
        { id: "01A", viewType: "outline", label: "Stages", question: "What are the stages?", status: "queued" },
        { id: "01B", viewType: "map", label: "Where", question: null, status: "queued" },
      ])
    )
    expect(saved.chosen).toEqual(["01A", "01B"])
    expect(planViews(saved)[0]).toEqual({ id: "01A", viewType: "outline", label: "Stages", question: "What are the stages?" })
    expect(planViews(saved)[1]!.question).toBe("Where")

    const c = toggle(fromProposal(skim), "v-path", false)
    const after = withSavedIds(
      c,
      draft([
        { id: "V1", viewType: "anatomy", label: "parts", question: "What is it made of?", status: "queued" },
        { id: "V2", viewType: "outline", label: "stages", question: "What are the stages?", status: "queued" },
      ])
    )
    expect(planViews(after).map((v) => v.id)).toEqual(["V1", "V2"])
    expect(after.proposals.find((p) => p.key === "v-path")?.savedId).toBeUndefined()
  })

  it("counts and titles", () => {
    expect(counterLabel(0, 1)).toBe("0 Concepts found across 1 Source")
    expect(counterLabel(1284, 3)).toBe("1,284 Concepts found across 3 Sources")
    expect(hasOwnTitle("Untitled Expedition")).toBe(false)
    expect(hasOwnTitle("  ")).toBe(false)
    expect(hasOwnTitle("Sourdough")).toBe(true)
  })
})
