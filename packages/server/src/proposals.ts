// Proposals (spec §1.5, §3.8; WP-4.3): pending op batches outside the log,
// reviewed in the Suggestions tab. Owners and editors only.
//
//   GET  /expeditions/:id/proposals
//     → 200 { proposals: ProposalView[] }   those with pending items, oldest first
//   POST /expeditions/:id/proposals/review
//        { accept?: itemId[], dismiss?: itemId[], overwrite?: boolean }
//     → 200 ReviewResult
//     → 409 { error, stale?: itemId[], gone?: itemId[], reviewed?: itemId[],
//             waiting?: itemId[] }
//   POST /expeditions/:id/proposals/reopen  { changeId } | { itemIds }
//     → 200 { reopened: itemId[] }
//
// Accepting is one transaction: the accepted items' ops are appended, in an
// order that applies, as ONE Change, "Accepted 3 suggestions", authored by
// the reviewer (origin `human`), and the items are marked accepted with that
// Change's id. An item that needs a suggested Concept which isn't in the map
// is refused unless the item that creates it is accepted in the same request
// (`waiting`: a Relationship waits for its Concepts' packages). A stale item
// (a field it replaces changed since) is refused unless `overwrite`; one
// whose Concept is gone is refused always (dismiss it). Dismissing writes no
// ops (nothing in the Expedition changes), so it is not a Change: the items
// are recorded as dismissed, with every pending item that depends on them
// (`withDependents`: dismissing a Concept dismisses its Relationships), and
// `reopen` brings them back. Items dismissed alongside an accept (a
// package's Relationships left out) carry the accept's Change id, so undoing
// it reopens them too. Undoing an "Accepted …" Change runs in the client
// (WP-4.2); the web then calls `reopen` with its id.
//
// Writers: `createProposal` and `addProposalItems` (the article job; WP-4.4's
// Grow asks; MCP `propose_changes` in M5), then `announceProposals`.
// Reviews and reopens poke the room themselves (`Relay.poke`): open
// Suggestions tabs elsewhere fetch the list again.
import {
  can,
  isStale,
  makeOps,
  orderItems,
  proposalBase,
  proposalStatusOf,
  schema,
  staleness,
  ulid,
  waiting,
  withDependents,
  type DomainState,
  type OpBody,
  type ProposalItemView,
  type ProposalView,
} from "@seply/domain"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { appendOps, PushError, roleOf } from "./oplog.ts"
import { loadState } from "./projection.ts"
import { publishCommitted, publishPoke, type Relay } from "./relay.ts"

const { expeditions, proposals, proposalItems, users } = schema

export class ProposalError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    readonly body: {
      error: string
      message?: string
      stale?: string[]
      gone?: string[]
      reviewed?: string[]
      waiting?: string[]
    }
  ) {
    super(body.message ?? body.error)
    this.name = "ProposalError"
  }
}

/** 404 unless `userId` may see the Expedition; 403 unless they may review Proposals. */
async function mayReview(
  db: Db,
  expeditionId: string,
  userId: string,
  lock = false
) {
  const q = db
    .select({
      visibility: expeditions.visibility,
      deletedAt: expeditions.deletedAt,
    })
    .from(expeditions)
    .where(eq(expeditions.id, expeditionId))
  const [exp] = lock ? await q.for("update") : await q
  if (!exp || exp.deletedAt)
    throw new ProposalError(404, { error: "Expedition not found" })
  const role = await roleOf(db, expeditionId, userId)
  const actor = { role, signedIn: true }
  if (!can(actor, "read", exp.visibility))
    throw new ProposalError(404, { error: "Expedition not found" })
  if (!can(actor, "reviewProposals", exp.visibility))
    throw new ProposalError(403, {
      error: "only owners and editors review suggestions",
    })
}

// --- writing Proposals ---------------------------------------------------------

