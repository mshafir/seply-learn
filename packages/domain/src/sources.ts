// Sources and their segments (spec §5.2 step 1). A Source is kept twice: the
// raw file as a blob, and its text normalized to markdown and split into
// **segments** (a second blob), which provenance refs point at.
//
// Segment ids (the seeding contract, prototypes/seeding/segment.py):
//   t14   chat turn 14
//   s3    document section 3 (one per heading)
//   p2    PDF page 2
// A segment longer than SEGMENT_MAX_CHARS is split at paragraphs into parts
// with a letter suffix: t3a, t3b, … Provenance may cite a part (t3a) or the
// whole (t3, meaning every part).
//
// Pure: the parsers that turn files into text live in @seply/server.
import { z } from "zod"

/** Files and pasted text are capped at 25 MB each (spec §2.7). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024
/** No segment runs past this many characters (the prototype's MAX). */
export const SEGMENT_MAX_CHARS = 6000
/** The segments blob format; bumped if its shape changes. */
export const SEGMENTS_VERSION = 1

export const Speaker = z.enum(["user", "assistant"])
export type Speaker = z.infer<typeof Speaker>

export const SegmentId = z.string().regex(/^[tsp]\d+[a-z]*$/)

export const Segment = z.strictObject({
  id: SegmentId,
  /** Normalized markdown. */
  text: z.string(),
  /** Chat turns: who said it. */
  speaker: Speaker.optional(),
  /** Chat exports holding several conversations: this turn's conversation. */
  conversation: z.string().optional(),
  /** Document sections: the heading above it (none before the first). */
  heading: z.string().optional(),
  /** PDF pages: the page number. */
  page: z.number().int().positive().optional(),
})
export type Segment = z.infer<typeof Segment>

/** How the Source's text was read. */
export const SourceFormat = z.enum([
  "chat-paste",
  "chatgpt-export",
  "claude-export",
  "gemini-export",
  "pdf",
  "docx",
  "markdown",
  "text",
  "html",
  "prompt",
])
export type SourceFormat = z.infer<typeof SourceFormat>

export const SegmentsKind = z.enum(["chat", "document"])
export type SegmentsKind = z.infer<typeof SegmentsKind>

/** The segments blob of one Source. */
export const SegmentsDoc = z.strictObject({
  v: z.literal(SEGMENTS_VERSION),
  kind: SegmentsKind,
  format: SourceFormat,
  /** Total characters of segment text. */
  chars: z.number().int().min(0),
  segments: z.array(Segment),
})
export type SegmentsDoc = z.infer<typeof SegmentsDoc>

export function segmentsDoc(
  kind: SegmentsKind,
  format: SourceFormat,
  segments: Segment[]
): SegmentsDoc {
  const chars = segments.reduce((n, s) => n + s.text.length, 0)
  return { v: SEGMENTS_VERSION, kind, format, chars, segments }
}

// ─── Reading segment ids ───────────────────────────────────────────────────

export type SegmentUnit = "turn" | "section" | "page"
const UNITS: Record<string, SegmentUnit> = {
  t: "turn",
  s: "section",
  p: "page",
}

/** `t14` → turn 14; `s3b` → section 3, part b. Null for any other id. */
export function parseSegmentId(
  id: string
): { unit: SegmentUnit; n: number; part?: string } | null {
  const m = /^([tsp])(\d+)([a-z]*)$/.exec(id)
  if (!m) return null
  return {
    unit: UNITS[m[1]!]!,
    n: Number(m[2]),
    ...(m[3] ? { part: m[3] } : {}),
  }
}

/**
 * The segments a provenance ref's `segment` names: the exact id, else every
 * part of it (`t3` → t3a, t3b). Empty when it names nothing.
 */
export function findSegments(
  doc: Pick<SegmentsDoc, "segments">,
  id: string
): Segment[] {
  const exact = doc.segments.find((s) => s.id === id)
  if (exact) return [exact]
  if (!/^[tsp]\d+$/.test(id)) return []
  const parts = new RegExp(`^${id}[a-z]+$`)
  return doc.segments.filter((s) => parts.test(s.id))
}

