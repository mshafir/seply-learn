// Import (spec §1.9): our JSON as a new private Expedition, via a first build.
//
//   POST /import  <the Expedition file as the body>
//     → 201 { expedition: ExpeditionSummary,
//             counts: { concepts, relationships, views, sources, sourceFiles } }
//
// The body is our JSON, or a zip export with Source files (export.ts):
// `expedition.json` and each Source's files under `sources/<Source id>/`. A
// zip is told apart by its first bytes, whatever the content type says.
//
// The file is validated and upgraded by `schemaVersion`, every entity id is
// re-minted (@seply/domain's `importExpeditionJson`), and the ops are logged
// as one "Imported from file" Change through the same op-log path push uses,
// in one transaction, with the importer as owner. Source files go to the blob
// store under the new Expedition's prefix first, and are removed again if
// logging fails. Without a blob store, Sources arrive as metadata only.
import {
  EXPEDITION_BUNDLE_PATHS,
  ImportError,
  importExpeditionJson,
  isLive,
  SegmentsDoc,
  ulid,
  type ImportResult,
  type LoggedOp,
} from "@seply/domain"
import { strFromU8, unzipSync, type Unzipped } from "fflate"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { AppEnv } from "./app.ts"
import { sourceBlobKeys, type BlobStore } from "./blobs.ts"
import type { Db } from "./db.ts"
import { createExpedition, type ExpeditionSummary } from "./expeditions.ts"
import { publishCommitted, type Relay } from "./relay.ts"

/** The largest file import accepts (the same cap as uploads). */
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024
/** The most a zip may hold once unpacked. */
export const IMPORT_MAX_UNZIPPED_BYTES = 4 * IMPORT_MAX_BYTES

export type ImportCounts = {
  concepts: number
  relationships: number
  views: number
  sources: number
  /** Sources whose files came with the import and were stored. */
  sourceFiles: number
}
export type ImportResponse = {
  expedition: ExpeditionSummary
  counts: ImportCounts
}

/** One Source's files from a zip export, keyed by its id in the file. */
export type ImportedSourceFile = {
  raw: Uint8Array
  segments?: SegmentsDoc
}

/** A zip starts with a local file header, `PK\x03\x04`. */
export const isZip = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04

/**
 * Reads an import body: our JSON, or a zip export with Source files. Throws
 * ImportError for what is neither.
 */
export function readImportBody(bytes: Uint8Array): {
  file: unknown
  sourceFiles: Map<string, ImportedSourceFile>
} {
  const sourceFiles = new Map<string, ImportedSourceFile>()
  if (!isZip(bytes)) {
    try {
      return { file: JSON.parse(strFromU8(bytes)), sourceFiles }
    } catch {
      throw new ImportError("not JSON, nor a zip export")
    }
  }
  let files: Unzipped
  let total = 0
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize
        if (total > IMPORT_MAX_UNZIPPED_BYTES)
          throw new ImportError("the zip is too large once unpacked")
        return !f.name.endsWith("/")
      },
    })
  } catch (e) {
    if (e instanceof ImportError) throw e
    throw new ImportError("not a readable zip")
  }
  // `expedition.json` at the top, or in the one folder a re-zip put it in.
  const { json, segments } = EXPEDITION_BUNDLE_PATHS
  const jsonPath = Object.keys(files)
    .filter((p) => p === json || p.endsWith(`/${json}`))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0]
  if (!jsonPath) throw new ImportError(`no ${json} in the zip`)
  const root = jsonPath.slice(0, -json.length)
  let file: unknown
  try {
    file = JSON.parse(strFromU8(files[jsonPath]!))
  } catch {
    throw new ImportError(`${json} is not JSON`)
  }

  const prefix = `${root}${EXPEDITION_BUNDLE_PATHS.sources}`
  const found = new Map<string, { raw?: Uint8Array; segments?: Uint8Array }>()
  for (const [path, body] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue
    const [id, name, ...rest] = path.slice(prefix.length).split("/")
    if (!id || !name || rest.length || name.startsWith(".")) continue
    const entry = found.get(id) ?? {}
    if (name === segments) entry.segments = body
    else if (entry.raw)
      continue // one file per Source; ignore the rest
    else entry.raw = body
    found.set(id, entry)
  }
  for (const [id, { raw, segments: seg }] of found) {
    if (!raw) continue
    let parsed: SegmentsDoc | undefined
    if (seg)
      try {
        const r = SegmentsDoc.safeParse(JSON.parse(strFromU8(seg)))
        if (r.success) parsed = r.data
      } catch {
        parsed = undefined
      }
    sourceFiles.set(id, { raw, ...(parsed ? { segments: parsed } : {}) })
  }
  return { file, sourceFiles }
}

