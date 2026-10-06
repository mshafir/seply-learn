// Sharing (WP-5.1, spec §1.8, §3.9): Collaborators, invites, roles and
// ownership. Every route checks the permissions matrix through
// `expeditionAccess` / `authorize` (access.ts).
//
//   GET    /expeditions/:id/sharing                → who has access   (read)
//   POST   /expeditions/:id/invites                → 201 invite       (invite: owners, editors)
//          { email, role: "editor" | "viewer" }
//   DELETE /expeditions/:id/invites/:inviteId      → 204              (owner, or whoever invited)
//   PATCH  /expeditions/:id/collaborators/:userId  → { collaborator } (changeRole: owner)
//          { role: "editor" | "viewer" }
//   DELETE /expeditions/:id/collaborators/:userId  → 204              (removeCollaborator: owner; anyone may leave)
//   POST   /expeditions/:id/transfer { userId }    → 200              (transferOwnership: owner, to an editor)
//   POST   /expeditions/:id/seen                   → 204              (clears the New badge)
//   GET    /invites/:token                         → the invite       (anyone holding the link)
//   POST   /invites/:token/accept                  → { expeditionId, role } (signed in)
//
// Someone who loses access or changes role is kicked from the live room
// (Relay.kick), so their open tab reopens the Expedition and finds its new
// access at once: gone, or read-only.
import { schema, ulid, type Role } from "@seply/domain"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { z } from "zod"
import { authorize, expeditionAccess, sessionUserId } from "./access.ts"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { inviteEmail } from "./mailer.ts"
import type { Relay } from "./relay.ts"

const { collaborators, expeditions, invites, users } = schema

export const InviteRole = z.enum(["editor", "viewer"])
export type InviteRole = z.infer<typeof InviteRole>

export const InviteBody = z.object({
  email: z.email().trim().toLowerCase().max(320),
  role: InviteRole,
})
const RoleBody = z.object({ role: InviteRole })
const TransferBody = z.object({ userId: z.string().min(1).max(128) })

/** A Collaborator as the share dialog lists them. */
export type SharingPerson = {
  id: string
  name: string
  /** Shown to Collaborators only (empty for readers of a link). */
  email: string
  image: string | null
  role: Role
}

export type PendingInvite = {
  id: string
  email: string
  role: InviteRole
  invitedBy: { id: string; name: string }
  createdAt: string
}

export type Sharing = {
  /** The caller's role, or null for a reader of a link. */
  role: Role | null
  visibility: "private" | "unlisted" | "public"
  /** What the caller may do here. */
  may: {
    invite: boolean
    changeRole: boolean
    removeCollaborator: boolean
    transferOwnership: boolean
  }
  collaborators: SharingPerson[]
  /** Not accepted yet; listed for those who may invite. */
  invites: PendingInvite[]
}

export type InviteCreated = {
  invite: PendingInvite
  /** The link to send them (always offered, spec §3.9). */
  link: string
  /** Whether an email went out. */
  emailed: boolean
  /** They already had an account: they are a Collaborator now. */
  added: boolean
}

export type InviteInfo = {
  expedition: { id: string; title: string }
  role: InviteRole
  invitedBy: string
  email: string
  /** pending; accepted (by someone else); yours (you accepted it). */
  status: "pending" | "accepted" | "yours"
}

const ROLE_ORDER: Record<Role, number> = { owner: 0, editor: 1, viewer: 2 }

const iso = (col: unknown) =>
  sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/** 32 random bytes, base64url: the invite link's token. */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** What we store of a token: its SHA-256, hex. */
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** The invite link the share dialog offers and the email carries. */
export const inviteLink = (baseURL: string, token: string) =>
  `${baseURL}/invite/${token}`

/**
 * Adds `userId` as a Collaborator with `role`, or raises their role to it
 * (never lowers it: accepting a viewer invite doesn't demote an editor).
 * Returns the role they end up with.
 */
