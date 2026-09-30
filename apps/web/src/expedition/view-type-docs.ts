// The View Type definitions (docs/view-types/*.md, part of the spec) bundled
// at build time, for the View panel's description and "Read the View Type".
// The candidates/ folder and the template are not View Types readers see.
import type { ViewTypeId } from "@seply/domain"

const files = import.meta.glob<string>("../../../../docs/view-types/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

export type ViewTypeDoc = {
  /** The markdown body, without the front matter and the leading H1. */
  body: string
  /** The paragraph under the title: what the View Type is. */
  intro: string
  /** The front matter's `answers`: the question it answers. */
  answers?: string
  status?: string
}

/** Splits a doc into front matter fields and its body. */
export function parseViewTypeDoc(md: string): ViewTypeDoc {
  const text = md.replace(/\r\n/g, "\n")
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  const meta: Record<string, string> = {}
  for (const line of fm?.[1]?.split("\n") ?? []) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line)
    if (m) meta[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1")
  }
  const body = text
    .slice(fm ? fm[0].length : 0)
    .replace(/^\s*# .*\n+/, "")
    .trim()
  const first = body.split(/\n\s*\n/)[0] ?? ""
  const intro = first.startsWith("#") ? "" : first
  return { body, intro, answers: meta.answers, status: meta.status }
}

const docs = new Map<string, ViewTypeDoc>()
for (const [path, md] of Object.entries(files)) {
  const id = /([^/]+)\.md$/.exec(path)?.[1]
  if (id && !id.startsWith("_") && id !== "README")
    docs.set(id, parseViewTypeDoc(md))
}

export function viewTypeDoc(id: ViewTypeId | string): ViewTypeDoc | undefined {
  return docs.get(id)
}
