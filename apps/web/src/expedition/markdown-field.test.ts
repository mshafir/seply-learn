import { describe, expect, it } from "vitest"
import computeJson from "@seply/domain/fixtures/compute.json?raw"
import { createMarkdownEditor as load } from "@seply/ui/components/markdown-editor"
import { serializeMarkdown } from "@seply/ui/lib/markdown-source"

import { conceptHref } from "@/expedition/reading.ts"

// Markdown is the stored format: what the editor loads, it writes back
// unchanged, for the committed sample's overviews and article sections
// (tables, lists, `#c/` Concept links).
type Fixture = {
  concepts: {
    id: string
    overview?: string
    sections?: { heading: string; md: string }[]
  }[]
}
const compute = JSON.parse(computeJson) as Fixture

const heads = compute.concepts.find((c) => c.id === "heads")!
/** "Query heads vs. K/V heads": a table, a list and Concept links. */
const SECTION = heads.sections!.find(
  (s) => s.heading === "Query heads vs. K/V heads"
)!.md

describe("the markdown editor's serializer", () => {
  it("round-trips an article section with a table, a list and Concept links", () => {
    expect(SECTION).toContain("| [GQA](#c/gqa)")
    expect(SECTION).toContain("\n- the number of **K/V heads**")
    expect(serializeMarkdown(load(SECTION))).toBe(SECTION)
  })

  it("round-trips every overview and section in the sample", () => {
    const all = compute.concepts.flatMap((c) => [
      c.overview ?? "",
      ...(c.sections ?? []).map((s) => s.md),
    ])
    expect(all.length).toBeGreaterThan(600)
    for (const md of all) expect(serializeMarkdown(load(md))).toBe(md)
  }, 60_000)

  it("keeps Concept links when a block is edited", () => {
    const editor = load(SECTION)
    // The first paragraph ends "…That is the [KV-cache](#c/kv-cache). So:"
    editor.tf.insertText(" See ", { at: editor.api.end([0]) })
    editor.tf.insertNodes(
      { type: "a", url: conceptHref("gqa"), children: [{ text: "GQA" }] },
      { at: editor.api.end([0]) }
    )
    const out = serializeMarkdown(editor)
    const [first, ...rest] = out.split("\n\n")
    expect(first).toMatch(
      /\[KV-cache\]\(#c\/kv-cache\)\. So: See \[GQA\]\(#c\/gqa\)$/
    )
    // Everything after it is untouched.
    expect(rest.join("\n\n")).toBe(SECTION.split("\n\n").slice(1).join("\n\n"))
  })
})
