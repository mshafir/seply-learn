// The op log (spec §1.3, §2.3): the one write path for shared content.
// `appendOps` runs inside the caller's transaction: it locks the Expedition,
// checks the role, skips ops already logged (idempotent by op id), folds the
// new ones into the current state with @umbel/domain's `apply`, assigns
// `server_seq`, appends them to `ops`, records their Changes and writes the
// changed rows. Any failure throws, so the caller's transaction rolls back
// and leaves nothing behind.
import {
  apply,
  ApplyError,
  actionForOp,
  can,
  schema,
  type ChangeOrigin,
  type LoggedOp,
  type Op,
  type Role,
} from "@umbel/domain"
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import type { Db } from "./db.ts"
import { loadState, writeState } from "./projection.ts"

const { expeditions, collaborators, ops: opsTable, changes } = schema

/** Changes a client may start through /push. Builds, AI and imports are server-side. */
export const CLIENT_ORIGINS = ["human", "restore", "merge"] as const
export type ClientOrigin = (typeof CLIENT_ORIGINS)[number]

export type ChangeInfo = { id: string; label?: string; origin?: ChangeOrigin }

export const DEFAULT_CHANGE_LABEL = "Edited"

/** A refused push: the HTTP status and JSON body to answer with. */
export class PushError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly body: { error: string; opId?: string; message?: string }
  ) {
    super(body.message ?? body.error)
    this.name = "PushError"
  }
}

export type OpResult = { opId: string; serverSeq: number }

export type AppendResult = {
  /** One per op of the batch, in batch order, including ops logged before. */
  results: OpResult[]
  /** The ops this call logged (empty for a pure retry), in `serverSeq` order. */
  logged: LoggedOp[]
  headSeq: number
}

/** The caller's role on an Expedition, or null. */
export async function roleOf(
  db: Db,
  expeditionId: string,
  userId: string | null
) {
  if (!userId) return null
  const [row] = await db
    .select({ role: collaborators.role })
    .from(collaborators)
    .where(
      and(
        eq(collaborators.expeditionId, expeditionId),
        eq(collaborators.userId, userId)
      )
    )
  return (row?.role ?? null) as Role | null
}

/**
 * Appends a batch of validated ops (one Expedition, acting as `userId`) to the
 * log and applies them. Must run inside a transaction.
 */
export async function appendOps(
  tx: Db,
  args: {
    expeditionId: string
    userId: string
    ops: readonly Op[]
    changes?: readonly ChangeInfo[]
    now?: () => Date
  }
): Promise<AppendResult> {
  const { expeditionId, userId, ops } = args
  const now = args.now ?? (() => new Date())

  // Lock the Expedition: pushes to one Expedition are serialized, so
  // server_seq is gap-free and the idempotency check below can't race.
  const [exp] = await tx
    .select({
      visibility: expeditions.visibility,
      deletedAt: expeditions.deletedAt,
      headSeq: expeditions.headSeq,
    })
    .from(expeditions)
    .where(eq(expeditions.id, expeditionId))
    .for("update")
  if (!exp || exp.deletedAt)
    throw new PushError(404, { error: "Expedition not found" })

  const role = await roleOf(tx, expeditionId, userId)
  const actor = { role, signedIn: true }
  if (!can(actor, "read", exp.visibility))
    throw new PushError(404, { error: "Expedition not found" })
  for (const op of ops) {
    if (!can(actor, actionForOp(op.kind), exp.visibility))
      throw new PushError(403, {
        error: "not allowed",
        opId: op.opId,
        message: `${role ?? "a reader"} may not ${op.kind}`,
      })
  }

  // Idempotent by op id: ops already logged keep their server_seq.
  const known = new Map<string, number>()
  if (ops.length) {
    const rows = await tx
      .select({ opId: opsTable.opId, serverSeq: opsTable.serverSeq })
      .from(opsTable)
      .where(
        and(
          eq(opsTable.expeditionId, expeditionId),
          inArray(
            opsTable.opId,
            ops.map((o) => o.opId)
          )
        )
      )
    for (const r of rows) known.set(r.opId, r.serverSeq)
  }
  const fresh = ops.filter((o) => !known.has(o.opId))
  if (!fresh.length)
    return {
      results: ops.map((o) => ({
        opId: o.opId,
        serverSeq: known.get(o.opId)!,
      })),
      logged: [],
      headSeq: exp.headSeq,
    }

  // Apply in batch order on top of the current state.
  const before = await loadState(tx, expeditionId)
  if (!before) throw new PushError(404, { error: "Expedition not found" })
  let after = before
  for (const op of fresh) {
    try {
      after = apply(after, op)
    } catch (e) {
      if (!(e instanceof ApplyError)) throw e
      throw new PushError(409, {
        error: "op does not apply",
        opId: op.opId,
        message: e.message,
      })
    }
  }

  let seq = exp.headSeq
  const logged: LoggedOp[] = fresh.map((op) => ({ ...op, serverSeq: ++seq }))
  for (let i = 0; i < logged.length; i += 500) {
    await tx.insert(opsTable).values(
      logged.slice(i, i + 500).map((op) => ({
        expeditionId,
        serverSeq: op.serverSeq,
        opId: op.opId,
        changeId: op.changeId,
        clientSeq: op.clientSeq,
        schemaV: op.schemaV,
        kind: op.kind,
        target: op.target,
        path: "path" in op ? op.path : null,
        value: "value" in op ? (op.value ?? null) : null,
      }))
    )
  }

  await recordChanges(tx, expeditionId, userId, logged, args.changes ?? [], now)
  await writeState(tx, before, after)
  await tx
    .update(expeditions)
    .set({ headSeq: seq })
    .where(eq(expeditions.id, expeditionId))

  const seqOf = new Map(logged.map((o) => [o.opId, o.serverSeq]))
  return {
    results: ops.map((o) => ({
      opId: o.opId,
      serverSeq: known.get(o.opId) ?? seqOf.get(o.opId)!,
    })),
    logged,
    headSeq: seq,
  }
}

