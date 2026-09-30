// DOCX → markdown: the paragraphs of word/document.xml in order, with
// Heading1–4 and Title styles as headings and numbered or bulleted
// paragraphs as list items. Tables come out cell by cell. Enough to segment,
// not a faithful conversion.
import type { Unzipped } from "fflate"

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#")
      return String.fromCodePoint(
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10)
      )
    return ENTITIES[e] ?? m
  })
}

/** The text of one `<w:p>`: its runs' text, tabs and breaks. */
function paragraphText(xml: string): string {
  let text = ""
  const re =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) text += decode(m[1])
    else if (m[0].startsWith("<w:tab")) text += "\t"
    else text += "\n"
  }
  return text
}

export function docxToMarkdown(files: Unzipped): string {
  const doc = files["word/document.xml"]
  if (!doc) throw new Error("not a DOCX file: no word/document.xml")
  const xml = new TextDecoder().decode(doc)
  const out: string[] = []
  const paras = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []
  for (const p of paras) {
    const text = paragraphText(p).trim()
    if (!text) continue
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? ""
    const heading = /^heading\s*(\d)$/i.exec(style)
    if (heading) {
      out.push(`${"#".repeat(Math.min(Number(heading[1]), 4))} ${text}`)
    } else if (/^title$/i.test(style)) {
      out.push(`# ${text}`)
    } else if (/<w:numPr>/.test(p) || /^list/i.test(style)) {
      const level = Number(/<w:ilvl w:val="(\d+)"/.exec(p)?.[1] ?? 0)
      out.push(`${"  ".repeat(level)}- ${text}`)
    } else {
      out.push(text)
    }
  }
  // List items stay together; everything else is its own paragraph.
  return out
    .map((line, i) => {
      const list = /^\s*- /.test(line)
      const nextList = /^\s*- /.test(out[i + 1] ?? "")
      return line + (list && nextList ? "\n" : "\n\n")
    })
    .join("")
    .trim()
}

/** The core properties' title (docProps/core.xml), if set. */
export function docxTitle(files: Unzipped): string | undefined {
  const core = files["docProps/core.xml"]
  if (!core) return undefined
  const t = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(
    new TextDecoder().decode(core)
  )?.[1]
  return t ? decode(t).trim() || undefined : undefined
}