async function grant(
  db: Db,
  args: {
    expeditionId: string
    userId: string
    role: InviteRole
    invitedBy: string
  }
): Promise<Role> {
  const [row] = await db
    .select({ role: collaborators.role })
    .from(collaborators)
    .where(
      and(
        eq(collaborators.expeditionId, args.expeditionId),
        eq(collaborators.userId, args.userId)
      )
    )
  if (!row) {
    await db.insert(collaborators).values({
      expeditionId: args.expeditionId,
      userId: args.userId,
      role: args.role,
      invitedBy: args.invitedBy,
    })
    return args.role
  }
  if (ROLE_ORDER[args.role] < ROLE_ORDER[row.role]) {
    await db
      .update(collaborators)
      .set({ role: args.role })
      .where(
        and(
          eq(collaborators.expeditionId, args.expeditionId),
          eq(collaborators.userId, args.userId)
        )
      )
    return args.role
  }
  return row.role
}

/** May this account claim invites sent to its email without the link? */
async function verifiedEmail(
  db: Db,
  userId: string,
  testCredentials: boolean
): Promise<string | null> {
  const [u] = await db
    .select({ email: users.email, verified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
  if (!u) return null
  // Hosted sign-in is Google, whose emails are verified; test accounts
  // (localhost only) aren't, and count as verified.
  return u.verified || testCredentials ? u.email.toLowerCase() : null
}

/**
 * The inbox (spec §3.9): pending invites to this user's (verified) email
 * become Collaborator rows, unseen, so they show under "Shared with you" with
 * a New badge. Run when the Library lists Expeditions. Returns how many.
 */
export async function claimInvites(
  db: Db,
  userId: string,
  testCredentials: boolean
): Promise<number> {
  const email = await verifiedEmail(db, userId, testCredentials)
  if (!email) return 0
  const pending = await db
    .select({
      id: invites.id,
      expeditionId: invites.expeditionId,
      role: invites.role,
      invitedBy: invites.invitedBy,
    })
    .from(invites)
    .innerJoin(expeditions, eq(expeditions.id, invites.expeditionId))
    .where(
      and(
        eq(invites.email, email),
        isNull(invites.acceptedAt),
        isNull(expeditions.deletedAt)
      )
    )
  for (const inv of pending) {
    await db.transaction(async (tx) => {
      await grant(tx, { ...inv, userId })
      await tx
        .update(invites)
        .set({ acceptedBy: userId, acceptedAt: new Date().toISOString() })
        .where(eq(invites.id, inv.id))
    })
  }
  return pending.length
}

/** Who has access, and pending invites (for those who may invite). */
export async function readSharing(
  db: Db,
  expeditionId: string,
  userId: string
): Promise<Sharing | null> {
  const a = await expeditionAccess(db, expeditionId, userId)
  if (!a) return null
  const people = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: collaborators.role,
    })
    .from(collaborators)
    .innerJoin(users, eq(users.id, collaborators.userId))
    .where(eq(collaborators.expeditionId, expeditionId))
  const mayInvite = a.may("invite")
  const pending = mayInvite
    ? await db
        .select({
          id: invites.id,
          email: invites.email,
          role: invites.role,
          invitedById: invites.invitedBy,
          invitedByName: users.name,
          createdAt: iso(invites.createdAt),
        })
        .from(invites)
        .innerJoin(users, eq(users.id, invites.invitedBy))
        .where(
          and(
            eq(invites.expeditionId, expeditionId),
            isNull(invites.acceptedAt)
          )
        )
        .orderBy(invites.createdAt)
    : []
  return {
    role: a.role,
    visibility: a.visibility,
    may: {
      invite: mayInvite,
      changeRole: a.may("changeRole"),
      removeCollaborator: a.may("removeCollaborator"),
      transferOwnership: a.may("transferOwnership"),
    },
    collaborators: people
      .map((p) => ({ ...p, email: a.role ? p.email : "" }))
      .sort(
        (x, y) =>
          ROLE_ORDER[x.role] - ROLE_ORDER[y.role] ||
          x.name.localeCompare(y.name)
      ),
    invites: pending.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: { id: i.invitedById, name: i.invitedByName },
      createdAt: i.createdAt,
    })),
  }
}