/**
 * Creates or extends the Changes the ops belong to. A Change has one author:
 * an editing session may continue it in a later push, but only its author.
 */
async function recordChanges(
  tx: Db,
  expeditionId: string,
  userId: string,
  logged: readonly LoggedOp[],
  infos: readonly ChangeInfo[],
  now: () => Date
) {
  const info = new Map(infos.map((c) => [c.id, c]))
  const spans = new Map<string, { first: number; last: number }>()
  for (const op of logged) {
    const s = spans.get(op.changeId)
    if (s) s.last = op.serverSeq
    else spans.set(op.changeId, { first: op.serverSeq, last: op.serverSeq })
  }
  const ids = [...spans.keys()]
  const existing = new Map(
    (
      await tx
        .select({ id: changes.id, author: changes.author })
        .from(changes)
        .where(
          and(eq(changes.expeditionId, expeditionId), inArray(changes.id, ids))
        )
    ).map((r) => [r.id, r])
  )
  for (const [id, span] of spans) {
    const meta = info.get(id)
    const prev = existing.get(id)
    if (prev) {
      if (prev.author !== userId)
        throw new PushError(409, {
          error: "Change belongs to another author",
          message: `Change ${id} belongs to another author`,
        })
      await tx
        .update(changes)
        .set({
          lastSeq: span.last,
          ...(meta?.label ? { label: meta.label } : {}),
        })
        .where(and(eq(changes.expeditionId, expeditionId), eq(changes.id, id)))
    } else {
      await tx.insert(changes).values({
        expeditionId,
        id,
        author: userId,
        origin: meta?.origin ?? "human",
        label: meta?.label ?? DEFAULT_CHANGE_LABEL,
        firstSeq: span.first,
        lastSeq: span.last,
        at: now().toISOString(),
      })
    }
  }
}

export const PULL_LIMIT = 1000

/** Logged ops after `since`, oldest first, at most `limit`; the actor is the Change's author. */
export async function readOps(
  db: Db,
  expeditionId: string,
  since: number,
  limit = PULL_LIMIT
): Promise<LoggedOp[]> {
  const rows = await db
    .select({
      serverSeq: opsTable.serverSeq,
      opId: opsTable.opId,
      changeId: opsTable.changeId,
      clientSeq: opsTable.clientSeq,
      schemaV: opsTable.schemaV,
      kind: opsTable.kind,
      target: opsTable.target,
      path: opsTable.path,
      value: opsTable.value,
      actor: changes.author,
    })
    .from(opsTable)
    .innerJoin(
      changes,
      and(
        eq(changes.expeditionId, opsTable.expeditionId),
        eq(changes.id, opsTable.changeId)
      )
    )
    .where(
      and(
        eq(opsTable.expeditionId, expeditionId),
        gt(opsTable.serverSeq, since)
      )
    )
    .orderBy(asc(opsTable.serverSeq))
    .limit(limit)
  return rows.map(({ path, value, ...r }) => {
    // Set ops always carry a value (null unsets); other kinds carry one only if non-null.
    const body: Record<string, unknown> = { ...r, expeditionId }
    if (path !== null) body.path = path
    if (path !== null || value !== null) body.value = value
    return body as LoggedOp
  })
}
