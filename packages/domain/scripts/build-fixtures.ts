// Regenerates the import fixtures in ../fixtures from the committed prototype
// graphs, by upgrading them (version 0, the sample-graph format) to our JSON:
//
//   mise exec -- pnpm --filter @seply/domain fixtures
//
// Only public material goes here: the hand-made compute sample and the
// Expedition generated from docs/research/knowledge-graph-learning-tools.md.
// Never the statins, printer or family-trip graphs (see the plan's
// private-data rule).
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseExpeditionJson } from "../src/expedition-json.ts"

const at = "2026-06-17T00:00:00.000Z"
const graphs = (name: string) =>
  fileURLToPath(
    new URL(
      `../../../prototypes/sample-graphs/src/graphs/${name}.json`,
      import.meta.url
    )
  )
const out = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url))

const FIXTURES = [
  { name: "compute", from: "compute" },
  {
    name: "research-doc",
    from: "gen-kg-learning-tools-doc",
    // Its Source is the committed research document.
    source: {
      title: "knowledge-graph-learning-tools.md",
      mime: "text/markdown",
    },
  },
]

for (const f of FIXTURES) {
  const raw = JSON.parse(readFileSync(graphs(f.from), "utf8")) as unknown
  const doc = parseExpeditionJson(raw, { at })
  if (f.source) for (const s of doc.sources) Object.assign(s, f.source)
  writeFileSync(out(f.name), JSON.stringify(doc, null, 1) + "\n")
  console.log(
    `${f.name}: ${doc.concepts.length} Concepts, ${doc.relationships.length} Relationships, ${doc.views.length} Views`
  )
}
