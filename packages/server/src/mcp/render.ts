// The MCP tools' answers (spec §6.2): compact markdown with ids, never raw
// JSON dumps. Pure functions over `@seply/domain` state.
import {
  BUILTIN_KIND_BY_ID,
  BUILTIN_KINDS,
  BUILTIN_REL_TYPE_BY_ID,
  BUILTIN_REL_TYPES,
  isLive,
  type Concept,
  type DomainState,
  type Prov,
} from "@seply/domain"

/** One line of a table cell: no pipes or newlines. */
export const cell = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim()

/** At most `max` characters, cut at a word with an ellipsis. */
export const clip = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, "")}…`

const live = <T extends { deletedAt: string | null }>(r: Record<string, T>) =>
  Object.values(r).filter(isLive)

export const kindLabel = (s: DomainState, id: string) =>
  s.kinds[id]?.label ?? BUILTIN_KIND_BY_ID.get(id)?.label ?? id

export const relLabel = (s: DomainState, id: string) =>
  s.relTypes[id]?.label ?? BUILTIN_REL_TYPE_BY_ID.get(id)?.label ?? id

const relInverse = (s: DomainState, id: string) =>
  s.relTypes[id]?.inverseLabel ??
  BUILTIN_REL_TYPE_BY_ID.get(id)?.inverseLabel ??
  `(${relLabel(s, id)})`

export const conceptRef = (c: Pick<Concept, "id" | "title">) =>
  `${c.title} (\`${c.id}\`)`

function provText(prov: Prov): string {
  if (!prov.length) return "background knowledge"
  return prov
    .map((p) => `${p.source}#${p.segment}${p.quote ? ` “${p.quote}”` : ""}`)
    .join("; ")
}

/** get_expedition: the summary, Views, vocabulary, Sources and counts. */
export function renderExpedition(
  s: DomainState,
  meta: { role: string | null; visibility: string; link: string }
): string {
  const e = s.expedition
  const concepts = live(s.concepts)
  const rels = live(s.relationships)
  const views = live(s.views).sort((a, b) =>
    a.orderKey.localeCompare(b.orderKey)
  )
  const usedKinds = new Map<string, number>()
  for (const c of concepts)
    usedKinds.set(c.kind, (usedKinds.get(c.kind) ?? 0) + 1)
  const usedRels = new Map<string, number>()
  for (const r of rels) usedRels.set(r.type, (usedRels.get(r.type) ?? 0) + 1)
  const out = [
    `# ${e.title || "Untitled Expedition"} (\`${e.id}\`)`,
    "",
    e.summary || "_No summary yet._",
    "",
    `- Your role: ${meta.role ?? "reader"} · Visibility: ${meta.visibility} · Status: ${e.status}`,
    `- ${concepts.length} Concepts, ${rels.length} Relationships, ${views.length} Views, ${Object.keys(s.sources).length} Sources`,
    ...(e.tags.length
      ? [`- Tags: ${e.tags.map((t) => `#${t}`).join(" ")}`]
      : []),
    `- Open it: ${meta.link}`,
    "",
    "## Views",
    "",
    ...(views.length
      ? [
          "| View | id | View Type | Question | Status |",
          "|---|---|---|---|---|",
          ...views.map(
            (v) =>
              `| ${cell(v.label)}${v.id === e.bestViewId ? " (opens first)" : ""} | \`${v.id}\` | ${v.viewType} | ${cell(v.question)} | ${v.status} |`
          ),
        ]
      : ["_No Views yet._"]),
    "",
    "## Concept Kinds",
    "",
    ...kindLines(s, usedKinds),
    "",
    "## Relationship Types (read `from <label> to`)",
    "",
    ...relTypeLines(s, usedRels),
  ]
  const attrs = live(s.attributes)
  if (attrs.length)
    out.push(
      "",
      "## Attributes",
      "",
      ...attrs.map(
        (a) =>
          `- \`${a.id}\`: ${a.label} (${a.type}${a.unit ? `, ${a.unit}` : ""}${a.enumValues ? `: ${a.enumValues.join(" < ")}` : ""})`
      )
    )
  const sources = Object.values(s.sources)
  if (sources.length)
    out.push(
      "",
      "## Sources",
      "",
      ...sources.map(
        (src) => `- ${cell(src.title)} (\`${src.id}\`, ${src.kind})`
      )
    )
  return out.join("\n")
}

function kindLines(s: DomainState, used: Map<string, number>): string[] {
  const ids = new Set([
    ...BUILTIN_KINDS.map((k) => k.id),
    ...Object.keys(s.kinds),
  ])
  return [...ids]
    .filter((id) => !s.kinds[id]?.hidden)
    .map(
      (id) =>
        `- \`${id}\`: ${kindLabel(s, id)}${used.get(id) ? ` (${used.get(id)})` : ""}`
    )
}

function relTypeLines(s: DomainState, used: Map<string, number>): string[] {
  const ids = new Set([
    ...BUILTIN_REL_TYPES.map((t) => t.id),
    ...Object.keys(s.relTypes),
  ])
  return [...ids]
    .filter((id) => !s.relTypes[id]?.hidden)
    .map(
      (id) =>
        `- \`${id}\`: ${relLabel(s, id)} / ${relInverse(s, id)}${used.get(id) ? ` (${used.get(id)})` : ""}`
    )
}

export type Depth = "summary" | "overview" | "article"

/** get_concept: the Concept at a depth, and its neighbours up to `hops` away. */
export function renderConcept(
  s: DomainState,
  id: string,
  depth: Depth,
  hops: number
): string | null {
  const c = s.concepts[id]
  if (!isLive(c)) return null
  const concept = c!
  const out = [`# ${concept.title} (\`${concept.id}\`)`, ""]
  const facts = [
    `Kind: ${kindLabel(s, concept.kind)} (\`${concept.kind}\`)`,
    ...(concept.aliases.length
      ? [`Also called: ${concept.aliases.join(", ")}`]
      : []),
    ...(concept.tags.length
      ? [`Tags: ${concept.tags.map((t) => `#${t}`).join(" ")}`]
      : []),
    ...(concept.date
      ? [
          `Date: ${concept.date}${concept.dateEnd ? ` – ${concept.dateEnd}` : ""}${concept.dateApprox ? " (approx.)" : ""}`,
        ]
      : []),
    ...(concept.weightPin ? [`Weight: pinned ${concept.weightPin}`] : []),
    ...Object.entries(concept.attributes).map(
      ([k, v]) =>
        `${s.attributes[k]?.label ?? k}: ${String(v)}${s.attributes[k]?.unit ? ` ${s.attributes[k]!.unit}` : ""}`
    ),
    `From: ${provText(concept.prov)}`,
  ]
  out.push(...facts.map((f) => `- ${f}`), "")
  out.push(`**Summary:** ${concept.summary || "_none yet_"}`)
  if (depth !== "summary")
    out.push("", "## Overview", "", concept.overview || "_No overview yet._")
  if (depth === "article") {
    const sections = live(s.sections)
      .filter((x) => x.conceptId === id)
      .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
    out.push("", "## Article", "")
    if (!sections.length) out.push("_No article yet._")
    for (const x of sections) out.push(`### ${x.heading}`, "", x.md, "")
  }
  if (hops > 0) out.push("", ...renderNeighbours(s, id, hops))
  return out.join("\n").trim()
}

/** The Concepts up to `hops` Relationships away, nearest first. */
function renderNeighbours(
  s: DomainState,
  start: string,
  hops: number
): string[] {
  const rels = live(s.relationships)
  const out = ["## Neighbours", ""]
  const seen = new Set([start])
  let frontier = [start]
  for (let hop = 1; hop <= hops && frontier.length; hop++) {
    const next: string[] = []
    const lines: string[] = []
    for (const id of frontier)
      for (const r of rels) {
        const other = r.from === id ? r.to : r.to === id ? r.from : null
        if (!other || seen.has(other)) continue
        const o = s.concepts[other]
        if (!isLive(o)) continue
        seen.add(other)
        next.push(other)
        const from = s.concepts[id]!
        const phrase =
          r.from === id
            ? `${from.title} ${relLabel(s, r.type)} ${o!.title}`
            : `${o!.title} ${relLabel(s, r.type)} ${from.title}`
        lines.push(
          hop === 1
            ? `- ${phrase} (\`${o!.id}\`)${o!.summary ? `: ${cell(o!.summary)}` : ""}${r.note ? ` (note: ${cell(r.note)})` : ""}`
            : `- ${phrase} (\`${o!.id}\`)`
        )
        if (lines.length >= 60) break
      }
    if (!lines.length) break
    out.push(
      hop === 1 ? "Directly linked:" : `${hop} hops away:`,
      "",
      ...lines,
      ""
    )
    frontier = next
  }
  if (out.length === 2) out.push("_No Relationships yet._")
  return out
}

/** get_view without a renderer: the View's settings and the Concepts it can show. */
export function renderViewPlain(s: DomainState, viewId: string): string | null {
  const v = s.views[viewId]
  if (!isLive(v)) return null
  const view = v!
  const hidden = new Set((view.settings.hide as string[] | undefined) ?? [])
  const concepts = live(s.concepts).filter((c) => !hidden.has(c.id))
  return [
    `# ${view.label} (\`${view.id}\`, ${view.viewType})`,
    "",
    ...(view.question ? [`Answers: ${view.question}`, ""] : []),
    "Settings:",
    "",
    "```json",
    JSON.stringify(view.settings),
    "```",
    "",
    `## Concepts (${concepts.length})`,
    "",
    ...concepts
      .slice(0, 300)
      .map(
        (c) =>
          `- ${conceptRef(c)} · ${kindLabel(s, c.kind)}${c.summary ? `: ${cell(c.summary)}` : ""}`
      ),
  ].join("\n")
}

/** The ids of Concepts a View's reading names, for an agent to follow up on. */
export function conceptLegend(s: DomainState, reading: string): string[] {
  const named = live(s.concepts).filter(
    (c) => c.title.length > 1 && reading.includes(c.title)
  )
  return named.slice(0, 300).map((c) => `- ${conceptRef(c)}`)
}
