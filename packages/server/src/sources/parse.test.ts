// One test per format, on synthetic fixtures written for this (see
// fixtures/sources and scripts/build-source-fixtures.mjs) and the committed
// research doc. Never real chats.
import { readFileSync } from "node:fs"
import { SegmentsDoc, SEGMENT_MAX_CHARS } from "@seply/domain"
import { strToU8, zipSync } from "fflate"
import { describe, expect, it } from "vitest"

import {
  parseFile,
  parsePaste,
  parsePrompt,
  SourceError,
  type ParsedSource,
} from "./parse.ts"

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../fixtures/sources/${name}`, import.meta.url))
  )
const file = (name: string, type?: string) =>
  parseFile({ bytes: fixture(name), filename: name, type })
const researchDoc = new Uint8Array(
  readFileSync(
    new URL(
      "../../../../docs/research/knowledge-graph-learning-tools.md",
      import.meta.url
    )
  )
)

/** Every result is a valid segments blob with unique ids under the cap. */
function valid(p: ParsedSource) {
  expect(SegmentsDoc.parse(p.segments)).toEqual(p.segments)
  const ids = p.segments.segments.map((s) => s.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const s of p.segments.segments)
    expect(s.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS)
  return p
}
const rows = (p: ParsedSource) =>
  p.segments.segments.map((s) => [s.id, s.speaker, s.text])

describe("chat exports", () => {
  it("ChatGPT: the branch the reader saw, user and assistant turns only", async () => {
    const p = valid(
      await file("chatgpt-conversations.json", "application/json")
    )
    expect(p).toMatchObject({
      kind: "chat",
      title: "ChatGPT export (2 conversations)",
      mime: "application/json",
      segments: { kind: "chat", format: "chatgpt-export" },
    })
    expect(rows(p)).toEqual([
      ["t1", "user", "Why are there two high tides a day?"],
      [
        "t2",
        "assistant",
        expect.stringMatching(
          /^The Moon's gravity[\s\S]+under both each day\.$/
        ),
      ],
      // The edited question (the current branch), not the first draft.
      ["t3", "user", "Does the Sun matter too?"],
      // Tool output skipped; non-text parts dropped.
      [
        "t4",
        "assistant",
        "Yes. The Sun's tidal pull is a bit under half the Moon's.",
      ],
      [
        "t5",
        "assistant",
        expect.stringMatching(/^When the Sun and Moon line up/),
      ],
      ["t6", "user", "How often should I feed a sourdough starter?"],
      ["t7", "assistant", expect.stringMatching(/^At room temperature/)],
    ])
    expect(p.segments.segments[0]!.conversation).toBe("How tides work")
    expect(p.segments.segments[6]!.conversation).toBe(
      "Sourdough starter basics"
    )
  })

  it("ChatGPT: the export's zip", async () => {
    const p = valid(await file("chatgpt-export.zip"))
    expect(p.mime).toBe("application/zip")
    expect(p.segments.format).toBe("chatgpt-export")
    expect(p.segments.segments).toHaveLength(7)
  })

  it("Claude: one conversation, its title, text blocks joined", async () => {
    const p = valid(await file("claude-conversations.json"))
    expect(p.title).toBe("Photosynthesis, briefly")
    expect(p.segments.format).toBe("claude-export")
    expect(rows(p)).toEqual([
      ["t1", "user", "What does photosynthesis actually produce?"],
      [
        "t2",
        "assistant",
        "Glucose and oxygen, from carbon dioxide and water, powered by light.\n\nThe light reactions happen in the thylakoids; the Calvin cycle in the stroma.",
      ],
      ["t3", "user", "And what happens at night?"],
      [
        "t4",
        "assistant",
        "The light reactions stop, but cellular respiration carries on day and night.",
      ],
    ])
    // A single conversation: no per-turn conversation title.
    expect(p.segments.segments[0]!.conversation).toBeUndefined()
  })

  it("Gemini: Takeout activity, oldest first, responses as markdown", async () => {
    const p = valid(await file("gemini-my-activity.json"))
    expect(p.segments.format).toBe("gemini-export")
    expect(rows(p)).toEqual([
      ["t1", "user", "What is a KV cache in a transformer?"],
      [
        "t2",
        "assistant",
        "A **KV cache** stores the keys and values of tokens already processed, so decoding a new token doesn't recompute them.\n\n- Saves compute\n- Costs memory",
      ],
      ["t3", "user", "How big does it get?"],
      [
        "t4",
        "assistant",
        "It grows linearly with sequence length, layers and heads.",
      ],
    ])
  })

  it("refuses JSON that isn't an export", async () => {
    await expect(
      parseFile({ bytes: strToU8('{"hello":1}'), filename: "x.json" })
    ).rejects.toMatchObject({ status: 415 })
    await expect(
      parseFile({ bytes: strToU8("{nope"), filename: "x.json" })
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe("documents", () => {
  it("PDF: one segment per page", async () => {
    const p = valid(await file("sample.pdf"))
    expect(p).toMatchObject({
      kind: "file",
      title: "Volcanoes: a field guide",
      mime: "application/pdf",
      segments: { kind: "document", format: "pdf" },
    })
    expect(p.segments.segments.map((s) => [s.id, s.page])).toEqual([
      ["p1", 1],
      ["p2", 2],
      ["p3", 3],
    ])
    expect(p.segments.segments[1]!.text).toMatch(/Shield volcanoes/)
    expect(p.segments.segments[2]!.text).toMatch(/Stratovolcanoes/)
  })

  it("DOCX: headings become sections, list items stay together", async () => {
    const p = valid(await file("sample.docx"))
    expect(p.title).toBe("Bees and pollination")
    expect(p.segments.format).toBe("docx")
    expect(p.segments.segments.map((s) => [s.id, s.heading, s.text])).toEqual([
      [
        "s1",
        "Bees and pollination",
        "Most flowering plants rely on animals to move pollen & set seed.",
      ],
      [
        "s2",
        "Why bees",
        "Bees visit many flowers of one kind on a trip, which makes them efficient pollinators.",
      ],
      [
        "s3",
        "What they collect",
        "- Nectar, for energy\n- Pollen, for protein",
      ],
      ["s4", "Threats", "Habitat loss,\tpesticides\nand disease."],
    ])
  })

  it("Markdown: sections at headings, code fences respected", async () => {
    const p = valid(await file("notes.md"))
    expect(p).toMatchObject({
      kind: "file",
      title: "notes",
      segments: { kind: "document", format: "markdown" },
    })
    expect(p.segments.segments.map((s) => s.heading)).toEqual([
      "The water cycle",
      "Evaporation",
      "Condensation",
      "Precipitation",
    ])
    expect(p.segments.segments[2]!.text).toContain("# not a heading")
  })

  it("Markdown: the research doc", async () => {
    const p = valid(
      await parseFile({
        bytes: researchDoc,
        filename: "knowledge-graph-learning-tools.md",
      })
    )
    expect(p.segments.kind).toBe("document")
    expect(p.segments.segments.length).toBeGreaterThan(20)
    expect(p.segments.segments.find((s) => s.heading === "TL;DR")).toBeTruthy()
  })

  it("TXT: plain text is one section", async () => {
    const p = valid(await file("notes.txt", "text/plain"))
    expect(p.segments.format).toBe("text")
    expect(rows(p)).toEqual([
      [
        "s1",
        undefined,
        expect.stringMatching(/^Packing list[\s\S]+faster up high\.$/),
      ],
    ])
  })

  it("TXT: a chat saved as text is read as a chat", async () => {
    const p = valid(await file("pasted-chat.txt"))
    expect(p.kind).toBe("chat")
    expect(p.segments).toMatchObject({ kind: "chat", format: "text" })
    expect(p.segments.segments).toHaveLength(6)
  })

  it("HTML: headings, lists, quotes and code; scripts and styles dropped", async () => {
    const p = valid(await file("article.html"))
    expect(p.title).toBe("A short history of the printing press")
    expect(p.segments.format).toBe("html")
    const segs = p.segments.segments
    expect(segs.map((s) => s.heading)).toEqual([
      undefined,
      "A short history of the printing press",
      "Before the press",
      "What changed",
    ])
    expect(segs[0]!.text).toBe("Home")
    expect(segs[1]!.text).toBe(
      "Johannes Gutenberg built a movable-type press in *Mainz* around 1450."
    )
    expect(segs[2]!.text).toBe(
      "Books were copied by hand, mostly in monasteries.\nEach copy took months."
    )
    expect(segs[3]!.text).toContain(
      "- Books got cheaper\n- Literacy spread\n  - first in cities"
    )
    expect(segs[3]!.text).toContain("> The press made ideas travel.")
    expect(segs[3]!.text).toContain(
      "```\n1450  Gutenberg's press\n1455  Gutenberg Bible\n```"
    )
    expect(JSON.stringify(segs)).not.toMatch(/never read|font-family/)
  })

  it("refuses binary files it can't read, and empty ones", async () => {
    await expect(
      parseFile({
        bytes: new Uint8Array([0xff, 0xfe, 0x00, 0x81]),
        filename: "a.bin",
      })
    ).rejects.toBeInstanceOf(SourceError)
    await expect(
      parseFile({ bytes: new Uint8Array(), filename: "a.txt" })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      parseFile({
        bytes: zipSync({ "a.txt": strToU8("x") }),
        filename: "a.zip",
      })
    ).rejects.toMatchObject({ status: 415 })
  })

  it("refuses files over 25 MB", async () => {
    await expect(
      parseFile({
        bytes: new Uint8Array(25 * 1024 * 1024 + 1),
        filename: "big.txt",
      })
    ).rejects.toMatchObject({ status: 413 })
  })
})

