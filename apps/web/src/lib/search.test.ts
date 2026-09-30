import type { ConceptRow } from "@seply/sync"
import { describe, expect, it } from "vitest"

import { matchConcepts, parseQuery, withTag } from "./search.ts"

const concept = (id: string, over: Partial<ConceptRow>): ConceptRow =>
  ({
    id,
    title: id,
    aliases: [],
    kind: "builtin:idea",
    tags: [],
    ...over,
  }) as ConceptRow

const concepts = [
  concept("levain", {
    title: "Levain",
    aliases: ["Starter"],
    summary: "A live culture of flour and water.",
    tags: ["fermentation"],
  }),
  concept("autolyse", {
    title: "Autolyse",
    summary: "Resting flour and water before the salt.",
    tags: ["technique", "Timing"],
  }),
  concept("crème", { title: "Crème fraîche", tags: ["dairy"] }),
]

describe("parseQuery", () => {
  it("splits text from #tags, folding case and accents", () => {
    expect(parseQuery("  Flour #Technique, #  crème ")).toEqual({
      terms: ["flour", "creme"],
      tags: ["technique"],
    })
  })
})

describe("matchConcepts", () => {
  it("matches nothing-to-dim for an empty query", () => {
    expect(matchConcepts(concepts, "  ")).toBeUndefined()
    expect(matchConcepts(concepts, "#")).toBeUndefined()
  })

  it("matches every word in the title, aliases, summary or Tags", () => {
    expect(matchConcepts(concepts, "flour water")).toEqual(
      new Set(["levain", "autolyse"])
    )
    expect(matchConcepts(concepts, "starter")).toEqual(new Set(["levain"]))
    expect(matchConcepts(concepts, "creme")).toEqual(new Set(["crème"]))
    expect(matchConcepts(concepts, "flour salt")).toEqual(new Set(["autolyse"]))
    expect(matchConcepts(concepts, "rye")).toEqual(new Set())
  })

  it("filters #tag by Tag prefix, with text too", () => {
    expect(matchConcepts(concepts, "#tech")).toEqual(new Set(["autolyse"]))
    expect(matchConcepts(concepts, "#timing")).toEqual(new Set(["autolyse"]))
    expect(matchConcepts(concepts, "#fermentation water")).toEqual(
      new Set(["levain"])
    )
    expect(matchConcepts(concepts, "#fermentation salt")).toEqual(new Set())
  })
})

describe("withTag", () => {
  it("replaces the prefix the Tag was suggested for", () => {
    expect(withTag("#tech", "technique")).toBe("#technique ")
    expect(withTag("#baking #tech", "technique")).toBe("#baking #technique ")
    expect(withTag("tech", "technique")).toBe("#technique ")
    expect(withTag("#baking tech", "technique")).toBe("#baking #technique ")
    expect(withTag("#technique", "technique")).toBe("#technique ")
  })
})