/** Tells the relay; a failure is only logged (the role is already changed). */
async function kick(
  relay: Relay,
  expeditionId: string,
  userId: string,
  reason: string
) {
  try {
    await relay.kick?.(expeditionId, userId, reason)
  } catch (err) {
    console.error("relay: kick failed", err)
  }
}

async function collaboratorRole(
  db: Db,
  expeditionId: string,
  userId: string
): Promise<Role | null> {
  const [row] = await db
    .select({ role: collaborators.role })
    .from(collaborators)
    .where(
      and(
        eq(collaborators.expeditionId, expeditionId),
        eq(collaborators.userId, userId)
      )
    )
  return row?.role ?? null
}

const bodyOf = async <T>(c: Context<AppEnv>, schema: z.ZodType<T>) => {
  const r = schema.safeParse(await c.req.json().catch(() => null))
  return r.success
    ? { ok: true as const, data: r.data }
    : { ok: false as const, issues: r.error.issues }
}

/** The routes under /expeditions (signed in). */
export function sharingRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()

  r.get("/:id/sharing", async (c) => {
    const db = await c.var.db()
    const s = await readSharing(db, c.req.param("id"), c.var.user.id)
    if (!s) return c.json({ error: "Expedition not found" }, 404)
    return c.json(s)
  })

  r.post("/:id/invites", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const me = c.var.user
    await authorize(db, expeditionId, me.id, "invite", {
      refusal: "only owners and editors invite",
    })
    const body = await bodyOf(c, InviteBody)
    if (!body.ok)
      return c.json({ error: "invalid body", issues: body.issues }, 400)
    const { email, role } = body.data

    const [existing] = await db
      .select({ id: users.id, verified: users.emailVerified })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
    if (existing && (await collaboratorRole(db, expeditionId, existing.id)))
      return c.json({ error: "already a Collaborator" }, 409)

    const config = c.var.config()
    const token = newInviteToken()
    const id = ulid(Date.now())
    // An account with that (verified) email gets it in their inbox at once.
    const addNow = !!existing && (existing.verified || config.testCredentials)
    const now = new Date().toISOString()
    await db.transaction(async (tx) => {
      // Inviting the same email again replaces the pending invite (a fresh link).
      await tx
        .delete(invites)
        .where(
          and(
            eq(invites.expeditionId, expeditionId),
            eq(invites.email, email),
            isNull(invites.acceptedAt)
          )
        )
      await tx.insert(invites).values({
        id,
        expeditionId,
        email,
        role,
        tokenHash: await hashInviteToken(token),
        invitedBy: me.id,
        createdAt: now,
        ...(addNow && { acceptedBy: existing.id, acceptedAt: now }),
      })
      if (addNow)
        await grant(tx, {
          expeditionId,
          userId: existing.id,
          role,
          invitedBy: me.id,
        })
    })

    const link = inviteLink(config.baseURL, token)
    let emailed = false
    const mailer = c.var.mailer()
    if (mailer) {
      const [exp] = await db
        .select({ title: expeditions.title })
        .from(expeditions)
        .where(eq(expeditions.id, expeditionId))
      try {
        await mailer.send(
          inviteEmail({
            to: email,
            inviter: me.name || me.email,
            title: exp?.title ?? "",
            role,
            link,
          })
        )
        emailed = true
      } catch (err) {
        // The link still works; the dialog says the email didn't go.
        console.error("mail: invite failed", err)
      }
    }
    const out: InviteCreated = {
      invite: {
        id,
        email,
        role,
        invitedBy: { id: me.id, name: me.name },
        createdAt: now,
      },
      link,
      emailed,
      added: addNow,
    }
    return c.json(out, 201)
  })

  r.delete("/:id/invites/:inviteId", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const a = await authorize(db, expeditionId, c.var.user.id, "invite", {
      refusal: "only owners and editors manage invites",
    })
    const [inv] = await db
      .select({ invitedBy: invites.invitedBy })
      .from(invites)
      .where(
        and(
          eq(invites.id, c.req.param("inviteId")),
          eq(invites.expeditionId, expeditionId),
          isNull(invites.acceptedAt)
        )
      )
    if (!inv) return c.json({ error: "invite not found" }, 404)
    if (inv.invitedBy !== c.var.user.id && !a.may("removeCollaborator"))
      return c.json({ error: "only the owner or whoever invited them" }, 403)
    await db.delete(invites).where(eq(invites.id, c.req.param("inviteId")))
    return c.body(null, 204)
  })

  r.patch("/:id/collaborators/:userId", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const target = c.req.param("userId")
    await authorize(db, expeditionId, c.var.user.id, "changeRole", {
      refusal: "only the owner changes roles",
    })
    const body = await bodyOf(c, RoleBody)
    if (!body.ok)
      return c.json({ error: "invalid body", issues: body.issues }, 400)
    const current = await collaboratorRole(db, expeditionId, target)
    if (!current) return c.json({ error: "not a Collaborator" }, 404)
    if (current === "owner")
      return c.json({ error: "transfer ownership instead" }, 409)
    if (current !== body.data.role) {
      await db
        .update(collaborators)
        .set({ role: body.data.role })
        .where(
          and(
            eq(collaborators.expeditionId, expeditionId),
            eq(collaborators.userId, target)
          )
        )
      await kick(
        relay,
        expeditionId,
        target,
        body.data.role === "viewer"
          ? "The owner made you a viewer"
          : "The owner made you an editor"
      )
    }
    return c.json({ collaborator: { id: target, role: body.data.role } })
  })

  r.delete("/:id/collaborators/:userId", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const target = c.req.param("userId")
    const me = c.var.user.id
    const a = await expeditionAccess(db, expeditionId, me)
    if (!a) return c.json({ error: "Expedition not found" }, 404)
    // Anyone but the owner may leave; only the owner removes others.
    const leaving = target === me && a.role !== null && a.role !== "owner"
    if (!leaving && !a.may("removeCollaborator"))
      return c.json({ error: "only the owner removes people" }, 403)
    const current = await collaboratorRole(db, expeditionId, target)
    if (!current) return c.json({ error: "not a Collaborator" }, 404)
    if (current === "owner")
      return c.json({ error: "the owner can't be removed" }, 409)
    await db
      .delete(collaborators)
      .where(
        and(
          eq(collaborators.expeditionId, expeditionId),
          eq(collaborators.userId, target)
        )
      )
    await kick(
      relay,
      expeditionId,
      target,
      leaving ? "You left this Expedition" : "The owner removed you"
    )
    return c.body(null, 204)
  })

  r.post("/:id/transfer", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const me = c.var.user.id
    const body = await bodyOf(c, TransferBody)
    await authorize(db, expeditionId, me, "transferOwnership", {
      refusal: "only the owner transfers ownership",
    })
    if (!body.ok)
      return c.json({ error: "invalid body", issues: body.issues }, 400)
    const target = body.data.userId
    const done = await db.transaction(async (tx) => {
      // Lock the row and check again: two transfers can't both win.
      const a = await authorize(tx, expeditionId, me, "transferOwnership", {
        lock: true,
      })
      if (target === a.ownerId) return "self" as const
      const current = await collaboratorRole(tx, expeditionId, target)
      // Spec §1.8: to an existing editor.
      if (current !== "editor") return "not-editor" as const
      const set = (userId: string, role: Role) =>
        tx
          .update(collaborators)
          .set({ role })
          .where(
            and(
              eq(collaborators.expeditionId, expeditionId),
              eq(collaborators.userId, userId)
            )
          )
      await set(target, "owner")
      await set(me, "editor")
      await tx
        .update(expeditions)
        .set({ ownerId: target })
        .where(eq(expeditions.id, expeditionId))
      return "ok" as const
    })
    if (done === "self") return c.json({ error: "already the owner" }, 409)
    if (done === "not-editor")
      return c.json({ error: "ownership goes to an existing editor" }, 409)
    return c.json({ ownerId: target })
  })

  r.post("/:id/seen", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const a = await expeditionAccess(db, expeditionId, c.var.user.id)
    if (!a) return c.json({ error: "Expedition not found" }, 404)
    if (a.role)
      await db
        .update(collaborators)
        .set({ seenAt: new Date().toISOString() })
        .where(
          and(
            eq(collaborators.expeditionId, expeditionId),
            eq(collaborators.userId, c.var.user.id),
            isNull(collaborators.seenAt)
          )
        )
    return c.body(null, 204)
  })

  return r
}

