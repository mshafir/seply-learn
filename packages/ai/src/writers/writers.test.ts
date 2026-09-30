// The writers, driven by a scripted model (no provider, no spend): planning
// (who is core, what is owed, in batches), overviews and articles as op
// bodies, and the provenance and link repair.
import { emptyState, isLive, type DomainState } from "@seply/domain"
import { describe, expect, it } from "vitest"
import { applyBodies } from "../curator/curator.ts"
import type { CuratorSource } from "../curator/sources.ts"
import { CHAT } from "../test/printer.ts"
import { scriptedModel, writerScript } from "../testing.ts"
import {
  coreConcepts,
  planWriters,
  unresolvedProv,
  writeArticles,
  writeOverviews,
  writerLabel,
} from "./writers.ts"

const SOURCES: CuratorSource[] = [{ id: "chat", title: "Printer chat", segments: CHAT }]
const prov = (segment: string) => [{ source: "chat", segment }]

/** A small Expedition: a hub, three printers (one pinned core), a criterion. */
function state(opts: { pin?: boolean } = {}): DomainState {
  const s: DomainState = {
    ...emptyState("e1", "Which printer?"),
    sources: {
      chat: { id: "chat", kind: "chat", title: "Printer chat", addedBy: "u", addedAt: "2026-09-01T00:00:00.000Z" },
    },
  }
  const c = (id: string, title: string, kind: string, extra: object = {}) => ({
    kind: "concept.create" as const,
    target: id,
    value: { title, kind, prov: prov("t1"), ...extra },
  })
  return applyBodies(s, [
    c("hub", "Choosing a printer", "builtin:topic", { summary: "Which printer to buy for the kids." }),
    c("orbit", "Orbit P2", "builtin:thing", { prov: prov("t2"), ...(opts.pin !== false && { weightPin: "core" }) }),
    c("kite", "Kite", "builtin:thing", { prov: prov("t4") }),
    c("box", "Box S1", "builtin:thing", { prov: prov("t4"), weightPin: "aux" }),
    c("enclosed", "Enclosed", "builtin:criterion"),
    ...["orbit", "kite", "box", "enclosed"].map((id) => ({
      kind: "relationship.add" as const,
      target: `${id}|builtin:part-of|hub`,
      value: { prov: prov("t1") },
    })),
    { kind: "relationship.add", target: "orbit|builtin:meets|enclosed", value: {} },
  ])
}

const ids = () => {
  let n = 0
  return () => `sec${n++}`
}

describe("planning", () => {
  it("takes the pinned core Concepts, else the most connected (never aux)", () => {
    expect(coreConcepts(state())).toEqual(["orbit"])
    const unpinned = coreConcepts(state({ pin: false }))
    expect(unpinned[0]).toBe("hub")
    expect(unpinned).not.toContain("box")
    expect(unpinned).toHaveLength(3)
  })

  it("owes every overview (core first) and core articles, in batches", () => {
    const plan = planWriters(state(), { overviews: 2, articles: 3 })
    expect(plan.overviews.flat()).toHaveLength(5)
    expect(plan.overviews[0]![0]).toBe("orbit")
    expect(plan.overviews.every((b) => b.length <= 2)).toBe(true)
    expect(plan.articles).toEqual([["orbit"]])
  })

  it("plans nothing already written", async () => {
    const s = state()
    const model = scriptedModel(writerScript())
    const all = planWriters(s).overviews.flat()
    const o = await writeOverviews({ model, state: s, sources: SOURCES, ids: all })
    const a = await writeArticles({ model, state: applyBodies(s, o.bodies), sources: SOURCES, ids: ["orbit"], newId: ids() })
    const after = applyBodies(s, [...o.bodies, ...a.bodies])
    expect(planWriters(after)).toEqual({ overviews: [], articles: [] })
  })
})

