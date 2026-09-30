import { describe, expect, it } from "vitest"
import type { ConceptRow, RelationshipRow, SourceRow } from "@seply/sync"

import {
  articleSectionsOf,
  attributeItems,
  back,
  conceptEyebrow,
  conceptLinkId,
  formatAttribute,
  openConcept,
  provenanceLabel,
  pruneStack,
  push,
  readingMinutes,
  relationshipGroups,
  relTypeLabels,
} from "./reading.ts"

const source = (
  id: string,
  kind: SourceRow["kind"],
  title = id
): SourceRow => ({
  id,
  kind,
  title,
  addedBy: "u",
  addedAt: "2026-01-01T00:00:00.000Z",
})
const concept = (id: string, title = id): ConceptRow => ({
  id,
  title,
  aliases: [],
  kind: "builtin:idea",
  tags: [],
  overviewProv: [],
  attributes: {},
  prov: [],
  deletedAt: null,
})
const rel = (
  from: string,
  type: string,
  to: string,
  note?: string
): RelationshipRow => ({
  key: `${from}|${type}|${to}`,
  from,
  type,
  to,
  note,
  prov: [],
  deletedAt: null,
})

describe("back stack", () => {
  it("opens fresh, pushes, and goes back to the first entry", () => {
    let s = openConcept("a")
    s = push(s, { conceptId: "b", depth: "overview" })
    s = push(s, { conceptId: "b", depth: "article" })
    expect(s.map((e) => `${e.conceptId}:${e.depth}`)).toEqual([
      "a:overview",
      "b:overview",
      "b:article",
    ])
    s = back(back(s))
    expect(s).toEqual([{ conceptId: "a", depth: "overview" }])
    expect(back(s)).toBe(s)
  })

  it("doesn't push the place already on screen", () => {
    const s = openConcept("a")
    expect(push(s, { conceptId: "a", depth: "overview" })).toBe(s)
  })

  it("drops Concepts that are gone", () => {
    const s = push(openConcept("a"), { conceptId: "b", depth: "overview" })
    expect(pruneStack(s, (id) => id !== "b")).toEqual(openConcept("a"))
  })

  it("reads #c/ links only", () => {
    expect(conceptLinkId("#c/gqa")).toBe("gqa")
    expect(conceptLinkId("#c/a%20b")).toBe("a b")
    expect(conceptLinkId("https://example.com")).toBeNull()
    expect(conceptLinkId("#section")).toBeNull()
    expect(conceptLinkId(undefined)).toBeNull()
  })
})

describe("provenanceLabel", () => {
  const sources = [
    source("chat", "chat"),
    source("doc", "file", "notes.md"),
    source("ask", "prompt"),
  ]

  it("marks an empty list as background knowledge", () => {
    expect(provenanceLabel([], sources)).toEqual({
      kind: "background",
      text: "Background knowledge",
    })
  })

  it("names chat turns", () => {
    expect(
      provenanceLabel([{ source: "chat", segment: "t14" }], sources)
    ).toEqual({
      kind: "source",
      text: "From the chat, turn 14",
      ref: { source: "chat", segment: "t14" },
    })
    expect(
      provenanceLabel(
        [
          { source: "chat", segment: "t14" },
          { source: "chat", segment: "t3" },
          { source: "chat", segment: "t9" },
        ],
        sources
      ).text
    ).toBe("From the chat, turns 3, 9 and 14")
  })

  it("names document sections, the prompt, and unknown segments", () => {
    expect(
      provenanceLabel([{ source: "doc", segment: "s3" }], sources).text
    ).toBe("From notes.md, section 3")
    expect(
      provenanceLabel([{ source: "ask", segment: "p1" }], sources).text
    ).toBe("From the prompt")
    expect(
      provenanceLabel([{ source: "chat", segment: "x" }], sources).text
    ).toBe("From the chat")
    expect(
      provenanceLabel([{ source: "gone", segment: "t1" }], sources).text
    ).toBe("From a Source")
  })

  it("names PDF pages, and reads split segments as their whole", () => {
    expect(
      provenanceLabel([{ source: "doc", segment: "p2" }], sources).text
    ).toBe("From notes.md, page 2")
    expect(
      provenanceLabel(
        [
          { source: "chat", segment: "t3a" },
          { source: "chat", segment: "t3b" },
          { source: "chat", segment: "t7" },
        ],
        sources
      ).text
    ).toBe("From the chat, turns 3 and 7")
  })

  it("joins several Sources", () => {
    expect(
      provenanceLabel(
        [
          { source: "chat", segment: "t2" },
          { source: "doc", segment: "s1" },
        ],
        sources
      ).text
    ).toBe("From the chat, turn 2; From notes.md, section 1")
  })
})