/** Starts a Proposal (one ask). Idempotent by id. Returns its id. */
export async function createProposal(
  db: Db,
  args: {
    expeditionId: string
    id?: string
    author: string
    origin: "ai" | "mcp"
    /** The ask (spec §5.5: the ask becomes the Proposal's rationale). */
    rationale: string
  }
): Promise<string> {
  const id = args.id ?? ulid(Date.now())
  await db
    .insert(proposals)
    .values({
      expeditionId: args.expeditionId,
      id,
      author: args.author,
      origin: args.origin,
      rationale: args.rationale,
    })
    .onConflictDoNothing()
  return id
}

/**
 * Appends items to a Proposal, after the ones it has. Each item's base is
 * taken from `state` (default: the Expedition now), so pass the state the
 * suggestion was made against when you have it. Idempotent by item id.
 */
export async function addProposalItems(
  db: Db,
  args: {
    expeditionId: string
    proposalId: string
    items: { id?: string; ops: OpBody[] }[]
    state?: DomainState
  }
): Promise<ProposalItemView[]> {
  if (!args.items.length) return []
  const state = args.state ?? (await loadState(db, args.expeditionId))
  if (!state) throw new Error(`no Expedition ${args.expeditionId}`)
  const have = await db
    .select({ position: proposalItems.position })
    .from(proposalItems)
    .where(
      and(
        eq(proposalItems.expeditionId, args.expeditionId),
        eq(proposalItems.proposalId, args.proposalId)
      )
    )
  let position = have.reduce((m, r) => Math.max(m, r.position), 0)
  const rows = args.items.map((item) => ({
    expeditionId: args.expeditionId,
    id: item.id ?? `${args.proposalId}-${position + 1}`,
    proposalId: args.proposalId,
    position: ++position,
    ops: item.ops,
    base: proposalBase(state, item.ops),
  }))
  const inserted = await db
    .insert(proposalItems)
    .values(rows)
    .onConflictDoNothing()
    .returning()
  return inserted.map(itemView)
}

const iso = (t: string | null) => (t ? new Date(t).toISOString() : t)

function itemView(r: typeof proposalItems.$inferSelect): ProposalItemView {
  return {
    id: r.id,
    proposalId: r.proposalId,
    position: r.position,
    ops: r.ops,
    base: r.base,
    status: r.status === "stale" ? "pending" : r.status,
    changeId: r.changeId,
    createdAt: iso(r.createdAt)!,
  }
}

// --- reading -------------------------------------------------------------------

/** The Proposals with pending items, oldest first, each with all its items. */
export async function listProposals(
  db: Db,
  args: { expeditionId: string; userId: string }
): Promise<ProposalView[]> {
  await mayReview(db, args.expeditionId, args.userId)
  return readProposals(db, args.expeditionId)
}

async function readProposals(
  db: Db,
  expeditionId: string
): Promise<ProposalView[]> {
  const items = await db
    .select()
    .from(proposalItems)
    .where(eq(proposalItems.expeditionId, expeditionId))
    .orderBy(asc(proposalItems.position))
  const open = new Set(
    items.filter((i) => i.status === "pending").map((i) => i.proposalId)
  )
  if (!open.size) return []
  const rows = await db
    .select({
      id: proposals.id,
      authorId: proposals.author,
      name: users.name,
      image: users.image,
      origin: proposals.origin,
      rationale: proposals.rationale,
      status: proposals.status,
      createdAt: proposals.createdAt,
    })
    .from(proposals)
    .leftJoin(users, eq(users.id, proposals.author))
    .where(
      and(
        eq(proposals.expeditionId, expeditionId),
        inArray(proposals.id, [...open])
      )
    )
    .orderBy(asc(proposals.createdAt), asc(proposals.id))
  return rows.map((p) => ({
    id: p.id,
    expeditionId,
    author: { id: p.authorId, name: p.name ?? "Someone", image: p.image },
    origin: p.origin,
    rationale: p.rationale,
    status: p.status,
    createdAt: iso(p.createdAt)!,
    items: items.filter((i) => i.proposalId === p.id).map(itemView),
  }))
}

