// Storing and reading Sources: the raw file and the segments go to the blob
// store under the Expedition's prefix, and the Source itself is logged as a
// `source.add` op (its own Change) through the op log.
import {
  makeOps,
  SegmentsDoc,
  schema,
  ulid,
  type LoggedOp,
  type Source,
  type Visibility,
} from "@seply/domain"
import { and, eq } from "drizzle-orm"

import { sourceBlobKeys, sourcePrefix, type BlobStore } from "../blobs.ts"
import type { Db } from "../db.ts"
import { expeditionAccess } from "../access.ts"
import { appendOps, PushError } from "../oplog.ts"
import type { ParsedSource } from "./parse.ts"

export type AddedSource = {
  source: Source
  segments: {
    kind: SegmentsDoc["kind"]
    format: SegmentsDoc["format"]
    count: number
    chars: number
  }
}

/** The Expedition's Visibility, or null when it doesn't exist (or is in Trash). */
export async function expeditionVisibility(
  db: Db,
  expeditionId: string
): Promise<Visibility | null> {
  const [exp] = await db
    .select({
      visibility: schema.expeditions.visibility,
      deletedAt: schema.expeditions.deletedAt,
    })
    .from(schema.expeditions)
    .where(eq(schema.expeditions.id, expeditionId))
  return exp && !exp.deletedAt ? exp.visibility : null
}

/**
 * Adds a read Source to an Expedition as `userId`: checks they may add
 * Sources (owners and editors), stores the raw file and its segments, then
 * logs `source.add` as one Change ("Added the Source “…”"). Throws PushError
 * (404, 403) before storing anything; removes the blobs again if logging fails.
 */
export async function addSource(
  db: Db,
  blobs: BlobStore,
  args: {
    expeditionId: string
    userId: string
    parsed: ParsedSource
    raw: Uint8Array | string
    now?: () => number
  }
): Promise<AddedSource & { logged: LoggedOp[] }> {
  const { expeditionId, userId, parsed } = args
  const now = args.now ?? Date.now

  const access = await expeditionAccess(db, expeditionId, userId)
  if (!access) throw new PushError(404, { error: "Expedition not found" })
  if (!access.may("manageSources"))
    throw new PushError(403, {
      error: "not allowed",
      message: `${access.role ?? "a reader"} may not add Sources`,
    })

  const id = ulid(now())
  const keys = sourceBlobKeys(expeditionId, id)
  const raw =
    typeof args.raw === "string" ? new TextEncoder().encode(args.raw) : args.raw
  const source: Source = {
    id,
    kind: parsed.kind,
    title: parsed.title,
    blobKey: keys.raw,
    segmentsKey: keys.segments,
    mime: parsed.mime,
    size: raw.byteLength,
    addedBy: userId,
    addedAt: new Date(now()).toISOString(),
  }

  await blobs.put(keys.raw, raw, { contentType: parsed.mime })
  await blobs.put(keys.segments, JSON.stringify(parsed.segments), {
    contentType: "application/json",
  })

  const changeId = ulid(now())
  const { id: _id, ...value } = source
  void _id
  const ops = makeOps([{ kind: "source.add", target: id, value }], {
    expeditionId,
    actor: userId,
    changeId,
    nextOpId: () => ulid(now()),
  })
  try {
    const { logged } = await db.transaction((tx) =>
      appendOps(tx, {
        expeditionId,
        userId,
        ops,
        changes: [
          { id: changeId, label: `Added the Source “${parsed.title}”` },
        ],
      })
    )
    const { kind, format, chars, segments } = parsed.segments
    return {
      source,
      segments: { kind, format, count: segments.length, chars },
      logged,
    }
  } catch (err) {
    await Promise.allSettled([
      blobs.delete(keys.raw),
      blobs.delete(keys.segments),
    ])
    throw err
  }
}

/**
 * Removes a Source as `userId` (owners and editors): logs `source.remove` as
 * one Change ("Removed the Source “…”"). The blobs stay, so undoing the Change
 * restores it. Throws PushError: 404 (no such Expedition or Source), 403.
 */
export async function removeSource(
  db: Db,
  args: { expeditionId: string; sourceId: string; userId: string }
): Promise<LoggedOp[]> {
  const { expeditionId, sourceId, userId } = args
  const access = await expeditionAccess(db, expeditionId, userId)
  if (!access) throw new PushError(404, { error: "Expedition not found" })
  if (!access.may("manageSources"))
    throw new PushError(403, {
      error: "not allowed",
      message: `${access.role ?? "a reader"} may not remove Sources`,
    })
  const source = await sourceRow(db, expeditionId, sourceId)
  if (!source) throw new PushError(404, { error: "Source not found" })
  const changeId = ulid(Date.now())
  const ops = makeOps([{ kind: "source.remove", target: sourceId }], {
    expeditionId,
    actor: userId,
    changeId,
    nextOpId: () => ulid(Date.now()),
  })
  const { logged } = await db.transaction((tx) =>
    appendOps(tx, {
      expeditionId,
      userId,
      ops,
      changes: [{ id: changeId, label: `Removed the Source “${source.title}”` }],
    })
  )
  return logged
}

/** A Source's row, or null. */
export async function sourceRow(
  db: Db,
  expeditionId: string,
  sourceId: string
): Promise<Source | null> {
  const [row] = await db
    .select()
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.expeditionId, expeditionId),
        eq(schema.sources.id, sourceId)
      )
    )
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    ...(row.blobKey ? { blobKey: row.blobKey } : {}),
    ...(row.segmentsKey ? { segmentsKey: row.segmentsKey } : {}),
    ...(row.mime ? { mime: row.mime } : {}),
    ...(row.size !== null ? { size: row.size } : {}),
    addedBy: row.addedBy,
    addedAt: row.addedAt,
  }
}

/**
 * A blob key a Source row names, if it is this Expedition's own. Rows come
 * from the op log, which clients write, so a key outside the Expedition's
 * prefix is never read (it could name another Expedition's Source).
 */
export function ownKey(
  expeditionId: string,
  key: string | undefined
): string | null {
  return key && key.startsWith(sourcePrefix(expeditionId)) ? key : null
}

/**
 * The segments of a Source (the `SourceReader` port's read): null when the
 * Source doesn't exist or has no segments stored (e.g. it was imported from
 * JSON, which carries no files). No access check: callers check first.
 */
export async function readSegments(
  db: Db,
  blobs: BlobStore,
  expeditionId: string,
  sourceId: string
): Promise<{ source: Source; segments: SegmentsDoc } | null> {
  const source = await sourceRow(db, expeditionId, sourceId)
  const key = ownKey(expeditionId, source?.segmentsKey)
  if (!source || !key) return null
  const blob = await blobs.get(key)
  if (!blob) return null
  const parsed = SegmentsDoc.safeParse(
    JSON.parse(new TextDecoder().decode(blob.body))
  )
  if (!parsed.success) return null
  return { source, segments: parsed.data }
}