/**
 * Imports a file as a new private Expedition owned by `userId`, storing the
 * Source files that came with it when there is a blob store. Throws
 * ImportError for an invalid file; nothing is written then.
 */
export async function importExpedition(
  db: Db,
  args: {
    userId: string
    file: unknown
    sourceFiles?: ReadonlyMap<string, ImportedSourceFile>
    blobs?: BlobStore | null
    now?: () => number
  }
): Promise<ImportResponse & { logged: LoggedOp[] }> {
  const now = args.now ?? Date.now
  const at = new Date(now()).toISOString()
  const mint = () => ulid(now())
  const expeditionId = mint()
  const blobs = args.blobs ?? null
  // The Source files to store, and where they go.
  const toStore: {
    oldId: string
    keys: ReturnType<typeof sourceBlobKeys>
    file: ImportedSourceFile
  }[] = []
  const result: ImportResult = importExpeditionJson(args.file, {
    expeditionId,
    actor: args.userId,
    changeId: mint(),
    nextOpId: mint,
    newId: mint,
    at,
    sourceFiles: (newId, oldId) => {
      const file = blobs ? args.sourceFiles?.get(oldId) : undefined
      if (!file) return undefined
      const keys = sourceBlobKeys(expeditionId, newId)
      toStore.push({ oldId, keys, file })
      return {
        blobKey: keys.raw,
        ...(file.segments ? { segmentsKey: keys.segments } : {}),
      }
    },
  })
  const { change, ops, state } = result
  const mimes = new Map(result.doc.sources.map((s) => [s.id, s.mime]))

  const stored: string[] = []
  const unstore = () =>
    Promise.allSettled(stored.map((key) => blobs!.delete(key)))
  try {
    for (const { oldId, keys, file } of toStore) {
      await blobs!.put(keys.raw, file.raw, {
        contentType: mimes.get(oldId) ?? "application/octet-stream",
      })
      stored.push(keys.raw)
      if (file.segments) {
        await blobs!.put(keys.segments, JSON.stringify(file.segments), {
          contentType: "application/json",
        })
        stored.push(keys.segments)
      }
    }
  } catch (err) {
    await unstore()
    throw err
  }

  let created: Awaited<ReturnType<typeof createExpedition>>
  try {
    created = await db.transaction((tx) =>
      createExpedition(tx, {
        id: change.expeditionId,
        userId: args.userId,
        ops,
        change: { id: change.id, label: change.label, origin: change.origin },
      })
    )
  } catch (err) {
    await unstore()
    throw err
  }
  const live = (r: Record<string, { deletedAt: string | null }>) =>
    Object.values(r).filter(isLive).length
  return {
    expedition: created.summary,
    counts: {
      concepts: live(state.concepts),
      relationships: live(state.relationships),
      views: live(state.views),
      sources: Object.keys(state.sources).length,
      sourceFiles: toStore.length,
    },
    logged: created.logged,
  }
}

/** At most this many validation issues are returned. */
const MAX_ISSUES = 50

export function importRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()
  r.post(
    "/",
    bodyLimit({
      maxSize: IMPORT_MAX_BYTES,
      onError: (c) => c.json({ error: "file too large" }, 413),
    }),
    async (c) => {
      try {
        const bytes = new Uint8Array(await c.req.arrayBuffer())
        const { file, sourceFiles } = readImportBody(bytes)
        // Without a blob store, Sources arrive as metadata only.
        let blobs: BlobStore | null = null
        if (sourceFiles.size)
          try {
            blobs = c.var.blobs()
          } catch {
            blobs = null
          }
        const { logged, ...out } = await importExpedition(await c.var.db(), {
          userId: c.var.user.id,
          file,
          sourceFiles,
          blobs,
        })
        await publishCommitted(relay, out.expedition.id, logged)
        return c.json(out satisfies ImportResponse, 201)
      } catch (err) {
        if (err instanceof ImportError)
          return c.json(
            {
              error: "invalid file",
              message: err.message,
              issues: err.issues.slice(0, MAX_ISSUES),
            },
            400
          )
        throw err
      }
    }
  )
  return r
}
