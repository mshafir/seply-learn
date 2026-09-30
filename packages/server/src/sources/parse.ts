// Reading a Source (spec §5.2 step 1, no LLM): a file, a paste or a prompt
// becomes normalized markdown split into segments. Formats: chat exports
// (ChatGPT, Claude, Gemini; the JSON, or the export's zip), PDF, DOCX,
// Markdown, TXT and HTML. Pasted text and text files get speaker detection,
// so a pasted chat becomes turns.
import {
  MAX_SOURCE_BYTES,
  segmentPages,
  segmentsDoc,
  segmentText,
  segmentTurns,
  splitLong,
  type SegmentsDoc,
  type SourceFormat,
  type SourceKind,
} from "@seply/domain"
import { unzipSync, type Unzipped } from "fflate"

import { readChatExport } from "./chat-exports.ts"
import { docxTitle, docxToMarkdown } from "./docx.ts"
import { htmlTitle, htmlToMarkdown } from "./html.ts"

/** A Source, read: what `source.add` records, and its segments. */
export type ParsedSource = {
  kind: SourceKind
  title: string
  /** The raw blob's content type. */
  mime: string
  segments: SegmentsDoc
}

/** Why a Source can't be read. `status` is the HTTP answer. */
export class SourceError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string
  ) {
    super(message)
    this.name = "SourceError"
  }
}

const MIME: Partial<Record<SourceFormat, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
  "chat-paste": "text/plain; charset=utf-8",
  prompt: "text/plain; charset=utf-8",
}

/** Titles are one line, at most this long. */
const TITLE_MAX = 120

function oneLine(s: string, max = TITLE_MAX): string {
  const line = s
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

const stem = (filename: string) =>
  filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || filename

function ext(filename: string): string {
  return /\.([^.\\/]+)$/.exec(filename)?.[1]?.toLowerCase() ?? ""
}

function startsWith(bytes: Uint8Array, magic: string) {
  for (let i = 0; i < magic.length; i++)
    if (bytes[i] !== magic.charCodeAt(i)) return false
  return true
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes
    )
  } catch {
    return null
  }
}

function nonEmpty(doc: SegmentsDoc, what: string): SegmentsDoc {
  if (!doc.segments.length) throw new SourceError(400, `${what} has no text.`)
  return doc
}

/** Unzips only the entries we read, refusing to inflate past the cap. */
function unzip(bytes: Uint8Array, want: (name: string) => boolean): Unzipped {
  let total = 0
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        if (!want(f.name)) return false
        total += f.originalSize
        if (total > MAX_SOURCE_BYTES * 4)
          throw new SourceError(413, "The archive unpacks to more than 100 MB.")
        return true
      },
    })
  } catch (err) {
    if (err instanceof SourceError) throw err
    throw new SourceError(400, "The zip file can't be opened.")
  }
}

const EXPORT_FILES = /(^|\/)(conversations\.json|MyActivity\.json)$/i

function fromChatExport(json: unknown, what: string): ParsedSource | null {
  const exp = readChatExport(json)
  if (!exp) return null
  return {
    kind: "chat",
    title: oneLine(exp.title),
    mime: "application/json",
    segments: nonEmpty(
      segmentsDoc("chat", exp.format, segmentTurns(exp.turns)),
      what
    ),
  }
}

