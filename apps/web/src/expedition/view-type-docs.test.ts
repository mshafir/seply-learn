import { describe, expect, it } from "vitest"
import { VIEW_TYPE_IDS } from "@seply/domain"

import { parseViewTypeDoc, viewTypeDoc } from "./view-type-docs.ts"

describe("View Type docs", () => {
  it("bundles one doc per View Type", () => {
    for (const id of VIEW_TYPE_IDS) {
      const doc = viewTypeDoc(id)
      expect(doc, id).toBeDefined()
      expect(doc!.intro.length, id).toBeGreaterThan(20)
      expect(doc!.answers, id).toMatch(/\?$/)
    }
    expect(viewTypeDoc("_template")).toBeUndefined()
  })

  it("splits front matter, title and intro", () => {
    const doc = parseViewTypeDoc(
      '---\nid: x\nanswers: "Why?"\nstatus: proven\n---\n\n# X\n\nFirst para.\n\n## Instructions\n\n1. Do.\n'
    )
    expect(doc).toEqual({
      body: "First para.\n\n## Instructions\n\n1. Do.",
      intro: "First para.",
      answers: "Why?",
      status: "proven",
    })
  })
})
