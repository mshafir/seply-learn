// A rehype plugin for docs rendered from the repo (/self-host):
// - relative links become GitHub links, resolved against the doc's path in
//   the repo (in-page `#anchors` stay);
// - code blocks get `data-copy` (src/scripts/copy.ts adds a Copy button) and
//   `tabindex="0"`, so a block that scrolls can be scrolled from the keyboard
//   (tables too).
import { relative } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
export const GITHUB_BLOB = "https://github.com/mshafir/seply-learn/blob/main/"

type Node = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

function walk(node: Node, visit: (n: Node) => void) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** `href` resolved against the doc at `docPath` (repo-relative), as a GitHub URL. */
export function githubHref(href: string, docPath: string): string {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href
  return new URL(href, GITHUB_BLOB + docPath).href
}

export function rehypeRepoDocs() {
  return (tree: Node, file: { path?: string; history?: string[] }) => {
    const source = file.path ?? file.history?.[0]
    // Only files from the repo's docs (not the site's own pages).
    const docPath = source ? relative(REPO_ROOT, source) : undefined
    if (!docPath || docPath.startsWith("..") || docPath.startsWith("apps/"))
      return
    walk(tree, (n) => {
      if (n.type !== "element") return
      if (n.tagName === "a" && typeof n.properties?.href === "string")
        n.properties.href = githubHref(n.properties.href, docPath)
      if (n.tagName === "pre") {
        n.properties = { ...n.properties, dataCopy: "the code", tabIndex: 0 }
      }
      // Wide tables scroll sideways on a phone.
      if (n.tagName === "table") n.properties = { ...n.properties, tabIndex: 0 }
    })
  }
}
