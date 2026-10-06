import { describe, expect, it } from "vitest"

import { dispositionFilename } from "@/lib/api.ts"
import { importedLabel } from "@/lib/export.ts"

describe("importedLabel", () => {
  const base = { concepts: 201, relationships: 425, views: 12 }
  it("counts what an import brought in", () => {
    expect(importedLabel({ ...base, sources: 0, sourceFiles: 0 })).toBe(
      "201 Concepts, 425 Relationships, 12 Views."
    )
    expect(
      importedLabel({
        concepts: 1,
        relationships: 1,
        views: 1,
        sources: 1,
        sourceFiles: 0,
      })
    ).toBe("1 Concept, 1 Relationship, 1 View, 1 Source.")
    expect(importedLabel({ ...base, sources: 1, sourceFiles: 1 })).toBe(
      "201 Concepts, 425 Relationships, 12 Views, 1 Source (with its file)."
    )
    expect(importedLabel({ ...base, sources: 3, sourceFiles: 3 })).toBe(
      "201 Concepts, 425 Relationships, 12 Views, 3 Sources (with their files)."
    )
    expect(importedLabel({ ...base, sources: 3, sourceFiles: 2 })).toBe(
      "201 Concepts, 425 Relationships, 12 Views, 3 Sources (2 with their files)."
    )
  })
})

describe("dispositionFilename", () => {
  it("prefers the UTF-8 name, then the plain one", () => {
    expect(
      dispositionFilename(
        `attachment; filename="AI compute _ x.zip"; filename*=UTF-8''AI%20compute%20%26%20%C3%A9.zip`
      )
    ).toBe("AI compute & é.zip")
    expect(dispositionFilename(`attachment; filename="a.json"`)).toBe("a.json")
    expect(dispositionFilename(null)).toBeNull()
  })
})
