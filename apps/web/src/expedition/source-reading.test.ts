import { segmentsDoc, type Segment } from "@seply/domain"
import { describe, expect, it } from "vitest"

import {
  assistantName,
  conversationStart,
  initialWindow,
  segmentLabel,
  sourceSummary,
  targetIds,
} from "@/expedition/source-reading.ts"

const turns = (n: number): Segment[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    speaker: i % 2 ? "assistant" : "user",
    text: `turn ${i + 1}`,
  }))

describe("segment labels", () => {
  it("reads turns, sections, pages and parts", () => {
    expect(segmentLabel("t14")).toBe("Turn 14")
    expect(segmentLabel("s3b")).toBe("Section 3, part b")
    expect(segmentLabel("p2")).toBe("Page 2")
    expect(segmentLabel("weird")).toBe("weird")
  })

  it("names the assistant by its export", () => {
    expect(assistantName("claude-export")).toBe("Claude")
    expect(assistantName("chat-paste")).toBe("Assistant")
  })

  it("summarises a Source, counting split segments once", () => {
    const chat = segmentsDoc("chat", "chat-paste", [
      ...turns(3),
      { id: "t4a", text: "a" },
      { id: "t4b", text: "b" },
    ])
    expect(sourceSummary(chat)).toBe("Pasted chat · 4 turns")
    expect(
      sourceSummary(
        segmentsDoc("document", "pdf", [{ id: "p1", page: 1, text: "x" }])
      )
    ).toBe("PDF · 1 page")
    expect(sourceSummary(segmentsDoc("chat", "text", turns(2)))).toBe(
      "Chat · 2 turns"
    )
  })
})

describe("the window of segments drawn", () => {
  it("draws a short Source whole", () => {
    const doc = segmentsDoc("chat", "chat-paste", turns(10))
    expect(initialWindow(doc, ["t9"])).toEqual({ from: 0, to: 10 })
  })

  it("centres a long Source on the target", () => {
    const doc = segmentsDoc("chat", "chatgpt-export", turns(500))
    expect(initialWindow(doc, targetIds(doc, "t300"))).toEqual({
      from: 279,
      to: 339,
    })
    expect(initialWindow(doc, [])).toEqual({ from: 0, to: 40 })
  })

  it("targets every part of a split segment", () => {
    const doc = segmentsDoc("chat", "chat-paste", [
      { id: "t1", text: "a" },
      { id: "t2a", text: "b" },
      { id: "t2b", text: "c" },
    ])
    expect(targetIds(doc, "t2")).toEqual(["t2a", "t2b"])
    expect(targetIds(doc, "t9")).toEqual([])
    expect(targetIds(doc, null)).toEqual([])
  })

  it("titles each conversation where it starts", () => {
    const segs: Segment[] = [
      { id: "t1", text: "a", conversation: "Tides" },
      { id: "t2", text: "b", conversation: "Tides" },
      { id: "t3", text: "c", conversation: "Bread" },
    ]
    expect([0, 1, 2].map((i) => conversationStart(segs, i, 0))).toEqual([
      "Tides",
      null,
      "Bread",
    ])
    expect(conversationStart(segs, 1, 1)).toBe("Tides")
  })
})
