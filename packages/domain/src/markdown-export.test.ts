import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parseExpeditionJson, type ExpeditionJson } from "./expedition-json.ts"
import {
  brokenMarkdownLinks,
  expeditionToMarkdown,
  noteName,
} from "./markdown-export.ts"

const fixture = (name: string) =>
  parseExpeditionJson(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)),
        "utf8"
      )
    )
  )

/** A small synthetic Expedition with the awkward cases. */
const synthetic = (): ExpeditionJson =>
  parseExpeditionJson({
    schemaVersion: 1,
    id: "exp",
    title: "Tea: a field guide?",
    tags: ["field guide", "2026"],
    concepts: [
      {
        id: "a",
        title: "Green tea",
        kind: "builtin:idea",
        tags: ["leaf type"],
        summary: "Unoxidised.",
        overview:
          "Steamed or pan-fired; compare [black tea](#c/b), see [gone](#c/zzz), [[not a link]], [notes](notes/tea.md) and [a site](https://example.com).",
        attributes: { temp: 80 },
        sections: [
          {
            id: "s1",
            heading: "Brewing",
            md: "Cooler water than [Black tea](#c/b).",
          },
        ],
      },
      { id: "b", title: "Black tea", kind: "builtin:idea" },
      // Same title, different case, and a title Obsidian can't use as a name.
      { id: "c", title: "black TEA", kind: "builtin:thing" },
      { id: "d", title: "Oolong: half/half [sort of]", kind: "builtin:idea" },
      { id: "e", title: "Teas", kind: "builtin:topic" },
    ],
    attributes: [{ id: "temp", label: "Water", type: "number", unit: "°C" }],
    relationships: [
      { from: "a", type: "builtin:alternative-to", to: "b", note: "lighter" },
      { from: "d", type: "builtin:part-of", to: "e" },
    ],
    views: [
      {
        id: "v1",
        viewType: "outline",
        label: "Teas",
        question: "What kinds are there?",
        settings: { relationshipTypes: ["builtin:part-of"], hide: ["c"] },
        settingsVersion: 1,
      },
    ],
    bestViewId: "v1",
  })

describe("expeditionToMarkdown", () => {
  for (const name of ["compute", "research-doc", "trip"])
    it(`writes the ${name} fixture with every link resolving`, () => {
      const doc = fixture(name)
      const { notes } = expeditionToMarkdown(doc)
      // One note per Concept and per View, plus the Expedition's.
      expect(notes).toHaveLength(doc.concepts.length + doc.views.length + 1)
      expect(brokenMarkdownLinks(notes)).toEqual([])
      const names = notes.map((n) => n.path.split("/").pop()!.toLowerCase())
      expect(new Set(names).size).toBe(names.length)
      // Relationships appear both ways, as wikilinks.
      const wikilinks = notes
        .map((n) => n.text.match(/\[\[[^\]]+\]\]/g)?.length ?? 0)
        .reduce((a, b) => a + b, 0)
      expect(wikilinks).toBeGreaterThanOrEqual(2 * doc.relationships.length)
    })

  it("names notes safely and uniquely, and turns Concept links into wikilinks", () => {
    const { folder, notes } = expeditionToMarkdown(synthetic())
    expect(folder).toBe("Tea a field guide")
    expect(notes.map((n) => n.path).sort()).toEqual([
      "Concepts/Black tea.md",
      "Concepts/Green tea.md",
      "Concepts/Oolong half half sort of.md",
      "Concepts/Teas.md",
      "Concepts/black TEA (2).md",
      "Tea a field guide.md",
      "Views/Teas (2).md",
    ])
    expect(brokenMarkdownLinks(notes)).toEqual([])
    const green = notes.find((n) => n.path === "Concepts/Green tea.md")!.text
    expect(green).toContain('kind: "Idea"')
    expect(green).toContain('  - "leaf-type"')
    expect(green).toContain("Water (°C): 80")
    expect(green).toContain("compare [[Black tea|black tea]]")
    expect(green).toContain("see gone,")
    expect(green).toContain("\\[\\[not a link]]")
    expect(green).toContain("not a link]], notes and [a site]")
    expect(green).toContain("[a site](https://example.com)")
    expect(green).toContain("### Brewing\n\nCooler water than [[Black tea]].")
    expect(green).toContain(
      "### is an alternative to\n\n- [[Black tea]] (lighter)"
    )
    const oolong = notes.find((n) => n.path.startsWith("Concepts/Oolong"))!
    // The title survives as an alias, so Obsidian still finds it by name.
    expect(oolong.text).toContain('  - "Oolong: half/half [sort of]"')
    expect(oolong.text).toContain("### is part of\n\n- [[Teas]]")
    const view = notes.find((n) => n.path === "Views/Teas (2).md")!.text
    expect(view).toContain("best-view: true")
    expect(view).toContain("[[Tea a field guide|Tea: a field guide?]]")
    // Hidden from the View: not listed.
    expect(view).not.toContain("black TEA")
    const index = notes.find((n) => n.path === "Tea a field guide.md")!.text
    expect(index).toContain('  - "field-guide"')
    expect(index).toContain('  - "_2026"')
    expect(index).toContain("- [[Teas (2)|Teas]]: What kinds are there?")
  })

  it("reports links that resolve nowhere", () => {
    expect(
      brokenMarkdownLinks([
        {
          path: "A.md",
          text: "[[B]] [[A|me]] [x](C.md) [y](../A.md) [z](https://x.org)",
        },
        { path: "Sub/C.md", text: "[back](../A.md) [[Sub/C]]" },
      ])
    ).toEqual([
      { path: "A.md", link: "[[B]]" },
      { path: "A.md", link: "[x](C.md)" },
      { path: "A.md", link: "[y](../A.md)" },
    ])
  })

  it("makes a usable note name out of anything", () => {
    expect(noteName("  a/b:c  ")).toBe("a b c")
    expect(noteName("...hidden.")).toBe("hidden")
    expect(noteName("???")).toBe("Untitled")
    expect(noteName("x".repeat(200))).toHaveLength(80)
  })
})
