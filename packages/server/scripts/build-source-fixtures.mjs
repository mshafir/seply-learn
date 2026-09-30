#!/usr/bin/env node
// Builds the binary Source fixtures from text written here, so every fixture
// is synthetic and reviewable (never anyone's real files or chats):
//   fixtures/sources/sample.pdf          3 pages, with a Title in its info
//   fixtures/sources/sample.docx         a title, headings, a list, a paragraph
//   fixtures/sources/chatgpt-export.zip  conversations.json (the JSON fixture)
//                                        plus the chat.html an export carries
// Run from packages/server: node scripts/build-source-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { strToU8, zipSync } from "fflate"

const dir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/sources")
// Fixed times keep the zips byte-for-byte reproducible.
const mtime = new Date("2026-09-01T00:00:00Z")

// ─── PDF ───────────────────────────────────────────────────────────────────

const PAGES = [
  [
    "Volcanoes: a field guide",
    "Page one. A volcano is an opening in the crust",
    "where molten rock, ash and gas escape.",
  ],
  [
    "Page two. Shield volcanoes have gentle slopes,",
    "built from runny basalt lava.",
  ],
  [
    "Page three. Stratovolcanoes are steep and explosive,",
    "built from layers of ash and thick lava.",
  ],
]

function pdf(pages, title) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const objects = []
  const add = (body) => objects.push(body) // id = index + 1
  add("<< /Type /Catalog /Pages 2 0 R >>")
  add("") // pages, filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  add(`<< /Title (${esc(title)}) /Producer (seply fixtures) >>`)
  const kids = []
  for (const lines of pages) {
    const stream = [
      "BT /F1 14 Tf 72 720 Td",
      ...lines.map((l, i) => `${i ? "0 -20 Td " : ""}(${esc(l)}) Tj`),
      "ET",
    ].join("\n")
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const content = objects.length
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`
    )
    kids.push(objects.length)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`
  let out = "%PDF-1.4\n"
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}

writeFileSync(join(dir, "sample.pdf"), pdf(PAGES, "Volcanoes: a field guide"))

// ─── DOCX ──────────────────────────────────────────────────────────────────

const xmlEsc = (s) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  )
const para = (text, style, list) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${
    list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""
  }</w:pPr><w:r><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p>`

const body = [
  para("Bees and pollination", "Title"),
  para("Most flowering plants rely on animals to move pollen & set seed."),
  para("Why bees", "Heading1"),
  para(
    "Bees visit many flowers of one kind on a trip, which makes them efficient pollinators."
  ),
  para("What they collect", "Heading2"),
  para("Nectar, for energy", null, true),
  para("Pollen, for protein", null, true),
  para("Threats", "Heading1"),
  `<w:p><w:r><w:t>Habitat loss,</w:t></w:r><w:r><w:tab/><w:t>pesticides</w:t></w:r><w:r><w:br/><w:t>and disease.</w:t></w:r></w:p>`,
].join("")

const docx = zipSync(
  {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
    ),
    "docProps/core.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bees and pollination</dc:title></cp:coreProperties>'
    ),
  },
  { mtime }
)
writeFileSync(join(dir, "sample.docx"), docx)

// ─── ChatGPT export zip ────────────────────────────────────────────────────

const zip = zipSync(
  {
    "conversations.json": readFileSync(join(dir, "chatgpt-conversations.json")),
    "chat.html": strToU8("<!doctype html><title>ChatGPT Data Export</title>"),
    "user.json": strToU8(
      '{"id":"user-synthetic","email":"reader@example.com"}'
    ),
  },
  { mtime }
)
writeFileSync(join(dir, "chatgpt-export.zip"), zip)

console.log("wrote sample.pdf, sample.docx, chatgpt-export.zip")
