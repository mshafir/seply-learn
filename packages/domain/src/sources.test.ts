import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  detectChat,
  findSegments,
  parseSegmentId,
  SegmentsDoc,
  segmentMarkdown,
  segmentPages,
  segmentsDoc,
  segmentText,
  segmentTurns,
  SEGMENT_MAX_CHARS,
  splitLong,
} from "./sources.ts"

const researchDoc = readFileSync(
  new URL(
    "../../../docs/research/knowledge-graph-learning-tools.md",
    import.meta.url
  ),
  "utf8"
)

describe("segmentMarkdown", () => {
  it("splits the research doc into one section per heading", () => {
    const segs = segmentMarkdown(researchDoc)
    const headings = researchDoc.match(/^#{1,4} .+$/gm)!
    const titles = headings.map((h) => h.replace(/^#+ /, ""))
    // One section per heading with text under it (a heading followed
    // directly by a subheading has none).
    expect(segs.length).toBeGreaterThan(20)
    expect(segs.length).toBeLessThanOrEqual(headings.length)
    for (const s of segs) expect(titles).toContain(s.heading)
    expect(segs[0]).toMatchObject({
      id: "s1",
      heading:
        "Open-Source Tools for LLM-Assisted Knowledge Graphs for Learning",
    })
    expect(segs[0]!.text).toMatch(/^\*Researched 2026-09-24/)
    expect(segs.find((s) => s.heading === "TL;DR")?.text).toMatch(
      /No open-source project does all four well today/
    )
    for (const s of segs) {
      expect(s.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS)
      expect(s.text).not.toMatch(/^#{1,4} /m)
    }
    // Nothing is lost but the headings themselves.
    const text = segs.map((s) => s.text).join("")
    expect(text.replace(/\s/g, "").length).toBeGreaterThan(
      researchDoc.replace(/^#.*$/gm, "").replace(/\s/g, "").length * 0.95
    )
  })

  it("reads the research doc as a document, not a chat", () => {
    expect(segmentText(researchDoc).kind).toBe("document")
  })

  it("keeps text before the first heading as a section without one", () => {
    expect(segmentMarkdown("Intro line.\n\n# One\nBody.")).toEqual([
      { id: "s1", text: "Intro line." },
      { id: "s2", heading: "One", text: "Body." },
    ])
  })

  it("ignores headings inside code fences", () => {
    const segs = segmentMarkdown(
      "# Setup\n```sh\n# not a heading\nls\n```\n## Next\nMore."
    )
    expect(segs.map((s) => s.heading)).toEqual(["Setup", "Next"])
    expect(segs[0]!.text).toContain("# not a heading")
  })

  it("numbers only sections with text", () => {
    expect(segmentMarkdown("# A\n\n# B\ntext").map((s) => s.id)).toEqual(["s1"])
  })
})

describe("splitLong", () => {
  it("splits at paragraphs into lettered parts under the cap", () => {
    const para = "word ".repeat(300).trim() // 1,499 chars
    const text = Array.from({ length: 10 }, () => para).join("\n\n")
    const parts = splitLong({ id: "s3", heading: "H", text })
    expect(parts.map((p) => p.id)).toEqual(["s3a", "s3b", "s3c", "s3d"])
    for (const p of parts) {
      expect(p.heading).toBe("H")
      expect(p.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS)
    }
    expect(parts.map((p) => p.text).join("\n\n")).toBe(text)
  })

  it("cuts a single paragraph longer than the cap", () => {
    const parts = splitLong({ id: "t1", text: "x".repeat(13000) })
    expect(parts.map((p) => p.text.length)).toEqual([6000, 6000, 1000])
  })

  it("leaves a short segment alone", () => {
    const seg = { id: "t1", text: "short" }
    expect(splitLong(seg)).toEqual([seg])
  })
})

describe("detectChat (pasted chats)", () => {
  it("reads the prototype's ## User / ## Claude export", () => {
    const turns = detectChat(
      "# A chat\n\n## User\nWhat is a KV cache?\n\n---\n\n## Claude\nIt stores keys and values.\n\n## User\nWhy?\n\n## Claude\nSpeed."
    )
    expect(turns?.map((t) => t.speaker)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    expect(segmentTurns(turns!)[1]).toEqual({
      id: "t2",
      speaker: "assistant",
      text: "It stores keys and values.",
    })
    expect(segmentTurns(turns!)[0]!.text).toBe("What is a KV cache?")
  })

  it("reads ChatGPT's “You said: / ChatGPT said:” copy", () => {
    const turns = detectChat(
      "You said:\nHow do tides work?\nChatGPT said:\nThe Moon's gravity pulls the oceans.\n\nTwice a day.\nYou said:\nThanks"
    )
    expect(segmentTurns(turns!)).toEqual([
      { id: "t1", speaker: "user", text: "How do tides work?" },
      {
        id: "t2",
        speaker: "assistant",
        text: "The Moon's gravity pulls the oceans.\n\nTwice a day.",
      },
      { id: "t3", speaker: "user", text: "Thanks" },
    ])
  })

  it("reads Human: / Assistant: lines with text after the colon", () => {
    const turns = detectChat(
      "Human: What is photosynthesis?\nAssistant: Plants turning light into sugar.\nIt happens in chloroplasts.\n**User:** And at night?\n**Gemini:** Respiration continues."
    )
    expect(segmentTurns(turns!).map((s) => [s.speaker, s.text])).toEqual([
      ["user", "What is photosynthesis?"],
      [
        "assistant",
        "Plants turning light into sugar.\nIt happens in chloroplasts.",
      ],
      ["user", "And at night?"],
      ["assistant", "Respiration continues."],
    ])
  })

  it("keeps markers inside code fences as text", () => {
    const turns = detectChat(
      "User:\nShow a transcript format\nAssistant:\n```\nUser: hi\nAssistant: hello\n```"
    )
    expect(turns).toHaveLength(2)
    expect(turns![1]!.text).toContain("User: hi")
  })

  it("is not fooled by documents", () => {
    // One speaker only.
    expect(detectChat("User: one\nUser: two")).toBeNull()
    // A document with a "## User" section among other sections.
    expect(
      detectChat("## Overview\nText\n## User\nNotes\n## Assistant\nMore")
    ).toBeNull()
    // A long introduction before the first marker.
    expect(
      detectChat(`${"Intro. ".repeat(100)}\nUser: a\nAssistant: b`)
    ).toBeNull()
    expect(segmentText("Plain notes.\n\nNo speakers here.").kind).toBe(
      "document"
    )
  })

  it("splits long turns into parts", () => {
    const long = Array.from({ length: 5 }, () => "y ".repeat(700)).join("\n\n")
    const segs = segmentTurns([
      { speaker: "user", text: "Go on" },
      { speaker: "assistant", text: long },
    ])
    expect(segs.map((s) => s.id)).toEqual(["t1", "t2a", "t2b"])
    expect(segs.every((s) => s.text.length <= SEGMENT_MAX_CHARS)).toBe(true)
  })
})

describe("segmentPages", () => {
  it("makes one segment per page, keeping page numbers", () => {
    expect(segmentPages(["First page", "  ", "Third page"])).toEqual([
      { id: "p1", page: 1, text: "First page" },
      { id: "p3", page: 3, text: "Third page" },
    ])
  })
})

describe("segment ids", () => {
  it("parses turn, section and page ids", () => {
    expect(parseSegmentId("t14")).toEqual({ unit: "turn", n: 14 })
    expect(parseSegmentId("s3b")).toEqual({
      unit: "section",
      n: 3,
      part: "b",
    })
    expect(parseSegmentId("p2")).toEqual({ unit: "page", n: 2 })
    expect(parseSegmentId("x1")).toBeNull()
  })

  it("finds a segment, or every part of a split one", () => {
    const doc = segmentsDoc("chat", "chat-paste", [
      { id: "t1", text: "a" },
      { id: "t2a", text: "b" },
      { id: "t2b", text: "c" },
      { id: "t12", text: "d" },
    ])
    expect(findSegments(doc, "t1").map((s) => s.id)).toEqual(["t1"])
    expect(findSegments(doc, "t2").map((s) => s.id)).toEqual(["t2a", "t2b"])
    expect(findSegments(doc, "t2b").map((s) => s.id)).toEqual(["t2b"])
    expect(findSegments(doc, "t9")).toEqual([])
    expect(doc.chars).toBe(4)
    expect(SegmentsDoc.parse(doc)).toEqual(doc)
  })
})