function fromZip(bytes: Uint8Array, filename: string): ParsedSource {
  const files = unzip(
    bytes,
    (n) =>
      n === "word/document.xml" ||
      n === "docProps/core.xml" ||
      EXPORT_FILES.test(n)
  )
  if (files["word/document.xml"]) {
    const md = docxToMarkdown(files)
    const read = segmentText(md)
    return {
      kind: read.kind === "chat" ? "chat" : "file",
      title: oneLine(docxTitle(files) ?? stem(filename)),
      mime: MIME.docx!,
      segments: nonEmpty(
        segmentsDoc(read.kind, "docx", read.segments),
        "The document"
      ),
    }
  }
  const name = Object.keys(files).find((n) => EXPORT_FILES.test(n))
  if (name) {
    const json = parseJson(utf8(files[name]!) ?? "")
    const parsed =
      json === undefined ? null : fromChatExport(json, "The export")
    if (parsed) return { ...parsed, mime: "application/zip" }
  }
  throw new SourceError(
    415,
    "This zip isn't a DOCX file or a ChatGPT, Claude or Gemini export."
  )
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function fromText(
  text: string,
  format: Extract<SourceFormat, "markdown" | "text" | "html">,
  title: string
): ParsedSource {
  const md = format === "html" ? htmlToMarkdown(text) : text
  const read = segmentText(md)
  return {
    kind: read.kind === "chat" ? "chat" : "file",
    title: oneLine(title),
    mime: MIME[format]!,
    segments: nonEmpty(
      segmentsDoc(read.kind, format, read.segments),
      "The file"
    ),
  }
}

/**
 * An uploaded file → a Source. The format comes from the bytes first (PDF,
 * zip), then the extension and content type. Throws SourceError.
 */
export async function parseFile(file: {
  bytes: Uint8Array
  filename: string
  type?: string
}): Promise<ParsedSource> {
  const { bytes, filename } = file
  const type = (file.type ?? "").toLowerCase()
  if (bytes.byteLength > MAX_SOURCE_BYTES)
    throw new SourceError(413, "Files are limited to 25 MB.")
  if (!bytes.byteLength) throw new SourceError(400, "The file is empty.")

  if (startsWith(bytes, "%PDF-")) {
    const { pdfPages } = await import("./pdf.ts")
    let read: Awaited<ReturnType<typeof pdfPages>>
    try {
      read = await pdfPages(bytes)
    } catch {
      throw new SourceError(400, "The PDF can't be read.")
    }
    return {
      kind: "file",
      title: oneLine(read.title ?? stem(filename)),
      mime: MIME.pdf!,
      segments: nonEmpty(
        segmentsDoc("document", "pdf", segmentPages(read.pages)),
        "The PDF (it may be scanned: there is no OCR yet)"
      ),
    }
  }
  if (startsWith(bytes, "PK\x03\x04")) return fromZip(bytes, filename)

  const text = utf8(bytes)
  if (text === null)
    throw new SourceError(
      415,
      "This file type isn't supported. Use a chat export, PDF, DOCX, Markdown, TXT or HTML file."
    )
  const body = text.replace(/^\uFEFF/, "")
  const e = ext(filename)
  const head = body.trimStart().slice(0, 200).toLowerCase()

  if (e === "json" || type.includes("json") || /^[[{]/.test(head)) {
    const json = parseJson(body)
    if (json !== undefined) {
      const parsed = fromChatExport(json, "The export")
      if (parsed) return parsed
      throw new SourceError(
        415,
        "This JSON isn't a ChatGPT, Claude or Gemini export."
      )
    }
    if (e === "json") throw new SourceError(400, "The JSON can't be read.")
  }
  if (
    e === "html" ||
    e === "htm" ||
    type.startsWith("text/html") ||
    head.startsWith("<!doctype html") ||
    head.startsWith("<html")
  )
    return fromText(body, "html", htmlTitle(body) ?? stem(filename))
  const format =
    e === "md" || e === "markdown" || type === "text/markdown"
      ? "markdown"
      : "text"
  return fromText(body, format, stem(filename))
}

/** A title for pasted text: the first heading, else the first user turn or line. */
function pasteTitle(doc: SegmentsDoc): string {
  const first =
    doc.kind === "chat"
      ? (doc.segments.find((s) => s.speaker === "user") ?? doc.segments[0])
      : doc.segments[0]
  const text = first?.heading ?? first?.text.split("\n")[0] ?? ""
  return oneLine(text, 80) || "Pasted text"
}

/**
 * Pasted text → a Source: a chat when speaker detection finds one (a
 * `chat-paste`), else a document.
 */
export function parsePaste(text: string, title?: string): ParsedSource {
  if (new TextEncoder().encode(text).byteLength > MAX_SOURCE_BYTES)
    throw new SourceError(413, "Pasted text is limited to 25 MB.")
  const read = segmentText(text)
  const doc = nonEmpty(
    segmentsDoc(
      read.kind,
      read.kind === "chat" ? "chat-paste" : "markdown",
      read.segments
    ),
    "The pasted text"
  )
  return {
    kind: read.kind === "chat" ? "chat" : "file",
    title: oneLine(title ?? "") || pasteTitle(doc),
    mime: read.kind === "chat" ? MIME["chat-paste"]! : MIME.markdown!,
    segments: doc,
  }
}

/**
 * A prompt on its own → a Source of kind prompt: one segment, s1. What the
 * build makes from it is background knowledge (empty provenance).
 */
export function parsePrompt(text: string, title?: string): ParsedSource {
  const t = text.trim()
  if (!t) throw new SourceError(400, "The prompt is empty.")
  if (new TextEncoder().encode(t).byteLength > MAX_SOURCE_BYTES)
    throw new SourceError(413, "The prompt is limited to 25 MB.")
  return {
    kind: "prompt",
    title: oneLine(title ?? "") || oneLine(t, 80),
    mime: MIME.prompt!,
    segments: segmentsDoc(
      "document",
      "prompt",
      splitLong({ id: "s1", text: t })
    ),
  }
}