/**
 * One Proposal with all its items (reviewed ones too), or null: what a Grow
 * ask streams as `data-proposal` parts. No access check: callers check.
 */
export async function readProposal(
  db: Db,
  expeditionId: string,
  proposalId: string
): Promise<ProposalView | null> {
  const [p] = await db
    .select({
      id: proposals.id,
      authorId: proposals.author,
      name: users.name,
      image: users.image,
      origin: proposals.origin,
      rationale: proposals.rationale,
      status: proposals.status,
      createdAt: proposals.createdAt,
    })
    .from(proposals)
    .leftJoin(users, eq(users.id, proposals.author))
    .where(
      and(eq(proposals.expeditionId, expeditionId), eq(proposals.id, proposalId))
    )
  if (!p) return null
  const items = await db
    .select()
    .from(proposalItems)
    .where(
      and(
        eq(proposalItems.expeditionId, expeditionId),
        eq(proposalItems.proposalId, proposalId)
      )
    )
    .orderBy(asc(proposalItems.position))
  const views = items.map(itemView)
  return {
    id: p.id,
    expeditionId,
    author: { id: p.authorId, name: p.name ?? "Someone", image: p.image },
    origin: p.origin,
    rationale: p.rationale,
    status: p.status === "pending" ? proposalStatusOf(views.map((i) => i.status)) : p.status,
    createdAt: iso(p.createdAt)!,
    items: views,
  }
}

// --- review ----------------------------------------------------------------------

export const ReviewBody = z
  .object({
    accept: z.array(z.string().min(1)).max(1000).default([]),
    dismiss: z.array(z.string().min(1)).max(1000).default([]),
    /** Accept stale items anyway, overwriting what changed since. */
    overwrite: z.boolean().default(false),
  })
  .refine((b) => b.accept.length + b.dismiss.length > 0, "nothing to review")

export type ReviewResult = {
  /** The Change the accepted items made (null when nothing was accepted). */
  changeId: string | null
  label: string | null
  headSeq: number
  /** Every item accepted, in the order applied. */
  accepted: string[]
  /** Every item dismissed: those asked, and those that depended on them. */
  dismissed: string[]
  /** Items dismissed because they depended on a dismissed one. */
  cascaded: string[]
}

/** "Accepted 3 suggestions". */
export const acceptLabel = (n: number) =>
  n === 1 ? "Accepted 1 suggestion" : `Accepted ${n} suggestions`