describe("writeOverviews", () => {
  it("writes an overview with provenance for every Concept, and a summary only where there was none", async () => {
    const s = state()
    const model = scriptedModel(writerScript())
    const batch = ["hub", "orbit", "kite", "box", "enclosed"]
    const r = await writeOverviews({ model, state: s, sources: SOURCES, ids: batch })
    expect(r.written).toEqual(batch)
    expect(r.missing).toEqual([])
    const after = applyBodies(s, r.bodies)
    for (const id of batch) {
      expect(after.concepts[id]!.overview).toMatch(/matters here/)
      expect(after.concepts[id]!.overviewProv.length).toBeGreaterThan(0)
      expect(after.concepts[id]!.summary).toBeTruthy()
    }
    // The curator's summary stays.
    expect(after.concepts.hub!.summary).toBe("Which printer to buy for the kids.")
    expect(after.concepts.orbit!.overviewProv).toEqual(prov("t2"))
    expect(unresolvedProv(r.bodies, SOURCES)).toEqual([])
    // A neighbour linked as #c/<id>.
    expect(after.concepts.orbit!.overview).toMatch(/\]\(#c\/(hub|enclosed)\)/)
  })

  it("reads the Sources once in a cached part, and the batch after it", async () => {
    const model = scriptedModel(writerScript())
    await writeOverviews({ model, state: state(), sources: SOURCES, ids: ["orbit"] })
    const user = model.turns[0]!.prompt.find((m) => m.role === "user")!
    const parts = user.content as { type: string; text: string; providerOptions?: unknown }[]
    expect(parts[0]!.text).toContain('<source id="chat"')
    expect(parts[0]!.text).toContain("orbit | Orbit P2 | thing")
    expect(parts[0]!.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } })
    expect(parts[1]!.text).toContain("## Orbit P2 (orbit)")
    expect(model.turns[0]!.system).toContain("# Write summaries, overviews and articles")
  })

  it("reads only the cited segments when the Sources don't fit", async () => {
    const model = scriptedModel(writerScript())
    await writeOverviews({ model, state: state(), sources: SOURCES, ids: ["kite"], whole: false })
    const text = (model.turns[0]!.prompt.find((m) => m.role === "user")!.content as { text: string }[])[0]!.text
    expect(text).toContain("[t4 · assistant]")
    expect(text).toContain("[t1 · user]") // the hub, a neighbour
    expect(text).not.toContain("[t3 · user]")
  })

  it("repairs or drops refs that don't resolve, and keeps the rest", async () => {
    const s = state()
    const model = scriptedModel(writerScript({ bad: true }))
    const r = await writeOverviews({ model, state: s, sources: SOURCES, ids: ["orbit", "kite"] })
    expect(unresolvedProv(r.bodies, SOURCES)).toEqual([])
    const after = applyBodies(s, r.bodies)
    // t999 dropped; the wrong Source id moved to the one Source holding t2.
    expect(after.concepts.orbit!.overviewProv).toEqual(prov("t2"))
    expect(r.repairs.map((x) => x.action).sort()).toEqual(["dropped", "dropped", "moved", "moved"])
  })

  it("falls back to the Concept's own refs when none of the writer's resolve, and unlinks unknown Concepts", async () => {
    const s = state()
    const model = scriptedModel(() => ({
      text: JSON.stringify({
        concepts: [
          {
            id: "kite",
            overview: "The Kite is open, unlike [the Orbit](#c/orbit) and [a ghost](#c/nope).",
            overviewProv: [{ source: "chat", segment: "t42", quote: "made up" }],
          },
          { id: "not-in-batch", overview: "x", overviewProv: [] },
        ],
      }),
    }))
    const r = await writeOverviews({ model, state: s, sources: SOURCES, ids: ["kite", "box"] })
    const after = applyBodies(s, r.bodies)
    expect(after.concepts.kite!.overviewProv).toEqual(prov("t4"))
    expect(after.concepts.kite!.overview).toBe("The Kite is open, unlike [the Orbit](#c/orbit) and a ghost.")
    expect(r.unlinked).toBe(1)
    expect(r.written).toEqual(["kite"])
    expect(r.missing).toEqual(["box"])
    expect(after.concepts["not-in-batch"]).toBeUndefined()
  })

  it("keeps a quote only when it is in its segment", async () => {
    const s = state()
    const model = scriptedModel(() => ({
      text: JSON.stringify({
        concepts: [
          {
            id: "orbit",
            overview: "Enclosed.",
            overviewProv: [
              { source: "chat", segment: "t2", quote: "every enclosed printer here runs ABS" },
              { source: "chat", segment: "t3", quote: "not said anywhere" },
            ],
          },
        ],
      }),
    }))
    const r = await writeOverviews({ model, state: s, sources: SOURCES, ids: ["orbit"] })
    expect(applyBodies(s, r.bodies).concepts.orbit!.overviewProv).toEqual([
      { source: "chat", segment: "t2", quote: "every enclosed printer here runs ABS" },
      { source: "chat", segment: "t3" },
    ])
  })
})

describe("writeArticles", () => {
  it("writes ordered sections with provenance per section", async () => {
    const s = state()
    const model = scriptedModel(writerScript())
    const r = await writeArticles({ model, state: s, sources: SOURCES, ids: ["orbit"], newId: ids() })
    const after = applyBodies(s, r.bodies)
    const sections = Object.values(after.sections)
      .filter(isLive)
      .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
    expect(sections.map((x) => x.heading)).toEqual(["What it is", "Why it matters"])
    expect(sections.map((x) => x.id)).toEqual(["sec0", "sec1"])
    expect(sections[0]!.prov).toEqual(prov("t2"))
    expect(sections[1]!.prov).toEqual([]) // background knowledge
    expect(model.turns[0]!.user).toContain("Write the **article**")
    expect(unresolvedProv(r.bodies, SOURCES)).toEqual([])
  })

  it("never writes a second article", async () => {
    const s = state()
    const model = scriptedModel(writerScript())
    const first = await writeArticles({ model, state: s, sources: SOURCES, ids: ["orbit"], newId: ids() })
    const again = await writeArticles({ model, state: applyBodies(s, first.bodies), sources: SOURCES, ids: ["orbit"] })
    expect(again.bodies).toEqual([])
  })
})

it("labels a batch's Change", () => {
  const s = state()
  expect(writerLabel(s, "overviews", ["hub", "orbit", "kite", "box"])).toBe(
    "Wrote overviews for Choosing a printer, Orbit P2 and 2 more"
  )
  expect(writerLabel(s, "articles", ["orbit"])).toBe("Wrote the article for Orbit P2")
  expect(writerLabel(s, "articles", ["orbit", "kite"])).toBe("Wrote articles for Orbit P2 and Kite")
})
