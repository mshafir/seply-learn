// Fork (spec §1.4, §1.8, §3.9; WP-5.2): a new private Expedition owned by
// the forker, holding the original's current state or its state as of a
// Change, with `forked_from` recorded. Its log starts fresh with one
// "Forked from …" Change, and its Sources come with it (the files are copied
// under the new Expedition's prefix).
//
//   POST /expeditions/:id/fork { asOf?: changeId }
//     → 201 { expedition: ExpeditionSummary, forkedFrom: { exp, seq } }
//
// Anyone signed in who can view may fork the current state. Forking as of a
// Change needs History (owners and editors): viewers and readers of a link
// see the latest state only (§1.4).
//
// The state is replayed from the log, written out as our JSON and built
// again with fresh ids, the same path import takes, so a Fork shares no
// entity id with its original.
import {
  emptyState,
  expeditionJsonToOpBodies,
  makeOps,
  schema,
  stateAt,
  stateToExpeditionJson,
  ulid,
  type LoggedOp,
} from "@seply/domain"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { authorize, AccessDenied } from "./access.ts"
import type { AppEnv } from "./app.ts"
import { sourceBlobKeys, type BlobStore, type StoredBlob } from "./blobs.ts"
import type { Db } from "./db.ts"
import { createExpedition, type ExpeditionSummary } from "./expeditions.ts"
import { readOps } from "./oplog.ts"
import { publishCommitted, type Relay } from "./relay.ts"

const { changes, expeditions } = schema

export const ForkBody = z.object({ asOf: z.string().min(1).max(64).optional() })

export type ForkResult = {
  expedition: ExpeditionSummary
  /** Where it came from: the original and the last op it holds. */
  forkedFrom: { exp: string; seq: number }
}

/** A refused fork that isn't about access: 400 (no such Change). */
export class ForkError extends Error {
  constructor(
    readonly status: 400,
    message: string
  ) {
    super(message)
  }
}

/** The Change label a Fork starts with. */
export const forkLabel = (title: string) =>
  `Forked from “${title || "Untitled Expedition"}”`

/** Every logged op up to and including `seq`, oldest first. */
async function opsUpTo(
  db: Db,
  expeditionId: string,
  seq: number
): Promise<LoggedOp[]> {
  const out: LoggedOp[] = []
  let since = 0
  while (since < seq) {
    const page = await readOps(db, expeditionId, since)
    if (!page.length) break
    for (const op of page) if (op.serverSeq <= seq) out.push(op)
    since = page.at(-1)!.serverSeq
  }
  return out
}

/**
 * Forks `expeditionId` for `userId`: authorizes (404 can't read, 403 may not
 * fork, or may not see History for `asOf`), replays the state, copies the
 * Source files, and creates the new Expedition in one transaction. Throws
 * AccessDenied or ForkError.
 */
export async function forkExpedition(
  db: Db,
  blobs: BlobStore | null,
  args: {
    expeditionId: string
    userId: string
    asOf?: string
    now?: () => number
  }
): Promise<ForkResult & { logged: LoggedOp[] }> {
  const now = args.now ?? Date.now
  const a = await authorize(db, args.expeditionId, args.userId, "fork", {
    refusal: "sign in to fork",
  })
  let seq = a.headSeq
  if (args.asOf) {
    if (!a.may("viewHistory"))
      throw new AccessDenied(
        403,
        "only owners and editors fork from a point in History"
      )
    const [change] = await db
      .select({ lastSeq: changes.lastSeq })
      .from(changes)
      .where(
        and(
          eq(changes.expeditionId, args.expeditionId),
          eq(changes.id, args.asOf)
        )
      )
    if (!change) throw new ForkError(400, "no such Change")
    seq = change.lastSeq
  }

  const state = stateAt(
    emptyState(args.expeditionId),
    await opsUpTo(db, args.expeditionId, seq),
    seq
  )
  const at = new Date(now()).toISOString()
  const mint = () => ulid(now())
  const id = mint()
  const doc = stateToExpeditionJson(state, { exportedAt: at })

  // The Sources' files come with the Fork, under its own prefix: read the
  // ones that exist first (a Source imported without its file has none).
  const files = new Map<string, { raw?: StoredBlob; segments?: StoredBlob }>()
  if (blobs)
    for (const src of Object.values(state.sources)) {
      const raw = src.blobKey ? await blobs.get(src.blobKey) : null
      const segments = src.segmentsKey ? await blobs.get(src.segmentsKey) : null
      if (raw || segments)
        files.set(src.id, {
          ...(raw && { raw }),
          ...(segments && { segments }),
        })
    }
  const copies: { key: string; blob: StoredBlob; type: string }[] = []
  const { bodies } = expeditionJsonToOpBodies(doc, {
    expeditionId: id,
    actor: args.userId,
    newId: mint,
    at,
    sourceFiles: (newId, oldId) => {
      const f = files.get(oldId)
      if (!f) return undefined
      const keys = sourceBlobKeys(id, newId)
      if (f.raw)
        copies.push({
          key: keys.raw,
          blob: f.raw,
          type: f.raw.contentType ?? "application/octet-stream",
        })
      if (f.segments)
        copies.push({
          key: keys.segments,
          blob: f.segments,
          type: f.segments.contentType ?? "application/json",
        })
      return {
        ...(f.raw && { blobKey: keys.raw }),
        ...(f.segments && { segmentsKey: keys.segments }),
      }
    },
  })

  const copied: string[] = []
  try {
    for (const c of copies) {
      await blobs!.put(c.key, c.blob.body, { contentType: c.type })
      copied.push(c.key)
    }

    const changeId = mint()
    const ops = makeOps(bodies, {
      expeditionId: id,
      actor: args.userId,
      changeId,
      nextOpId: mint,
    })
    const forkedFrom = { exp: args.expeditionId, seq }
    const { summary, logged } = await db.transaction(async (tx) => {
      const out = await createExpedition(tx, {
        id,
        userId: args.userId,
        ops,
        change: {
          id: changeId,
          label: forkLabel(state.expedition.title),
          origin: "import",
        },
      })
      await tx
        .update(expeditions)
        .set({ forkedFrom })
        .where(eq(expeditions.id, id))
      return out
    })
    return { expedition: summary, forkedFrom, logged }
  } catch (err) {
    // Nothing points at the copies: remove them.
    for (const key of copied) await blobs?.delete(key).catch(() => {})
    throw err
  }
}

/** The fork route, under /expeditions (signed in). */
export function forkRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()
  r.post("/:id/fork", async (c) => {
    const body = ForkBody.safeParse(await c.req.json().catch(() => ({})))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    let blobs: BlobStore | null
    try {
      blobs = c.var.blobs()
    } catch {
      // No file storage: a Fork of an Expedition without Source files still works.
      blobs = null
    }
    try {
      const { logged, ...out } = await forkExpedition(await c.var.db(), blobs, {
        expeditionId: c.req.param("id"),
        userId: c.var.user.id,
        asOf: body.data.asOf,
      })
      await publishCommitted(relay, out.expedition.id, logged)
      return c.json(out satisfies ForkResult, 201)
    } catch (err) {
      if (err instanceof ForkError)
        return c.json({ error: err.message }, err.status)
      throw err
    }
  })
  return r
}
