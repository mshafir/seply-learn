// HTML → markdown, enough to segment: headings, paragraphs, lists, quotes,
// code blocks and line breaks. Scripts, styles and the like are dropped;
// links keep their text only.
import { HTMLElement, NodeType, parse, type Node } from "node-html-parser"

const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
  "iframe",
  "object",
  "canvas",
  "button",
  "select",
  "form",
])
const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "nav",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tr",
  "dl",
  "dt",
  "dd",
  "details",
  "summary",
  "address",
  "body",
  "html",
])

const squash = (s: string) => s.replace(/\s+/g, " ")

/** Inline text of a node: whitespace collapsed, `<br>` kept as a line break. */
function inline(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) return squash(node.text)
  if (!(node instanceof HTMLElement)) return ""
  const tag = node.rawTagName?.toLowerCase() ?? ""
  if (SKIP.has(tag)) return ""
  if (tag === "br") return "\n"
  const inner = node.childNodes.map(inline).join("")
  if ((tag === "strong" || tag === "b") && inner.trim())
    return `**${inner.trim()}**`
  if ((tag === "em" || tag === "i") && inner.trim()) return `*${inner.trim()}*`
  if (tag === "code") return `\`${inner}\``
  if (tag === "td" || tag === "th") return ` ${inner.trim()} |`
  return inner
}

function blocks(node: Node, out: string[], listDepth = 0): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const t = squash(node.text)
    if (t.trim()) out.push(t)
    return
  }
  if (!(node instanceof HTMLElement)) return
  const tag = node.rawTagName?.toLowerCase() ?? ""
  if (SKIP.has(tag)) return
  const h = /^h([1-6])$/.exec(tag)
  if (h) {
    const text = squash(node.text).trim()
    if (text)
      out.push(`\n\n${"#".repeat(Math.min(Number(h[1]), 4))} ${text}\n\n`)
    return
  }
  if (tag === "pre") {
    out.push(`\n\n\`\`\`\n${node.text.replace(/\n$/, "")}\n\`\`\`\n\n`)
    return
  }
  if (tag === "ul" || tag === "ol") {
    if (!listDepth) out.push("\n\n")
    let n = 0
    for (const child of node.childNodes) {
      if (!(child instanceof HTMLElement)) continue
      if (child.rawTagName?.toLowerCase() !== "li") continue
      n++
      const bullet = tag === "ol" ? `${n}.` : "-"
      const nested: string[] = []
      const own: Node[] = []
      for (const c of child.childNodes) {
        const t = c instanceof HTMLElement ? c.rawTagName?.toLowerCase() : ""
        if (t === "ul" || t === "ol") blocks(c, nested, listDepth + 1)
        else own.push(c)
      }
      const text = own.map(inline).join("").trim()
      out.push(`${"  ".repeat(listDepth)}${bullet} ${text}\n`)
      out.push(...nested)
    }
    if (!listDepth) out.push("\n\n")
    return
  }
  if (tag === "blockquote") {
    const inner: string[] = []
    for (const c of node.childNodes) blocks(c, inner, listDepth)
    const text = tidy(inner.join(""))
    if (text)
      out.push(
        `\n\n${text
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n")}\n\n`
      )
    return
  }
  if (tag === "tr") {
    out.push(`|${node.childNodes.map(inline).join("")}\n`)
    return
  }
  if (tag === "hr") {
    out.push("\n\n")
    return
  }
  if (BLOCK.has(tag) || tag === "" || tag === "li") {
    // A block: its block children in turn, runs of inline content as paragraphs.
    let run: Node[] = []
    const flush = () => {
      const text = run.map(inline).join("").trim()
      if (text) out.push(`\n\n${text}\n\n`)
      run = []
    }
    for (const c of node.childNodes) {
      const t =
        c instanceof HTMLElement ? (c.rawTagName?.toLowerCase() ?? "") : ""
      if (
        c instanceof HTMLElement &&
        (BLOCK.has(t) ||
          /^h[1-6]$/.test(t) ||
          ["pre", "ul", "ol", "blockquote", "hr", "tr", "li"].includes(t))
      ) {
        flush()
        blocks(c, out, listDepth)
      } else run.push(c)
    }
    flush()
    return
  }
  // Inline at block level (a stray <span>, <a>): its text as a paragraph.
  const text = inline(node).trim()
  if (text) out.push(`\n\n${text}\n\n`)
}

const tidy = (md: string) =>
  md
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

/** The page's `<title>`, if any. */
export function htmlTitle(html: string): string | undefined {
  const root = parse(html)
  const t = root.querySelector("title")?.text.trim()
  return t || undefined
}

export function htmlToMarkdown(html: string): string {
  const root = parse(html, {
    comment: false,
    blockTextElements: { script: false, style: false },
  })
  const body = root.querySelector("body") ?? root
  const out: string[] = []
  blocks(body, out)
  return tidy(out.join(""))
}
