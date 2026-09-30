// Import (spec §1.9): our JSON as a new private Expedition, via a first build.
//
//   POST /import  <the Expedition file as the JSON body>
//     → 201 { expedition: ExpeditionSummary, counts: { concepts, relationships, views } }
//
// The file is validated and upgraded by `schemaVersion`, every entity id is
// re-minted (@seply/domain's `importExpeditionJson`), and the ops are logged
// as one "Imported from file" Change through the same op-log path push uses,
// in one transaction, with the importer as owner.
import {
  ImportError,
  importExpeditionJson,
  isLive,
  ulid,
  type ImportResult,
  type LoggedOp,
} from "@seply/domain"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { createExpedition, type ExpeditionSummary } from "./expeditions.ts"
import { publishCommitted, type Relay } from "./relay.ts"

/** The largest file import accepts (the same cap as uploads). */
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024

export type ImportCounts = {
  concepts: number
  relationships: number
  views: number
}
export type ImportResponse = {
  expedition: ExpeditionSummary
  counts: ImportCounts
}

/**
 * Imports a file as a new private Expedition owned by `userId`. Throws
 * ImportError for an invalid file; nothing is written then.
 */
export async function importExpedition(
  db: Db,
  args: { userId: string; file: unknown; now?: () => number }
): Promise<ImportResponse & { logged: LoggedOp[] }> {
  const now = args.now ?? Date.now
  const at = new Date(now()).toISOString()
  const mint = () => ulid(now())
  const result: ImportResult = importExpeditionJson(args.file, {
    expeditionId: mint(),
    actor: args.userId,
    changeId: mint(),
    nextOpId: mint,
    newId: mint,
    at,
  })
  const { change, ops, state } = result
  const { summary, logged } = await db.transaction((tx) =>
    createExpedition(tx, {
      id: change.expeditionId,
      userId: args.userId,
      ops,
      change: { id: change.id, label: change.label, origin: change.origin },
    })
  )
  const live = (r: Record<string, { deletedAt: string | null }>) =>
    Object.values(r).filter(isLive).length
  return {
    expedition: summary,
    counts: {
      concepts: live(state.concepts),
      relationships: live(state.relationships),
      views: live(state.views),
    },
    logged,
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
      const file = await c.req.json().catch(() => undefined)
      if (file === undefined) return c.json({ error: "not JSON" }, 400)
      try {
        const { logged, ...out } = await importExpedition(await c.var.db(), {
          userId: c.var.user.id,
          file,
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
