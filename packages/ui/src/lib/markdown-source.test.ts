import { describe, expect, it } from "vitest"
import { upsertLink } from "@platejs/link"

import { createMarkdownEditor as load } from "@seply/ui/components/markdown-editor"
import { serializeMarkdown } from "@seply/ui/lib/markdown-source"

const SAMPLE = `Intro with **bold**, *italic*, \`code\` and a [Concept](#c/kv-cache) link.

## A heading

- one, with ~3× growth
- two
  - nested

1. first
2. second

> A quote.

| A | B |
|---|---|
| [x](#c/x) | 1 |

\`\`\`ts
const x = 1
\`\`\`

<b>raw html</b> and pass@1

Last line.
`

describe("markdown round trip", () => {
  it("writes untouched markdown back exactly", () => {
    for (const md of [
      SAMPLE,
      "",
      "One paragraph.",
      "\n\nLeading\n\n\n\ntrailing\n\n",
    ]) {
      expect(serializeMarkdown(load(md))).toBe(md)
    }
  })

  it("rewrites only the block that changed", () => {
    const editor = load(SAMPLE)
    // The last paragraph, "Last line."
    const last = editor.children.length - 1
    editor.tf.insertText(" More.", { at: editor.api.end([last]) })
    expect(serializeMarkdown(editor)).toBe(
      SAMPLE.replace("Last line.\n", "Last line. More.\n")
    )
  })

  it("serializes new blocks: bold, a list and a Concept link", () => {
    const editor = load("Plain")
    editor.tf.select(editor.api.range([0])!)
    editor.tf.toggleMark("bold")
    editor.tf.insertNodes(
      {
        type: "p",
        listStyleType: "disc",
        indent: 1,
        children: [{ text: "item" }],
      },
      { at: [1] }
    )
    editor.tf.insertNodes(
      { type: "p", children: [{ text: "See " }] },
      { at: [2] }
    )
    editor.tf.select(editor.api.end([2]))
    upsertLink(editor, { url: "#c/01ABC", text: "that" })
    expect(serializeMarkdown(editor)).toBe(
      "**Plain**\n\n- item\n\nSee [that](#c/01ABC)"
    )
  })

  it("keeps what Plate can't read while its block is untouched", () => {
    const md = "A [link][r].\n\n[r]: https://example.com\n\nEdit me"
    const editor = load(md)
    editor.tf.insertText("!", { at: editor.api.end([1]) })
    expect(serializeMarkdown(editor)).toBe(
      "A [link][r].\n\n[r]: https://example.com\n\nEdit me!"
    )
  })
})
