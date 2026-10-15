// Hosted access approval (spec §2.6, §3.12; WP-7.3). Sign-up and creating are
// open: every signed-in account creates, imports and Forks Expeditions and
// uses MCP. With ACCESS_APPROVAL=1, approval decides one thing: who may use
// this server's AI key (the operator's money). Admins (ADMIN_EMAILS) count as
// approved.
//
// `requireApproval` is the guard every route that starts AI work calls
// (skims, builds, every job, Retry and Continue, the estimates), after its
// own permission check (so an Expedition the caller can't read stays a 404).
// By key mode (ai-config.ts):
// - instance: an unapproved account is refused with
//   403 `{ error: "approval_required", code: "approval_required", message }`;
// - both: an account with a key of its own passes; one without passes only
//   if approved, else 409 `{ error: "needs-key", code: "needs-key", message }`;
// - byok: everyone spends their own key, so it does nothing.
// With the flag off it does nothing. Jobs check again when they resolve
// their key (ai.ts `resolveAi`, both mode).
//
//   POST /access-requests                     { note? } → 201 { request }  (one pending per user)
//   GET  /admin/access-requests               → { pending, approved }      (admins)
//   POST /admin/access-requests/:id/approve   → { request }                (admins; emails the requester)
//   POST /admin/access-requests/:id/decline   → { request }                (admins)
//
// GET /me carries the caller's `AccessState`.
import { schema, ulid } from "@seply/domain"
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { z } from "zod"
import { readAiConfig } from "./ai-config.ts"
import { listKeys } from "./ai-keys.ts"
import type { AppEnv } from "./app.ts"
import type { ServerConfig, ServerEnv } from "./config.ts"
import type { Db } from "./db.ts"
import { accessApprovedEmail, accessRequestEmail, type Email } from "./mailer.ts"

const { users, accessRequests } = schema

export const APPROVAL_REQUIRED = "approval_required"
/** Both mode: no key of their own, and not enabled for this server's AI. */
export const NEEDS_KEY = "needs-key"

export type ApprovalRefusal = typeof APPROVAL_REQUIRED | typeof NEEDS_KEY

const REFUSALS: Record<ApprovalRefusal, string> = {
  [APPROVAL_REQUIRED]:
    "This server's AI is only for accounts an admin has enabled. You can ask to use it in Settings, or use your own agent over MCP.",
  [NEEDS_KEY]:
    "Add your own AI key in Settings, or ask to use this server's AI. You can also use your own agent over MCP.",
}

/**
 * An AI route refused: the account may not use this server's AI key. HTTP
 * 403 `approval_required` (instance mode) or 409 `needs-key` (both mode).
 */
export class ApprovalRequired extends Error {
  constructor(readonly code: ApprovalRefusal = APPROVAL_REQUIRED) {
    super(REFUSALS[code])
  }
  get status(): 403 | 409 {
    return this.code === NEEDS_KEY ? 409 : 403
  }
}

export const isAdmin = (config: Pick<ServerConfig, "access">, email: string) =>
  config.access.admins.includes(email.trim().toLowerCase())

/** A pending access request, as its requester sees it. */
export type OwnAccessRequest = { id: string; note: string; createdAt: string }

/** The caller's standing, for GET /me (the Library's note, Settings). */
export type AccessState = {
  /** ACCESS_APPROVAL is on. Off: everyone is approved and nobody is an admin. */
  approvalRequired: boolean
  /** May use this server's AI key. */
  approved: boolean
  /** May approve requests (only with the flag on). */
  admin: boolean
  /** My pending request, if any. */
  request: OwnAccessRequest | null
}

const iso = (s: string) => new Date(s).toISOString()

async function userRow(db: Db, userId: string) {
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      approvedAt: users.approvedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
  return u ?? null
}