/** One review action: accept (as one Change) and/or dismiss. Commits nothing on failure. */
export async function reviewProposals(
  db: Db,
  relay: Relay,
  args: {
    expeditionId: string
    userId: string
    accept: string[]
    dismiss: string[]
    overwrite?: boolean
    now?: () => Date
  }
): Promise<ReviewResult> {
  const { expeditionId, userId } = args
  const now = args.now ?? (() => new Date())
  const out = await db.transaction(async (tx) => {
    await mayReview(tx, expeditionId, userId, true)
    const rows = await tx
      .select()
      .from(proposalItems)
      .where(
        and(
          eq(proposalItems.expeditionId, expeditionId),
          eq(proposalItems.status, "pending")
        )
      )
      .orderBy(asc(proposalItems.createdAt), asc(proposalItems.position))
    const pool = rows.map(itemView)
    const pending = new Set(pool.map((i) => i.id))
    const asked = [...args.accept, ...args.dismiss]
    const reviewed = asked.filter((id) => !pending.has(id))
    if (reviewed.length)
      throw new ProposalError(409, {
        error: "already reviewed",
        message: "Some of these suggestions were already reviewed.",
        reviewed,
      })

    const state = await loadState(tx, expeditionId)
    if (!state) throw new ProposalError(404, { error: "Expedition not found" })
    const waits = waiting(state, pool, args.accept)
    if (waits.size)
      throw new ProposalError(409, {
        error: "needs suggested Concepts",
        message:
          "Accept the Concepts these suggestions need first, or with them.",
        waiting: [...waits.keys()],
      })
    const byId = new Map(pool.map((i) => [i.id, i]))
    const chosen = new Set(args.accept)
    const accepted = orderItems(
      state,
      pool.filter((i) => chosen.has(i.id))
    ).map((i) => i.id)
    const dismissed = withDependents(state, pool, args.dismiss)
    const dismissing = new Set(dismissed)
    const clash = accepted.filter((id) => dismissing.has(id))
    if (clash.length)
      throw new ProposalError(409, {
        error: "needed by an accepted suggestion",
        message: "A suggestion you accepted needs one you dismissed.",
        reviewed: clash,
      })
    const stale: string[] = []
    const gone: string[] = []
    for (const id of accepted) {
      const s = staleness(state, byId.get(id)!, pool)
      if (s.gone.length) gone.push(id)
      else if (isStale(s)) stale.push(id)
    }
    if (gone.length)
      throw new ProposalError(409, {
        error: "can't apply",
        message: "Something these suggestions need was deleted since.",
        gone,
      })
    if (stale.length && !args.overwrite)
      throw new ProposalError(409, {
        error: "changed since suggested",
        message:
          "Some of these suggestions changed since they were made. Accept them again to overwrite.",
        stale,
      })

    let changeId: string | null = null
    let label: string | null = null
    let headSeq = 0
    let logged: Awaited<ReturnType<typeof appendOps>>["logged"] = []
    const bodies = accepted.flatMap((id) => byId.get(id)!.ops)
    if (bodies.length) {
      changeId = ulid(now().getTime())
      label = acceptLabel(accepted.length)
      try {
        const r = await appendOps(tx, {
          expeditionId,
          userId,
          ops: makeOps(bodies, {
            expeditionId,
            actor: userId,
            changeId,
            nextOpId: () => ulid(now().getTime()),
          }),
          changes: [{ id: changeId, label, origin: "human" }],
          now,
        })
        headSeq = r.headSeq
        logged = r.logged
      } catch (e) {
        if (e instanceof PushError && e.status === 409)
          throw new ProposalError(409, {
            error: "can't apply",
            message: e.body.message ?? "These suggestions no longer apply.",
            gone: accepted,
          })
        throw e
      }
    }
    const at = now().toISOString()
    if (accepted.length)
      await tx
        .update(proposalItems)
        .set({
          status: "accepted",
          changeId,
          reviewedBy: userId,
          reviewedAt: at,
        })
        .where(
          and(
            eq(proposalItems.expeditionId, expeditionId),
            inArray(proposalItems.id, accepted)
          )
        )
    if (dismissed.length)
      await tx
        .update(proposalItems)
        .set({
          status: "dismissed",
          changeId,
          reviewedBy: userId,
          reviewedAt: at,
        })
        .where(
          and(
            eq(proposalItems.expeditionId, expeditionId),
            inArray(proposalItems.id, dismissed)
          )
        )
    await refreshStatuses(
      tx,
      expeditionId,
      [...accepted, ...dismissed].map((id) => byId.get(id)!.proposalId)
    )
    if (!headSeq) {
      const [e] = await tx
        .select({ headSeq: expeditions.headSeq })
        .from(expeditions)
        .where(eq(expeditions.id, expeditionId))
      headSeq = e?.headSeq ?? 0
    }
    const result: ReviewResult = {
      changeId,
      label,
      headSeq,
      accepted,
      dismissed,
      cascaded: dismissed.filter((id) => !args.dismiss.includes(id)),
    }
    return { result, logged }
  })
  await publishCommitted(relay, expeditionId, out.logged)
  await publishPoke(relay, expeditionId, out.result.headSeq)
  return out.result
}

