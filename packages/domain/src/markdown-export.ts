// The Markdown folder export (spec §1.9): an Expedition as an Obsidian-readable
// folder. One note per Concept (frontmatter, the summary, overview and article,
// and Relationships as typed `[[wikilinks]]`), one index note per View, and an
// index note for the Expedition. Pure: it reads our JSON and returns the notes;
// the caller zips them.
//
// Every note's file name (without `.md`) is unique across the folder, ignoring
// case, so a `[[name]]` resolves to exactly one note in Obsidian (which
// resolves wikilinks by file name) on any file system.
import { BUILTIN_KIND_BY_ID, BUILTIN_REL_TYPE_BY_ID } from "./builtins.ts"
import { readSettingsRefs, type ExpeditionJson } from "./expedition-json.ts"
import { VIEW_TYPES } from "./view-types.ts"

export type MarkdownNote = {
  /** Relative to the folder, with `/` separators, e.g. `Concepts/GQA.md`. */
  path: string
  text: string
}

export type MarkdownFolder = {
  /** The folder's own name (the Expedition's title, made safe). */
  folder: string
  notes: MarkdownNote[]
}

const CONCEPTS_DIR = "Concepts"
const VIEWS_DIR = "Views"
const MAX_NAME = 80

/** A title as a file name Obsidian, Windows and macOS all accept. */
export function noteName(title: string): string {
  const name = title
    // Obsidian refuses * " \ / < > : | ? and treats # ^ [ ] as link syntax.
    .replace(/[*"\\/<>:|?#^[\]]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot hides the file; trailing dots and spaces break Windows.
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, MAX_NAME)
    .trim()
  return name || "Untitled"
}

/** Hands out file names unique across the folder, case-insensitively. */
function nameAllocator() {
  const taken = new Set<string>()
  return (title: string) => {
    const base = noteName(title)
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`
    taken.add(name.toLowerCase())
    return name
  }
}

/** Link text may not hold `|` or `]` inside a wikilink. */
const linkText = (s: string) => s.replace(/[|[\]]/g, " ").trim()

const wikilink = (name: string, text: string) => {
  const shown = linkText(text)
  return !shown || shown === name ? `[[${name}]]` : `[[${name}|${shown}]]`
}

/** A YAML scalar: JSON strings, numbers and booleans are valid YAML. */
const yaml = (v: string | number | boolean) => JSON.stringify(v)

function frontmatter(
  fields: [string, string | number | boolean | string[] | undefined][]
): string {
  const lines = ["---"]
  for (const [key, value] of fields) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      if (!value.length) continue
      lines.push(`${key}:`, ...value.map((v) => `  - ${yaml(v)}`))
    } else lines.push(`${key}: ${yaml(value)}`)
  }
  lines.push("---", "")
  return lines.join("\n")
}

/** Obsidian tags: letters, digits, `_`, `-` and `/`; not only digits. */
function obsidianTag(tag: string): string | null {
  const t = tag
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_\-/]/gu, "")
  if (!t) return null
  return /^[\d/_-]+$/.test(t) ? `_${t}` : t
}

const tagsOf = (tags: readonly string[]) => [
  ...new Set(tags.flatMap((t) => obsidianTag(t) ?? [])),
]

/** "comparison-table" → "Comparison table". */
const viewTypeName = (id: string) => {
  const s = id.replace(/-/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A link that leaves the folder: a URL (`https:`, `mailto:`) or an anchor. */
const isExternal = (href: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")

/** Our JSON as an Obsidian-readable folder of Markdown notes. */
export function expeditionToMarkdown(doc: ExpeditionJson): MarkdownFolder {
  const name = nameAllocator()
  const conceptName = new Map<string, string>()
  for (const c of doc.concepts) conceptName.set(c.id, name(c.title))
  const viewName = new Map<string, string>()
  for (const v of doc.views) viewName.set(v.id, name(v.label))
  const title = doc.title.trim() || "Untitled Expedition"
  const indexName = name(title)

  const kindLabel = new Map<string, string>()
  for (const [id, k] of BUILTIN_KIND_BY_ID) kindLabel.set(id, k.label)
  for (const k of doc.kinds) kindLabel.set(k.id, k.label)
  const relType = new Map<string, { label: string; inverse: string }>()
  for (const [id, t] of BUILTIN_REL_TYPE_BY_ID)
    relType.set(id, { label: t.label, inverse: t.inverseLabel })
  for (const t of doc.relationshipTypes)
    relType.set(t.id, { label: t.label, inverse: t.inverseLabel })
  const attributes = new Map(doc.attributes.map((a) => [a.id, a]))
  const conceptTitle = new Map(doc.concepts.map((c) => [c.id, c.title]))

  const toConcept = (id: string, text = conceptTitle.get(id) ?? "") => {
    const n = conceptName.get(id)
    return n ? wikilink(n, text) : linkText(text)
  }

  /**
   * Markdown from the Expedition, with in-text Concept links (`[text](#c/id)`)
   * as wikilinks. Any `[[` already in it is escaped, so every wikilink in the
   * folder is one we wrote, and other relative links (which would point
   * nowhere in the folder) become their text. Web links stay.
   */
  const body = (md: string) =>
    md
      .replaceAll("[[", "\\[\\[")
      .replace(
        /\[([^\]\n]*)\]\(#c\/([^\s)]+)\)/g,
        (_, text: string, id: string) =>
          conceptName.has(id) ? toConcept(id, text) : text
      )
      .replace(
        /(?<!!)\[([^\]\n]*)\]\(([^)\s]+)\)/g,
        (link: string, text: string, href: string) =>
          isExternal(href) ? link : text
      )

  // Relationships, both ways, by type label.
  const links = new Map<string, Map<string, string[]>>()
  const addLink = (conceptId: string, heading: string, line: string) => {
    const byHeading = links.get(conceptId) ?? new Map<string, string[]>()
    const list = byHeading.get(heading) ?? []
    list.push(line)
    byHeading.set(heading, list)
    links.set(conceptId, byHeading)
  }
  for (const r of doc.relationships) {
    const t = relType.get(r.type) ?? { label: r.type, inverse: r.type }
    const note = r.note ? ` (${r.note.replace(/\n+/g, " ")})` : ""
    addLink(r.from, t.label, `- ${toConcept(r.to)}${note}`)
    addLink(r.to, t.inverse, `- ${toConcept(r.from)}${note}`)
  }

  const notes: MarkdownNote[] = []

  for (const c of doc.concepts) {
    const n = conceptName.get(c.id)!
    const fields: [string, string | number | boolean | string[] | undefined][] =
      [
        ["title", c.title],
        ["kind", kindLabel.get(c.kind) ?? c.kind],
        ["aliases", [...(n === c.title ? [] : [c.title]), ...c.aliases]],
        ["tags", tagsOf(c.tags)],
        ["summary", c.summary],
        ["date", c.date],
        ["date-end", c.dateEnd],
        ["date-approximate", c.dateApprox || undefined],
        ["lane", c.lane],
        ["latitude", c.lat],
        ["longitude", c.lon],
        ["weight", c.weightPin],
      ]
    for (const [id, value] of Object.entries(c.attributes)) {
      const def = attributes.get(id)
      if (!def) continue
      fields.push([def.unit ? `${def.label} (${def.unit})` : def.label, value])
    }
    fields.push(["seply-id", c.id])
    const parts = [frontmatter(fields)]
    if (c.summary) parts.push(`> ${c.summary.replace(/\n+/g, " ")}\n`)
    if (c.overview) parts.push(`${body(c.overview).trim()}\n`)
    if (c.sections.length) {
      parts.push("## Article\n")
      for (const s of c.sections) {
        if (s.heading) parts.push(`### ${s.heading.replace(/\n+/g, " ")}\n`)
        parts.push(`${body(s.md).trim()}\n`)
      }
    }
    const byHeading = links.get(c.id)
    if (byHeading) {
      parts.push("## Relationships\n")
      for (const [heading, lines] of byHeading)
        parts.push(`### ${heading}\n\n${lines.join("\n")}\n`)
    }
    notes.push({ path: `${CONCEPTS_DIR}/${n}.md`, text: parts.join("\n") })
  }

  const byTitle = (a: { title: string }, b: { title: string }) =>
    a.title.localeCompare(b.title)

  for (const v of doc.views) {
    const refs = VIEW_TYPES[v.viewType].refs
    const kinds = new Set(
      refs.kinds.flatMap((p) => readSettingsRefs(v.settings, p))
    )
    const hidden = new Set(
      Array.isArray(v.settings.hide) ? (v.settings.hide as string[]) : []
    )
    const central = [
      ...new Set(refs.concepts.flatMap((p) => readSettingsRefs(v.settings, p))),
    ].filter((id) => conceptName.has(id))
    const members = doc.concepts
      .filter((c) => !hidden.has(c.id) && (!kinds.size || kinds.has(c.kind)))
      .sort(byTitle)
    const parts = [
      frontmatter([
        ["view-type", viewTypeName(v.viewType)],
        ["question", v.question],
        ["best-view", doc.bestViewId === v.id || undefined],
        ["seply-id", v.id],
      ]),
      `Part of ${wikilink(indexName, title)}.\n`,
    ]
    if (v.question) parts.push(`> ${v.question.replace(/\n+/g, " ")}\n`)
    if (central.length)
      parts.push(
        `## Starts from\n\n${central.map((id) => `- ${toConcept(id)}`).join("\n")}\n`
      )
    parts.push(
      `## Concepts\n\n${members.map((c) => `- ${toConcept(c.id)}`).join("\n") || "None yet."}\n`
    )
    notes.push({
      path: `${VIEWS_DIR}/${viewName.get(v.id)!}.md`,
      text: parts.join("\n"),
    })
  }

  // The Expedition's own note: its Views, then its Concepts by Kind.
  const parts = [
    frontmatter([
      ["title", title],
      ["tags", tagsOf(doc.tags)],
      ["summary", doc.summary || undefined],
      ["seply-id", doc.id],
    ]),
  ]
  if (doc.summary) parts.push(`${doc.summary}\n`)
  if (doc.views.length)
    parts.push(
      `## Views\n\n${doc.views
        .map(
          (v) =>
            `- ${wikilink(viewName.get(v.id)!, v.label)}${v.question ? `: ${v.question.replace(/\n+/g, " ")}` : ""}`
        )
        .join("\n")}\n`
    )
  const byKind = new Map<string, ExpeditionJson["concepts"]>()
  for (const c of [...doc.concepts].sort(byTitle)) {
    const label = kindLabel.get(c.kind) ?? c.kind
    byKind.set(label, [...(byKind.get(label) ?? []), c])
  }
  if (byKind.size) {
    parts.push("## Concepts\n")
    for (const [label, list] of [...byKind].sort(([a], [b]) =>
      a.localeCompare(b)
    ))
      parts.push(
        `### ${label}\n\n${list
          .map(
            (c) =>
              `- ${toConcept(c.id)}${c.summary ? `: ${c.summary.replace(/\n+/g, " ")}` : ""}`
          )
          .join("\n")}\n`
      )
  }
  if (doc.sources.length)
    parts.push(
      `## Sources\n\n${doc.sources.map((s) => `- ${s.title.replace(/\n+/g, " ")} (${s.kind})`).join("\n")}\n`
    )
  notes.push({ path: `${indexName}.md`, text: parts.join("\n") })

  return { folder: noteName(title), notes }
}