async function pendingRequest(
  db: Db,
  userId: string
): Promise<OwnAccessRequest | null> {
  const [r] = await db
    .select({
      id: accessRequests.id,
      note: accessRequests.note,
      createdAt: accessRequests.createdAt,
    })
    .from(accessRequests)
    .where(
      and(eq(accessRequests.userId, userId), isNull(accessRequests.decidedAt))
    )
  return r ? { ...r, createdAt: iso(r.createdAt) } : null
}

export async function accessState(
  db: Db,
  config: ServerConfig,
  userId: string
): Promise<AccessState> {
  if (!config.access.approval)
    return { approvalRequired: false, approved: true, admin: false, request: null }
  const u = await userRow(db, userId)
  const admin = !!u && isAdmin(config, u.email)
  const approved = admin || !!u?.approvedAt
  return {
    approvalRequired: true,
    approved,
    admin,
    request: approved ? null : await pendingRequest(db, userId),
  }
}

/**
 * May `userId` use this server's AI key? Yes with ACCESS_APPROVAL off;
 * with it on, only approved accounts and admins.
 */
export async function mayUseInstanceKey(
  db: Db,
  config: Pick<ServerConfig, "access">,
  userId: string
): Promise<boolean> {
  if (!config.access.approval) return true
  const u = await userRow(db, userId)
  return !!u && (!!u.approvedAt || isAdmin(config, u.email))
}

/**
 * The guard for AI work. Throws `ApprovalRequired` when `userId` would need
 * this server's key and may not use it (see the top of this file). With
 * their own key, readers spend their own money and pass.
 */
export async function requireApproval(
  db: Db,
  config: ServerConfig,
  userId: string,
  env: ServerEnv = {}
): Promise<void> {
  if (!config.access.approval) return
  const { mode } = readAiConfig(env)
  if (mode === "byok") return
  if (await mayUseInstanceKey(db, config, userId)) return
  if (mode === "instance") throw new ApprovalRequired(APPROVAL_REQUIRED)
  if ((await listKeys(db, userId)).length) return
  throw new ApprovalRequired(NEEDS_KEY)
}

/** `requireApproval` for the signed-in caller of a route. */
export async function requireApprovalFor(c: Context<AppEnv>): Promise<void> {
  await requireApproval(
    await c.var.db(),
    c.var.config(),
    c.var.user.id,
    c.env ?? {}
  )
}

// --- Requests and the admin list --------------------------------------------

export const RequestBody = z
  .object({ note: z.string().trim().max(1000).default("") })
  .strict()

/** A request on the admin list. */
export type PendingAccessRequest = {
  id: string
  user: { id: string; name: string; email: string }
  note: string
  createdAt: string
}

/** An approved account on the admin list's second tab. */
export type ApprovedAccount = {
  id: string
  name: string
  email: string
  approvedAt: string
}

/** GET /admin/access-requests. */
export type AccessRequestsOverview = {
  pending: PendingAccessRequest[]
  approved: ApprovedAccount[]
}

/** How many approved accounts the admin list shows, newest first. */
export const APPROVED_LIST_LIMIT = 200

async function sendAll(c: Context<AppEnv>, emails: Email[], what: string) {
  const mailer = c.var.mailer()
  if (!mailer) return
  for (const email of emails) {
    try {
      await mailer.send(email)
    } catch (err) {
      // The request or decision stands; the email is a courtesy.
      console.error(`mail: ${what} failed`, err)
    }
  }
}

