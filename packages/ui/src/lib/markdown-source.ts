// Markdown in and out of a Plate editor, without rewriting what the person
// didn't touch.
//
// Plate's serializer is faithful in meaning but not in spelling: it pads
// table rows, writes `| - |` delimiters, escapes `~` and `@`, and reorders
// some nested marks. Markdown is the stored format, so a blur that changed
// nothing must write nothing, and an edit to one paragraph must not reformat
// the table under it. So the markdown is split into top-level blocks (by
// the same remark parse Plate uses) and each keeps its source text. When the
// editor is serialized, every block whose nodes are still exactly what that
// source produced is written back verbatim, with the blank lines that
// followed it; only new or edited blocks go through Plate's serializer.
import type { Descendant, SlateEditor, Value } from "platejs"
import { MarkdownPlugin, markdownToAstProcessor } from "@platejs/markdown"
import remarkGfm from "remark-gfm"

/**
 * The Markdown plugin, configured for GFM (tables, strikethrough) and for
 * the house spelling of new blocks: `-` bullets, `*` emphasis, fenced code.
 */
export const MarkdownKit = MarkdownPlugin.configure({
  options: {
    remarkPlugins: [remarkGfm],
    remarkStringifyOptions: {
      bullet: "-",
      emphasis: "*",
      strong: "*",
      rule: "-",
      fences: true,
    },
  },
})

interface Block {
  /** The block's markdown, without its trailing newlines. */
  raw: string
  /** What followed it: newlines and any content Plate ignores. */
  gap: string
  /** Its nodes, as `canon` strings. */
  nodes: string[]
}

export interface MarkdownSource {
  lead: string
  blocks: Block[]
}

const sources = new WeakMap<object, MarkdownSource | null>()

type AnyNode = { [key: string]: unknown; children?: AnyNode[]; text?: string }

const stable = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : v
  )

/**
 * A node's content, ignoring what the editor's normalizing may change:
 * generated ids, empty text around inline links, split runs of one mark.
 */
function shape(node: AnyNode): AnyNode {
  const { children, ...rest } = node
  delete rest.id
  delete rest._memo
  // The list normalizer drops a first item's `listStart: 1`.
  if (rest.listStart === 1) delete rest.listStart
  if (!children) return rest
  const kids: AnyNode[] = []
  for (const child of children.map(shape)) {
    if (child.text === "") continue
    const prev = kids.at(-1)
    if (
      prev?.text !== undefined &&
      child.text !== undefined &&
      stable({ ...prev, text: "" }) === stable({ ...child, text: "" })
    ) {
      prev.text += child.text
      continue
    }
    kids.push(child)
  }
  return { ...rest, children: kids }
}

/** A node as a comparable string. */
const canon = (node: Descendant) => stable(shape(node as AnyNode))

const ZWSP = String.fromCharCode(0x200b)

const trimNewlines = (s: string) => s.replace(/\n+$/, "")

const emptyValue = (): Value => [{ type: "p", children: [{ text: "" }] }]

/**
 * Parses `markdown` into the editor's value and remembers each block's
 * source on the editor, for `serializeMarkdown`.
 */
export function deserializeMarkdown(
  editor: SlateEditor,
  markdown: string
): Value {
  const deserialize = (md: string) =>
    editor.getApi(MarkdownPlugin).markdown.deserialize(md) as Descendant[]
  const source: MarkdownSource = { lead: "", blocks: [] }
  const value: Descendant[] = []
  // Blank lines, and anything Plate drops (link reference definitions, say),
  // ride along with the block before them, so they survive while it does.
  const keep = (text: string) => {
    const last = source.blocks.at(-1)
    if (last) last.gap += text
    else source.lead += text
  }
  let at = 0
  for (const child of markdownToAstProcessor(editor, markdown).children) {
    const start = child.position?.start.offset
    const end = child.position?.end.offset
    if (start === undefined || end === undefined) continue
    keep(markdown.slice(at, start))
    at = end
    const raw = markdown.slice(start, end)
    const nodes = deserialize(raw)
    if (nodes.length === 0) {
      keep(raw)
      continue
    }
    source.blocks.push({ raw, gap: "", nodes: nodes.map(canon) })
    value.push(...nodes)
  }
  keep(markdown.slice(at))
  sources.set(editor, source)
  return value.length ? (value as Value) : emptyValue()
}

/**
 * The editor's value as markdown: untouched blocks exactly as they were
 * loaded, the rest serialized by Plate.
 */
export function serializeMarkdown(
  editor: SlateEditor,
  value: Value = editor.children
): string {
  const serialize = (nodes: Descendant[]) =>
    trimNewlines(
      editor
        .getApi(MarkdownPlugin)
        .markdown.serialize({ value: nodes as Value })
        // Plate writes empty text beside an inline link as a zero-width space.
        .replaceAll(ZWSP, "")
    )
  const source = sources.get(editor)
  if (!source) return serialize(value)

  const { blocks } = source
  const keys = value.map(canon)
  const used = new Set<number>()
  const matches = (b: number, at: number) =>
    !used.has(b) && blocks[b]!.nodes.every((n, k) => keys[at + k] === n)

  const pieces: { text: string; block?: number }[] = []
  let pending: Descendant[] = []
  const flush = () => {
    const text = pending.length ? serialize(pending) : ""
    if (text) pieces.push({ text })
    pending = []
  }
  let next = 0
  for (let i = 0; i < value.length;) {
    // The block that came next in the source first, then any other.
    let b = next < blocks.length && matches(next, i) ? next : -1
    if (b < 0) b = blocks.findIndex((_, k) => matches(k, i))
    if (b < 0) {
      pending.push(value[i]!)
      i++
      continue
    }
    flush()
    used.add(b)
    pieces.push({ text: blocks[b]!.raw, block: b })
    i += blocks[b]!.nodes.length
    next = b + 1
  }
  flush()

  const hasContent = (gap: string) => gap.trim() !== ""
  // A gap is written after its block whatever comes next, if it holds
  // content Plate can't show; between two untouched neighbours it is
  // written exactly. Content in the gaps of blocks that were edited or
  // deleted goes at the end, so it is never lost silently.
  let out = pieces[0]?.block === 0 || hasContent(source.lead) ? source.lead : ""
  if (out && pieces[0]?.block !== 0) out = trimNewlines(out) + "\n\n"
  const orphans = blocks
    .filter((block, b) => !used.has(b) && hasContent(block.gap))
    .map((block) => block.gap.trim())
  pieces.forEach((piece, k) => {
    out += piece.text
    const after = pieces[k + 1]
    const gap = piece.block === undefined ? "" : blocks[piece.block]!.gap
    if (after)
      out +=
        piece.block !== undefined && after.block === piece.block + 1
          ? gap
          : hasContent(gap)
            ? trimNewlines(gap) + "\n\n"
            : "\n\n"
    else if (piece.block === blocks.length - 1 && !orphans.length) out += gap
    else {
      if (hasContent(gap)) out += trimNewlines(gap)
      for (const orphan of orphans) out += "\n\n" + orphan
      // The document's trailing newlines stay.
      out += blocks.at(-1)?.gap.match(/\n*$/)?.[0] ?? ""
    }
  })
  return out
}
