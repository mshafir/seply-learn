// Reads the playbook's inputs from disk. Node only (the script and tests);
// not exported from the package.
import { readdirSync, readFileSync } from "node:fs"

const root = new URL("../../../../", import.meta.url)

export function playbookInputs(): {
  skim: string
  viewTypes: Record<string, string>
  playbook: Record<string, string>
} {
  const pb = new URL("packages/ai/playbook/", root)
  const playbook: Record<string, string> = {}
  for (const name of readdirSync(pb))
    if (name.endsWith(".md")) playbook[name] = readFileSync(new URL(name, pb), "utf8")
  const dir = new URL("docs/view-types/", root)
  const viewTypes: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".md"))
      viewTypes[name] = readFileSync(new URL(name, dir), "utf8")
  }
  return {
    skim: readFileSync(new URL("packages/ai/playbook/skim.md", root), "utf8"),
    viewTypes,
    playbook,
  }
}