/**
 * The links in a Markdown folder that don't resolve: every `[[wikilink]]` must
 * name a note's file name (or its path, without `.md`), and every relative
 * `[text](path)` a file in the folder. `files` are the folder's paths.
 */
export function brokenMarkdownLinks(
  notes: readonly MarkdownNote[],
  files: readonly string[] = notes.map((n) => n.path)
): { path: string; link: string }[] {
  const all = new Set(files.map((f) => f.toLowerCase()))
  const byName = new Set(
    files.map((f) => f.split("/").pop()!.replace(/\.md$/i, "").toLowerCase())
  )
  const broken: { path: string; link: string }[] = []
  for (const note of notes) {
    // Escaped brackets aren't links.
    const text = note.text.replace(/\\\[/g, "")
    for (const m of text.matchAll(/\[\[([^\]]*)\]\]/g)) {
      const target = m[1].split("|")[0].split("#")[0].trim().toLowerCase()
      if (!byName.has(target) && !all.has(`${target}.md`) && !all.has(target))
        broken.push({ path: note.path, link: m[0] })
    }
    for (const m of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const href = m[1]
      if (isExternal(href)) continue
      let target = href.split("#")[0]
      try {
        target = decodeURI(target)
      } catch {
        // Not percent-encoded after all: read it as it is.
      }
      const dir = note.path.split("/").slice(0, -1)
      let outside = false
      for (const seg of target.split("/")) {
        if (seg === "..") outside ||= dir.pop() === undefined
        else if (seg !== "." && seg) dir.push(seg)
      }
      if (outside || !all.has(dir.join("/").toLowerCase()))
        broken.push({ path: note.path, link: m[0] })
    }
  }
  return broken
}