/** The invite link's routes, under /invites. Reading one needs no session. */
export function inviteRoutes() {
  const r = new Hono<AppEnv>()

  const find = async (db: Db, token: string) => {
    if (token.length < 20 || token.length > 100) return null
    const [row] = await db
      .select({
        id: invites.id,
        expeditionId: invites.expeditionId,
        email: invites.email,
        role: invites.role,
        invitedBy: invites.invitedBy,
        inviterName: users.name,
        acceptedBy: invites.acceptedBy,
        acceptedAt: invites.acceptedAt,
        title: expeditions.title,
        deletedAt: expeditions.deletedAt,
      })
      .from(invites)
      .innerJoin(expeditions, eq(expeditions.id, invites.expeditionId))
      .innerJoin(users, eq(users.id, invites.invitedBy))
      .where(eq(invites.tokenHash, await hashInviteToken(token)))
    return row && !row.deletedAt ? row : null
  }

  r.get("/:token", async (c) => {
    const db = await c.var.db()
    const inv = await find(db, c.req.param("token"))
    if (!inv) return c.json({ error: "invite not found" }, 404)
    const me = await sessionUserId(c)
    const out: InviteInfo = {
      expedition: { id: inv.expeditionId, title: inv.title },
      role: inv.role,
      invitedBy: inv.inviterName,
      email: inv.email,
      status: !inv.acceptedAt
        ? "pending"
        : me && inv.acceptedBy === me
          ? "yours"
          : "accepted",
    }
    return c.json(out)
  })

  r.post("/:token/accept", async (c) => {
    const me = await sessionUserId(c)
    if (!me) return c.json({ error: "sign in required" }, 401)
    const db = await c.var.db()
    const inv = await find(db, c.req.param("token"))
    if (!inv) return c.json({ error: "invite not found" }, 404)
    if (inv.acceptedAt && inv.acceptedBy !== me)
      return c.json({ error: "this invite was already used" }, 410)
    const role = await db.transaction(async (tx) => {
      // Claim it first, so two accounts can't both use one link.
      const claimed = inv.acceptedAt
        ? [{ id: inv.id }]
        : await tx
            .update(invites)
            .set({ acceptedBy: me, acceptedAt: new Date().toISOString() })
            .where(and(eq(invites.id, inv.id), isNull(invites.acceptedAt)))
            .returning({ id: invites.id })
      if (!claimed.length) return null
      return grant(tx, {
        expeditionId: inv.expeditionId,
        userId: me,
        role: inv.role,
        invitedBy: inv.invitedBy,
      })
    })
    if (!role) return c.json({ error: "this invite was already used" }, 410)
    return c.json({ expeditionId: inv.expeditionId, role })
  })

  return r
}
