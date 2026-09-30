// The committed fixtures as Source text, for the estimate's accuracy check
// (src/estimate.test.ts and scripts/measure-estimate.ts). Test and script use
// only; not exported from the package. Public data only: the research doc and
// the compute sample (its Concepts' prose, rendered as markdown, stands in for
// the chat it was built from, which is not committed).
import { readFileSync } from "node:fs"

const root = new URL("../../../", import.meta.url)

type FixtureConcept = {
  title: string
  summary?: string
  overview?: string
  sections?: { heading: string; md: string }[]
}

function computeText(): string {
  const doc = JSON.parse(
    readFileSync(
      new URL("packages/domain/fixtures/compute.json", root),
      "utf8"
    )
  ) as { title: string; concepts: FixtureConcept[] }
  const parts = [`# ${doc.title}`]
  for (const c of doc.concepts) {
    parts.push(`## ${c.title}`)
    if (c.summary) parts.push(c.summary)
    if (c.overview) parts.push(c.overview)
    for (const s of c.sections ?? []) {
      if (s.heading) parts.push(`### ${s.heading}`)
      parts.push(s.md)
    }
  }
  return parts.join("\n\n")
}

export type FixtureSource = { name: string; text: string }

export function fixtureSources(): FixtureSource[] {
  return [
    {
      name: "research-doc",
      text: readFileSync(
        new URL("docs/research/knowledge-graph-learning-tools.md", root),
        "utf8"
      ),
    },
    { name: "compute", text: computeText() },
  ]
}