/** Each Proposal's status, from its items'. */
async function refreshStatuses(
  tx: Db,
  expeditionId: string,
  proposalIds: string[]
) {
  for (const id of new Set(proposalIds)) {
    const items = await tx
      .select({ status: proposalItems.status })
      .from(proposalItems)
      .where(
        and(
          eq(proposalItems.expeditionId, expeditionId),
          eq(proposalItems.proposalId, id)
        )
      )
    await tx
      .update(proposals)
      .set({ status: proposalStatusOf(items.map((i) => i.status)) })
      .where(
        and(eq(proposals.expeditionId, expeditionId), eq(proposals.id, id))
      )
  }
}

export const ReopenBody = z.union([
  z.object({ changeId: z.string().min(1) }),
  z.object({ itemIds: z.array(z.string().min(1)).min(1).max(1000) }),
])

/**
 * Makes reviewed items pending again: those a Change accepted, and those
 * dismissed with it (after that Change was undone), or dismissed ones by id
 * (undoing a dismissal).
 */
export async function reopenProposals(
  db: Db,
  args: { expeditionId: string; userId: string } & (
    { changeId: string } | { itemIds: string[] }
  )
): Promise<string[]> {
  const { expeditionId, userId } = args
  return db.transaction(async (tx) => {
    await mayReview(tx, expeditionId, userId, true)
    const which =
      "changeId" in args
        ? and(
            inArray(proposalItems.status, ["accepted", "dismissed"]),
            eq(proposalItems.changeId, args.changeId)
          )
        : and(
            eq(proposalItems.status, "dismissed"),
            inArray(proposalItems.id, args.itemIds)
          )
    const rows = await tx
      .update(proposalItems)
      .set({
        status: "pending",
        changeId: null,
        reviewedBy: null,
        reviewedAt: null,
      })
      .where(and(eq(proposalItems.expeditionId, expeditionId), which))
      .returning({ id: proposalItems.id, proposalId: proposalItems.proposalId })
    await refreshStatuses(
      tx,
      expeditionId,
      rows.map((r) => r.proposalId)
    )
    return rows.map((r) => r.id)
  })
}

/**
 * Tells the Expedition's room that its Proposals changed (a `poke` at the
 * current head), so open Suggestions tabs fetch them again. Call it after
 * writing Proposals (`createProposal`, `addProposalItems`) outside a review.
 */
export async function announceProposals(
  db: Db,
  relay: Relay,
  expeditionId: string
) {
  const [e] = await db
    .select({ headSeq: expeditions.headSeq })
    .from(expeditions)
    .where(eq(expeditions.id, expeditionId))
  if (e) await publishPoke(relay, expeditionId, e.headSeq)
}

// --- routes -----------------------------------------------------------------------

export function proposalRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()
  const answer = (e: unknown) => {
    if (e instanceof ProposalError)
      return new Response(JSON.stringify(e.body), {
        status: e.status,
        headers: { "content-type": "application/json" },
      })
    throw e
  }

  r.get("/:id/proposals", async (c) => {
    try {
      const list = await listProposals(await c.var.db(), {
        expeditionId: c.req.param("id"),
        userId: c.var.user.id,
      })
      return c.json({ proposals: list })
    } catch (e) {
      return answer(e)
    }
  })

  r.post("/:id/proposals/review", async (c) => {
    const body = ReviewBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    try {
      return c.json(
        await reviewProposals(await c.var.db(), relay, {
          expeditionId: c.req.param("id"),
          userId: c.var.user.id,
          ...body.data,
        })
      )
    } catch (e) {
      return answer(e)
    }
  })

  r.post("/:id/proposals/reopen", async (c) => {
    const body = ReopenBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    try {
      const db = await c.var.db()
      const expeditionId = c.req.param("id")
      const reopened = await reopenProposals(db, {
        expeditionId,
        userId: c.var.user.id,
        ...body.data,
      })
      if (reopened.length) await announceProposals(db, relay, expeditionId)
      return c.json({ reopened })
    } catch (e) {
      return answer(e)
    }
  })
  return r
}
