// Export (spec §1.9): an Expedition's current state, for anyone who can view.
//
//   GET /export/:expeditionId?format=json[&sources=1]
//     → our JSON (`<title>.json`); with `sources=1` and Source files stored,
//       a zip of `expedition.json` and each Source's files under
//       `sources/<Source id>/` (the original file and `segments.json`)
//   GET /export/:expeditionId?format=markdown
//     → a zip of an Obsidian-readable folder (`<title> (Markdown).zip`)
//
// Like the Source routes, viewing needs no sign-in where Visibility allows:
// what a reader can see, they can export (`canView`). No history, Proposals,
// per-reader state or collaborators travel.
import {
  EXPEDITION_BUNDLE_PATHS,
  expeditionToMarkdown,
  noteName,
  stateToExpeditionJson,
} from "@seply/domain"
import { strToU8, zipSync, type Zippable } from "fflate"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"
import type { BlobStore } from "./blobs.ts"
import type { Db } from "./db.ts"
import { loadState } from "./projection.ts"
import { canView, DOWNLOAD_EXT } from "./sources/routes.ts"
import { ownKey } from "./sources/store.ts"

export const ExportQuery = z.object({
  format: z.enum(["json", "markdown"]).default("json"),
  sources: z
    .enum(["0", "1"])
    .default("0")
    .transform((v) => v === "1"),
})
export type ExportFormat = z.output<typeof ExportQuery>["format"]

export type ExportFile = {
  filename: string
  contentType: string
  body: Uint8Array<ArrayBuffer>
  /** How many Sources' files the export carries (JSON with Sources only). */
  sourceFiles: number
}

const zip = (files: Zippable) => zipSync(files, { level: 6 })

/**
 * An Expedition's export. Null when there is no such Expedition. No access
 * check: callers check first. `blobs` is only read for Source files.
 */
export async function exportExpedition(
  db: Db,
  blobs: BlobStore | null,
  args: {
    expeditionId: string
    format: ExportFormat
    /** Include the Sources' stored files (JSON only). */
    sources?: boolean
    now?: () => number
  }
): Promise<ExportFile | null> {
  const state = await loadState(db, args.expeditionId)
  if (!state) return null
  const now = args.now ?? Date.now
  const doc = stateToExpeditionJson(state, {
    exportedAt: new Date(now()).toISOString(),
  })
  const name = noteName(doc.title.trim() || "Untitled Expedition")

  if (args.format === "markdown") {
    const { folder, notes } = expeditionToMarkdown(doc)
    const files: Zippable = {}
    for (const n of notes) files[`${folder}/${n.path}`] = strToU8(n.text)
    return {
      filename: `${name} (Markdown).zip`,
      contentType: "application/zip",
      body: zip(files),
      sourceFiles: 0,
    }
  }

  const json = strToU8(JSON.stringify(doc, null, 2))
  const files: Zippable = {}
  let sourceFiles = 0
  if (args.sources && blobs)
    for (const s of Object.values(state.sources)) {
      const rawKey = ownKey(args.expeditionId, s.blobKey)
      const raw = rawKey ? await blobs.get(rawKey) : null
      if (!raw) continue
      const dir = `${EXPEDITION_BUNDLE_PATHS.sources}${s.id}/`
      const type = (raw.contentType ?? s.mime ?? "").split(";")[0]!.trim()
      const ext = DOWNLOAD_EXT[type] ?? "bin"
      // The original file, named for reading; import takes any name here.
      let file = noteName(s.title)
      if (file.toLowerCase() === EXPEDITION_BUNDLE_PATHS.segments) file = "file"
      if (!file.toLowerCase().endsWith(`.${ext}`)) file = `${file}.${ext}`
      files[`${dir}${file}`] = raw.body
      const segKey = ownKey(args.expeditionId, s.segmentsKey)
      const segments = segKey ? await blobs.get(segKey) : null
      if (segments)
        files[`${dir}${EXPEDITION_BUNDLE_PATHS.segments}`] = segments.body
      sourceFiles++
    }
  if (!sourceFiles)
    return {
      filename: `${name}.json`,
      contentType: "application/json",
      body: json,
      sourceFiles,
    }
  files[EXPEDITION_BUNDLE_PATHS.json] = json
  return {
    filename: `${name}.zip`,
    contentType: "application/zip",
    body: zip(files),
    sourceFiles,
  }
}

/** `attachment`, with an ASCII fallback name and the real one in UTF-8. */
export function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export function exportRoutes() {
  const r = new Hono<AppEnv>()
  r.get("/:expeditionId", async (c) => {
    const query = ExportQuery.safeParse(c.req.query())
    if (!query.success)
      return c.json({ error: "invalid query", issues: query.error.issues }, 400)
    const expeditionId = c.req.param("expeditionId")
    const db = await c.var.db()
    if (!(await canView(c, db, expeditionId)))
      return c.json({ error: "Expedition not found" }, 404)
    const { format, sources } = query.data
    // Without a blob store there are no Source files to add.
    let blobs: BlobStore | null = null
    if (format === "json" && sources)
      try {
        blobs = c.var.blobs()
      } catch {
        blobs = null
      }
    const file = await exportExpedition(db, blobs, {
      expeditionId,
      format,
      sources,
    })
    if (!file) return c.json({ error: "Expedition not found" }, 404)
    return new Response(file.body, {
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.body.byteLength),
        "content-disposition": attachment(file.filename),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "x-source-files": String(file.sourceFiles),
      },
    })
  })
  return r
}