// ─── Splitting ─────────────────────────────────────────────────────────────

/** a, b, … z, aa, ab, … */
function partSuffix(i: number): string {
  let s = ""
  let n = i
  do {
    s = String.fromCharCode(97 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** Cuts one over-long paragraph at line breaks, else spaces, else anywhere. */
function cutParagraph(p: string, max: number): string[] {
  const out: string[] = []
  let rest = p
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let at = window.lastIndexOf("\n")
    if (at < max / 2) at = window.lastIndexOf(" ")
    if (at < max / 2) at = max
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Splits a segment longer than `max` at paragraphs into parts `<id>a`,
 * `<id>b`, … (the prototype's `split_long`).
 */
export function splitLong(seg: Segment, max = SEGMENT_MAX_CHARS): Segment[] {
  if (seg.text.length <= max) return [seg]
  const paras = seg.text
    .split(/\n{2,}/)
    .flatMap((p) => (p.length > max ? cutParagraph(p, max) : [p]))
  const parts: string[] = []
  let cur = ""
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > max) {
      parts.push(cur)
      cur = ""
    }
    cur += (cur ? "\n\n" : "") + p
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((text, i) => ({
    ...seg,
    id: `${seg.id}${partSuffix(i)}`,
    text: text.trim(),
  }))
}

/** Trims, and drops `---` rules at either end (exports put them between turns). */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/^(?:-{3,}\s*\n)+/, "")
    .replace(/(?:\n\s*-{3,})+$/, "")
    .trim()
}

// ─── Chats ─────────────────────────────────────────────────────────────────

export type Turn = { speaker: Speaker; text: string; conversation?: string }

/** Chat turns → segments t1, t2, …; empty turns are skipped. */
export function segmentTurns(turns: readonly Turn[]): Segment[] {
  const out: Segment[] = []
  let n = 0
  for (const t of turns) {
    const text = tidy(t.text)
    if (!text) continue
    n++
    out.push(
      ...splitLong({
        id: `t${n}`,
        speaker: t.speaker,
        ...(t.conversation ? { conversation: t.conversation } : {}),
        text,
      })
    )
  }
  return out
}

/** Names a pasted chat uses for its speakers, lower case. */
const SPEAKER_NAMES: Record<string, Speaker> = {
  user: "user",
  human: "user",
  you: "user",
  me: "user",
  q: "user",
  question: "user",
  assistant: "assistant",
  ai: "assistant",
  claude: "assistant",
  chatgpt: "assistant",
  gpt: "assistant",
  gemini: "assistant",
  bard: "assistant",
  copilot: "assistant",
  model: "assistant",
  bot: "assistant",
  a: "assistant",
  answer: "assistant",
}
const NAME = `(${Object.keys(SPEAKER_NAMES).join("|")})`
const B = String.raw`(?:\*\*|__)?`

/**
 * Speaker markers, one per line (case-insensitive):
 *   ## User   ### Claude said:         a heading
 *   You said:   ChatGPT said:          ChatGPT's "copy conversation" form
 *   Human: text…   **User:** text…     a name and a colon, text may follow
 */
const MARKERS = [
  {
    form: "heading",
    re: new RegExp(
      `^(#{1,6})\\s+${B}${NAME}(?:\\s+said)?${B}\\s*:?${B}\\s*$`,
      "i"
    ),
  },
  {
    form: "said",
    re: new RegExp(`^${B}${NAME}\\s+said\\s*:?${B}\\s*$`, "i"),
  },
  {
    form: "colon",
    re: new RegExp(`^${B}${NAME}${B}\\s*:${B}(?:\\s+(.*))?$`, "i"),
  },
] as const

type Marker = {
  line: number
  speaker: Speaker
  /** Text after the marker on its line. */
  rest: string
  /** Heading markers: their level. */
  level?: number
}

function matchMarker(line: string, i: number): Marker | null {
  const t = line.trim()
  for (const { form, re } of MARKERS) {
    const m = re.exec(t)
    if (!m) continue
    if (form === "heading")
      return {
        line: i,
        speaker: SPEAKER_NAMES[m[2]!.toLowerCase()]!,
        rest: "",
        level: m[1]!.length,
      }
    return {
      line: i,
      speaker: SPEAKER_NAMES[m[1]!.toLowerCase()]!,
      rest: form === "colon" ? (m[2] ?? "").trim() : "",
    }
  }
  return null
}

/** Lines outside fenced code blocks, as `[index, line]`. */
function proseLines(lines: readonly string[]): number[] {
  const out: number[] = []
  let fence: string | null = null
  lines.forEach((line, i) => {
    const f = /^\s*(```+|~~~+)/.exec(line)
    if (f) {
      if (!fence) fence = f[1]![0]!
      else if (f[1]![0] === fence) fence = null
      return
    }
    if (!fence) out.push(i)
  })
  return out
}

/** Text before the first marker longer than this is a document, not a chat. */
const MAX_PREAMBLE = 500

/**
 * Speaker detection for pasted text (spec §5.2): the turns, when `text`
 * reads as a chat, else null. A chat has at least two speaker markers, both
 * a user and an assistant, and little before the first marker. When the
 * markers are headings, every heading at their level must be a marker (the
 * prototype's rule), so a document with a "## User" section stays a
 * document.
 */
export function detectChat(text: string): Turn[] | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const prose = proseLines(lines)
  const markers = prose
    .map((i) => matchMarker(lines[i]!, i))
    .filter((m): m is Marker => m !== null)
  if (markers.length < 2) return null
  const speakers = new Set(markers.map((m) => m.speaker))
  if (speakers.size < 2) return null

  const levels = new Set(
    markers.flatMap((m) => (m.level === undefined ? [] : [m.level]))
  )
  for (const level of levels) {
    const heading = new RegExp(`^#{${level}}\\s`)
    const isMarker = new Set(markers.map((m) => m.line))
    if (prose.some((i) => heading.test(lines[i]!) && !isMarker.has(i)))
      return null
  }

  const preamble = lines.slice(0, markers[0]!.line).join("\n").trim()
  if (preamble.length > MAX_PREAMBLE) return null

  return markers.map((m, k) => {
    const end = markers[k + 1]?.line ?? lines.length
    const body = lines.slice(m.line + 1, end).join("\n")
    return { speaker: m.speaker, text: m.rest ? `${m.rest}\n${body}` : body }
  })
}

// ─── Documents ─────────────────────────────────────────────────────────────

/**
 * Markdown → sections s1, s2, … at each heading (levels 1–4, outside code
 * fences), each carrying its heading. Text before the first heading is a
 * section without one.
 */
export function segmentMarkdown(markdown: string): Segment[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const prose = new Set(proseLines(lines))
  const out: Segment[] = []
  let heading: string | undefined
  let buf: string[] = []
  let n = 0
  const flush = () => {
    const text = tidy(buf.join("\n"))
    buf = []
    if (!text) return
    n++
    out.push(
      ...splitLong({ id: `s${n}`, ...(heading ? { heading } : {}), text })
    )
  }
  lines.forEach((line, i) => {
    const h = prose.has(i) ? /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(line) : null
    if (h) {
      flush()
      heading = h[1]!
    } else buf.push(line)
  })
  flush()
  return out
}

/** PDF pages → segments p1, p2, …; blank pages keep their number, unsegmented. */
export function segmentPages(pages: readonly string[]): Segment[] {
  return pages.flatMap((page, i) => {
    const text = tidy(page)
    return text ? splitLong({ id: `p${i + 1}`, page: i + 1, text }) : []
  })
}

/**
 * Text or markdown → segments: chat turns when it reads as a chat (speaker
 * detection), else document sections.
 */
export function segmentText(text: string): {
  kind: SegmentsKind
  segments: Segment[]
} {
  const turns = detectChat(text)
  if (turns) return { kind: "chat", segments: segmentTurns(turns) }
  return { kind: "document", segments: segmentMarkdown(text) }
}
