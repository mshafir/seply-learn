// Source routes (spec §3.3, §5.2 step 1).
//
//   POST /sources/:expeditionId            (signed in; owners and editors)
//     multipart/form-data: file (and optionally title) — an upload, 25 MB cap
//     application/json:    { type: "paste" | "prompt", text, title? }
//     → 201 { source, segments: { kind, format, count, chars } }
//   GET  /sources/:expeditionId/:sourceId  (anyone who can view)
//     → { source, segments: SegmentsDoc }
//   GET  /sources/:expeditionId/:sourceId/file  (anyone who can view)
//     → the raw file, as a download
//   DELETE /sources/:expeditionId/:sourceId (signed in; owners and editors)
//     → 204; logs `source.remove`
//
// Viewing needs no sign-in where Visibility allows, like /pull: anyone who
// can view an Expedition can see its Sources (spec §1.8).
import { MAX_SOURCE_BYTES, type Visibility } from "@seply/domain"
import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"

import { requireUser, type AppEnv } from "../app.ts"
import type { BlobStore } from "../blobs.ts"
import type { Db } from "../db.ts"
import { expeditionAccess, sessionUserId } from "../access.ts"
import { PushError } from "../oplog.ts"
import { publishCommitted, type Relay } from "../relay.ts"
import {
  parseFile,
  parsePaste,
  parsePrompt,
  SourceError,
  type ParsedSource,
} from "./parse.ts"
import {
  addSource,
  expeditionVisibility,
  ownKey,
  readSegments,
  removeSource,
  sourceRow,
} from "./store.ts"

export const PasteBody = z.object({
  type: z.enum(["paste", "prompt"]),
  text: z.string().min(1),
  title: z.string().max(200).optional(),
})

/** Multipart framing on top of the 25 MB file. */
const FORM_OVERHEAD = 64 * 1024

const DOWNLOAD_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/json": "json",
  "application/zip": "zip",
  "text/markdown": "md",
  "text/html": "html",
  "text/plain": "txt",
}

/** Can the caller (signed in or not) view this Expedition? */
async function canView(
  c: Context<AppEnv>,
  db: Db,
  expeditionId: string
): Promise<boolean> {
  const visibility: Visibility | null = await expeditionVisibility(
    db,
    expeditionId
  )
  if (!visibility) return false
  const userId = visibility === "private" ? await sessionUserId(c) : null
  return !!(await expeditionAccess(db, expeditionId, userId))
}

export function sourceRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()
  const blobs = (c: Context<AppEnv>): BlobStore => c.var.blobs()

  r.post(
    "/:expeditionId",
    requireUser(),
    bodyLimit({
      maxSize: MAX_SOURCE_BYTES + FORM_OVERHEAD,
      onError: (c) => c.json({ error: "file too large" }, 413),
    }),
    async (c) => {
      const expeditionId = c.req.param("expeditionId")
      const store = blobs(c)
      let parsed: ParsedSource
      let raw: Uint8Array | string
      try {
        const type = c.req.header("content-type") ?? ""
        if (type.startsWith("multipart/form-data")) {
          const form = await c.req.parseBody()
          const file = form.file
          if (!(file instanceof File))
            return c.json({ error: "no file in the form" }, 400)
          if (file.size > MAX_SOURCE_BYTES)
            return c.json({ error: "file too large" }, 413)
          raw = new Uint8Array(await file.arrayBuffer())
          parsed = await parseFile({
            bytes: raw,
            filename: file.name,
            type: file.type,
          })
          const title = typeof form.title === "string" ? form.title.trim() : ""
          if (title) parsed = { ...parsed, title }
        } else {
          const body = PasteBody.safeParse(await c.req.json().catch(() => null))
          if (!body.success)
            return c.json(
              { error: "invalid body", issues: body.error.issues },
              400
            )
          const { type: kind, text, title } = body.data
          parsed =
            kind === "prompt"
              ? parsePrompt(text, title)
              : parsePaste(text, title)
          raw = kind === "prompt" ? text.trim() : text
        }
      } catch (err) {
        if (err instanceof SourceError)
          return c.json(
            { error: "unreadable", message: err.message },
            err.status
          )
        throw err
      }
      try {
        const { logged, ...out } = await addSource(await c.var.db(), store, {
          expeditionId,
          userId: c.var.user.id,
          parsed,
          raw,
        })
        await publishCommitted(relay, expeditionId, logged)
        return c.json(out, 201)
      } catch (err) {
        if (err instanceof PushError) return c.json(err.body, err.status)
        throw err
      }
    }
  )

  r.get("/:expeditionId/:sourceId", async (c) => {
    const { expeditionId, sourceId } = c.req.param()
    const db = await c.var.db()
    if (!(await canView(c, db, expeditionId)))
      return c.json({ error: "Expedition not found" }, 404)
    const read = await readSegments(db, blobs(c), expeditionId, sourceId)
    if (!read) {
      const exists = await sourceRow(db, expeditionId, sourceId)
      return exists
        ? c.json({ error: "no text stored for this Source" }, 404)
        : c.json({ error: "Source not found" }, 404)
    }
    const { blobKey: _b, segmentsKey: _s, ...source } = read.source
    void _b
    void _s
    return c.json({ source, segments: read.segments })
  })

  // Remove a Source (the create flow's Sources list; owners and editors): logs
  // `source.remove` as one Change. The blobs stay, so undoing the Change
  // brings the Source back whole.
  r.delete("/:expeditionId/:sourceId", requireUser(), async (c) => {
    const { expeditionId, sourceId } = c.req.param()
    const db = await c.var.db()
    try {
      const logged = await removeSource(db, {
        expeditionId,
        sourceId,
        userId: c.var.user.id,
      })
      await publishCommitted(relay, expeditionId, logged)
      return c.body(null, 204)
    } catch (err) {
      if (err instanceof PushError) return c.json(err.body, err.status)
      throw err
    }
  })

  r.get("/:expeditionId/:sourceId/file", async (c) => {
    const { expeditionId, sourceId } = c.req.param()
    const db = await c.var.db()
    if (!(await canView(c, db, expeditionId)))
      return c.json({ error: "Expedition not found" }, 404)
    const source = await sourceRow(db, expeditionId, sourceId)
    const key = ownKey(expeditionId, source?.blobKey)
    const blob = key ? await blobs(c).get(key) : null
    if (!source || !blob)
      return c.json({ error: "no file for this Source" }, 404)
    const type = blob.contentType ?? "application/octet-stream"
    const ext = DOWNLOAD_EXT[type.split(";")[0]!.trim()] ?? "bin"
    const name = `${source.title.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim() || "source"}.${ext}`
    return new Response(blob.body, {
      headers: {
        "content-type": type,
        "content-length": String(blob.body.byteLength),
        // Always a download, never rendered on our origin.
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
        "cache-control": "private, no-store",
      },
    })
  })

  return r
}