describe("relationshipGroups", () => {
  const concepts = new Map(
    [
      concept("gqa", "GQA"),
      concept("mha", "MHA"),
      concept("mla", "MLA"),
      concept("llama", "Llama 4"),
      concept("qwen", "Qwen3"),
    ].map((c) => [c.id, c])
  )

  it("reads outgoing with the label and incoming with the inverse label", () => {
    const groups = relationshipGroups(
      "gqa",
      [
        rel("mha", "builtin:prerequisite", "gqa"),
        rel("gqa", "builtin:prerequisite", "mla"),
        rel("qwen", "builtin:uses", "gqa"),
        rel("llama", "builtin:uses", "gqa", "since v4"),
        rel("mha", "builtin:uses", "mla"),
        rel("gqa", "builtin:uses", "ghost"),
      ],
      concepts,
      []
    )
    expect(groups.out).toEqual([
      {
        direction: "out",
        typeId: "builtin:prerequisite",
        phrase: "is needed to understand",
        color: "blue",
        concepts: [{ id: "mla", title: "MLA", note: undefined }],
      },
    ])
    expect(
      groups.in.map((g) => [g.phrase, g.concepts.map((c) => c.title)])
    ).toEqual([
      ["needs", ["MHA"]],
      ["is used by", ["Llama 4", "Qwen3"]],
    ])
    expect(groups.in[1]!.concepts[0]!.note).toBe("since v4")
  })

  it("prefers the Expedition's own labels, and falls back to the id", () => {
    expect(
      relTypeLabels("builtin:uses", [
        {
          id: "builtin:uses",
          label: "runs on",
          inverseLabel: "runs",
          hidden: false,
        },
      ])
    ).toEqual({ label: "runs on", inverseLabel: "runs", color: "orange" })
    expect(relTypeLabels("custom", [])).toEqual({
      label: "custom",
      inverseLabel: "custom",
      color: undefined,
    })
  })
})

describe("attributes", () => {
  it("formats values by type and unit", () => {
    expect(formatAttribute(true, { type: "bool" })).toBe("Yes")
    expect(formatAttribute(false, { type: "bool" })).toBe("No")
    expect(formatAttribute(405, { type: "number", unit: "B" })).toBe("405B")
    expect(formatAttribute(3.4, { type: "number", unit: "×/yr" })).toBe(
      "3.4×/yr"
    )
    expect(formatAttribute(12000, { type: "number", unit: "hours" })).toBe(
      "12,000 hours"
    )
    expect(formatAttribute(40, { type: "money", unit: "$" })).toBe("$40")
    expect(formatAttribute(40, { type: "money", unit: "USD" })).toBe("40 USD")
    expect(formatAttribute("standard", { type: "enum" })).toBe("standard")
  })

  it("lists filled Attributes in the Expedition's order", () => {
    const c = {
      ...concept("x"),
      attributes: { b: 2, a: "one", c: "", z: true },
    }
    expect(
      attributeItems(c, [
        { id: "a", label: "Alpha", type: "text", deletedAt: null },
        { id: "b", label: "Beta", type: "number", unit: "kg", deletedAt: null },
        { id: "c", label: "Gamma", type: "text", deletedAt: null },
      ])
    ).toEqual([
      { id: "a", label: "Alpha", value: "one" },
      { id: "b", label: "Beta", value: "2 kg" },
    ])
  })
})

it("orders a Concept's sections and names the panel's place", () => {
  const section = (id: string, conceptId: string, orderKey: string) => ({
    id,
    conceptId,
    orderKey,
    heading: id,
    md: "",
    prov: [],
    deletedAt: null,
  })
  expect(
    articleSectionsOf("a", [
      section("2", "a", "b"),
      section("x", "other", "a"),
      section("1", "a", "a"),
    ]).map((s) => s.id)
  ).toEqual(["1", "2"])
  expect(conceptEyebrow({ date: "2023" }, "Idea", "overview", 3)).toBe(
    "Idea · 2023"
  )
  expect(
    conceptEyebrow({ date: "2024", dateEnd: "ongoing" }, "Event", "overview", 3)
  ).toBe("Event · 2024–now")
  expect(conceptEyebrow({}, "Idea", "overview", 3)).toBe("Idea")
  expect(conceptEyebrow({}, "Idea", "article", 3)).toBe("Article · 3 min")
})

it("estimates reading time", () => {
  expect(readingMinutes([])).toBe(1)
  expect(readingMinutes(["word ".repeat(660)])).toBe(3)
})