export function approvalRoutes() {
  const r = new Hono<AppEnv>()

  /** 404 with the flag off: none of this exists on self-host. */
  const off = (c: Context<AppEnv>) =>
    c.var.config().access.approval ? null : c.json({ error: "not found" }, 404)

  r.post("/access-requests", async (c) => {
    const closed = off(c)
    if (closed) return closed
    const body = RequestBody.safeParse(await c.req.json().catch(() => ({})))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const config = c.var.config()
    const me = c.var.user
    const state = await accessState(db, config, me.id)
    if (state.approved)
      return c.json(
        { error: "already-approved", message: "Your account is approved already." },
        409
      )
    if (state.request)
      return c.json(
        {
          error: "already-requested",
          message: "You've asked already. An admin will look at it soon.",
          request: state.request,
        },
        409
      )
    const id = ulid(Date.now())
    const createdAt = new Date().toISOString()
    try {
      await db.insert(accessRequests).values({
        id,
        userId: me.id,
        note: body.data.note,
        createdAt,
      })
    } catch (err) {
      // Two requests at once: the pending index keeps one.
      const again = await pendingRequest(db, me.id)
      if (again)
        return c.json(
          {
            error: "already-requested",
            message: "You've asked already. An admin will look at it soon.",
            request: again,
          },
          409
        )
      throw err
    }
    const link = `${config.baseURL}/settings/access-requests`
    await sendAll(
      c,
      config.access.admins.map((to) =>
        accessRequestEmail({
          to,
          name: me.name,
          email: me.email,
          note: body.data.note,
          link,
        })
      ),
      "access request"
    )
    const request: OwnAccessRequest = { id, note: body.data.note, createdAt }
    return c.json({ request }, 201)
  })

  /** 404 with the flag off; 403 unless the caller is an admin. */
  const adminOnly = (c: Context<AppEnv>) =>
    off(c) ??
    (isAdmin(c.var.config(), c.var.user.email)
      ? null
      : c.json(
          { error: "not allowed", message: "Only admins can see access requests." },
          403
        ))

  r.get("/admin/access-requests", async (c) => {
    const refused = adminOnly(c)
    if (refused) return refused
    const db = await c.var.db()
    const pending = await db
      .select({
        id: accessRequests.id,
        note: accessRequests.note,
        createdAt: accessRequests.createdAt,
        userId: users.id,
        name: users.name,
        email: users.email,
      })
      .from(accessRequests)
      .innerJoin(users, eq(users.id, accessRequests.userId))
      .where(isNull(accessRequests.decidedAt))
      .orderBy(asc(accessRequests.createdAt))
    const approved = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        approvedAt: users.approvedAt,
      })
      .from(users)
      .where(isNotNull(users.approvedAt))
      .orderBy(desc(users.approvedAt))
      .limit(APPROVED_LIST_LIMIT)
    const out: AccessRequestsOverview = {
      pending: pending.map((p) => ({
        id: p.id,
        user: { id: p.userId, name: p.name, email: p.email },
        note: p.note,
        createdAt: iso(p.createdAt),
      })),
      approved: approved.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        approvedAt: u.approvedAt!.toISOString(),
      })),
    }
    return c.json(out)
  })

  const decide = (decision: "approved" | "declined") => async (c: Context<AppEnv>) => {
    const refused = adminOnly(c)
    if (refused) return refused
    const db = await c.var.db()
    const id = c.req.param("id")!
    const now = new Date()
    const decided = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(accessRequests)
        .set({
          decidedAt: now.toISOString(),
          decision,
          decidedBy: c.var.user.id,
        })
        .where(and(eq(accessRequests.id, id), isNull(accessRequests.decidedAt)))
        .returning({ userId: accessRequests.userId })
      if (!row) return null
      if (decision === "approved")
        await tx
          .update(users)
          .set({ approvedAt: now })
          .where(and(eq(users.id, row.userId), isNull(users.approvedAt)))
      return row
    })
    if (!decided)
      return c.json(
        { error: "not found", message: "That request is gone or decided already." },
        404
      )
    if (decision === "approved") {
      const u = await userRow(db, decided.userId)
      if (u)
        await sendAll(
          c,
          [
            accessApprovedEmail({
              to: u.email,
              name: u.name,
              link: `${c.var.config().baseURL}/`,
            }),
          ],
          "access approval"
        )
    }
    return c.json({ request: { id, decision, decidedAt: now.toISOString() } })
  }

  r.post("/admin/access-requests/:id/approve", decide("approved"))
  r.post("/admin/access-requests/:id/decline", decide("declined"))

  return r
}
