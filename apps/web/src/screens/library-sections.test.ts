import { VIEW_TYPE_IDS } from "@umbel/domain"
import { THUMBNAIL_VIEW_TYPES } from "@umbel/ui/components/view-type-thumbnail"
import { describe, expect, it } from "vitest"

import type { CardCollaborator, LibraryCard } from "@/lib/api.ts"
import {
  collaboratorSummary,
  countsLabel,
  initials,
  librarySections,
  libraryTags,
  withTag,
} from "@/screens/library-sections.ts"

const card = (
  id: string,
  role: LibraryCard["role"],
  status: LibraryCard["status"] = "ready",
  tags: string[] = []
): LibraryCard => ({
  id,
  title: id,
  summary: "",
  visibility: "private",
  status,
  role,
  tags,
  collaborators: [],
  counts: { concepts: 0, views: 0 },
  bestViewType: null,
  updatedAt: "2026-09-29T00:00:00.000Z",
})

const person = (id: string, name: string): CardCollaborator => ({
  id,
  name,
  image: null,
  role: "editor",
})

describe("librarySections", () => {
  it("puts each Expedition in one section, keeping the order", () => {
    const s = librarySections([
      card("mine", "owner"),
      card("theirs", "editor"),
      card("my-draft", "owner", "draft"),
      card("their-draft", "editor", "draft"),
      card("viewed-draft", "viewer", "draft"),
      card("building", "owner", "building"),
    ])
    expect(s.yours.map((c) => c.id)).toEqual(["mine", "building"])
    expect(s.shared.map((c) => c.id)).toEqual(["theirs", "viewed-draft"])
    expect(s.drafts.map((c) => c.id)).toEqual(["my-draft", "their-draft"])
  })
})

describe("the Tag filter", () => {
  const cards = [
    card("a", "owner", "ready", ["training", "attention"]),
    card("b", "editor", "ready", ["attention"]),
    card("c", "owner"),
  ]
  it("lists every Tag with its count, A–Z", () => {
    expect(libraryTags(cards)).toEqual([
      { tag: "attention", count: 2 },
      { tag: "training", count: 1 },
    ])
  })
  it("keeps the Expeditions carrying the Tag", () => {
    expect(withTag(cards, "attention").map((c) => c.id)).toEqual(["a", "b"])
    expect(withTag(cards, null)).toHaveLength(3)
  })
})

describe("card text", () => {
  it("summarises the collaborators", () => {
    const me = person("me", "Me")
    expect(collaboratorSummary([me], "me")).toBe("Only you")
    expect(collaboratorSummary([me, person("a", "Ada")], "me")).toBe(
      "You and Ada"
    )
    expect(
      collaboratorSummary([me, person("a", "Ada"), person("b", "Bo")], "me")
    ).toBe("You, Ada and Bo")
    expect(
      collaboratorSummary(
        [me, person("a", "Ada"), person("b", "Bo"), person("c", "Cy")],
        "me"
      )
    ).toBe("You, Ada and 2 others")
    expect(collaboratorSummary([person("a", "Ada")], "me")).toBe("Ada")
    expect(collaboratorSummary([], "me")).toBe("")
  })

  it("counts Concepts and Views", () => {
    expect(countsLabel({ concepts: 201, views: 12 })).toBe(
      "201 Concepts · 12 Views"
    )
    expect(countsLabel({ concepts: 1, views: 1 })).toBe("1 Concept · 1 View")
  })

  it("makes initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL")
    expect(initials("ada")).toBe("AD")
    expect(initials("  ")).toBe("?")
  })
})

describe("thumbnails", () => {
  it("has an illustration for every View Type", () => {
    expect([...THUMBNAIL_VIEW_TYPES].sort()).toEqual([...VIEW_TYPE_IDS].sort())
  })
})