describe("pastes and prompts", () => {
  it("a pasted chat: speaker detection, titled by the first question", () => {
    const text = new TextDecoder().decode(fixture("pasted-chat.txt"))
    const p = valid(parsePaste(text))
    expect(p).toMatchObject({
      kind: "chat",
      title: "Can you explain what a prime number is?",
      segments: { kind: "chat", format: "chat-paste" },
    })
    expect(p.segments.segments.map((s) => s.speaker)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    expect(p.segments.segments[3]!.text).toMatch(/^No\. By convention 1/)
  })

  it("pasted notes: a document titled by its first heading", () => {
    const p = valid(parsePaste("# Moon phases\n\nNew, waxing, full, waning."))
    expect(p).toMatchObject({
      kind: "file",
      title: "Moon phases",
      segments: { kind: "document", format: "markdown" },
    })
    expect(parsePaste("text", "My title").title).toBe("My title")
  })

  it("a prompt: one segment, kind prompt", () => {
    const p = valid(parsePrompt("  Teach me the basics of music theory.  "))
    expect(p).toMatchObject({
      kind: "prompt",
      title: "Teach me the basics of music theory.",
      segments: {
        format: "prompt",
        segments: [{ id: "s1", text: "Teach me the basics of music theory." }],
      },
    })
    expect(() => parsePrompt("   ")).toThrow(SourceError)
  })
})
