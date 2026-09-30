// What the Source viewer reads (spec §3.7: "From the chat, turn 14" links to
// the segment): labels for segments and the window of segments it draws.
// Pure, so it is unit tested without a browser.
import {
  findSegments,
  parseSegmentId,
  type Segment,
  type SegmentsDoc,
} from "@seply/domain"

/** Who "assistant" is, by the export it came from. */
export function assistantName(format: SegmentsDoc["format"]): string {
  switch (format) {
    case "chatgpt-export":
      return "ChatGPT"
    case "claude-export":
      return "Claude"
    case "gemini-export":
      return "Gemini"
    default:
      return "Assistant"
  }
}

const UNIT_LABEL = { turn: "Turn", section: "Section", page: "Page" } as const

/** "Turn 14", "Section 3, part b", "Page 2". */
export function segmentLabel(id: string): string {
  const p = parseSegmentId(id)
  if (!p) return id
  return `${UNIT_LABEL[p.unit]} ${p.n}${p.part ? `, part ${p.part}` : ""}`
}

/** The line under the viewer's title: "Chat · 14 turns", "PDF · 3 pages". */
export function sourceSummary(doc: SegmentsDoc): string {
  const count = new Set(
    doc.segments.map((s) => {
      const p = parseSegmentId(s.id)
      return p ? `${p.unit}${p.n}` : s.id
    })
  ).size
  const unit =
    doc.kind === "chat" ? "turn" : doc.format === "pdf" ? "page" : "section"
  const what: Record<SegmentsDoc["format"], string> = {
    "chat-paste": "Pasted chat",
    "chatgpt-export": "ChatGPT export",
    "claude-export": "Claude export",
    "gemini-export": "Gemini export",
    pdf: "PDF",
    docx: "Word document",
    markdown: "Markdown",
    text: "Text",
    html: "Web page",
    prompt: "Prompt",
  }
  const kind =
    doc.kind === "chat" && doc.format === "text" ? "Chat" : what[doc.format]
  return `${kind} · ${count} ${unit}${count === 1 ? "" : "s"}`
}

/** The ids a ref points at: the segment, or every part of a split one. */
export function targetIds(doc: SegmentsDoc, segment: string | null): string[] {
  return segment ? findSegments(doc, segment).map((s) => s.id) : []
}

/** How many segments the viewer draws at first, and adds per "Show more". */
export const WINDOW_BEFORE = 20
export const WINDOW_AFTER = 40
export const WINDOW_STEP = 50

/**
 * The slice of segments drawn first: all of a short Source, else a window
 * around the target (from the start when there is none). Long exports hold
 * thousands of turns; markdown for all of them would stall the dialog.
 */
export function initialWindow(
  doc: SegmentsDoc,
  targets: readonly string[]
): { from: number; to: number } {
  const n = doc.segments.length
  if (n <= WINDOW_BEFORE + WINDOW_AFTER) return { from: 0, to: n }
  const at = targets.length
    ? doc.segments.findIndex((s) => s.id === targets[0])
    : 0
  const from = Math.max(0, at - WINDOW_BEFORE)
  return { from, to: Math.min(n, at + WINDOW_AFTER) }
}

/** A conversation title shown above this turn: when it starts a new one. */
export function conversationStart(
  segments: readonly Segment[],
  i: number,
  from: number
): string | null {
  const c = segments[i]?.conversation
  if (!c) return null
  return i === from || segments[i - 1]?.conversation !== c ? c : null
}
