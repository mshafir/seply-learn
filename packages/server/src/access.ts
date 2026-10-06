// The one place a route learns what the caller may do with an Expedition
// (spec §1.8). It reads the Expedition's Visibility and the caller's
// Collaborator role, and @seply/domain's `can` (the permissions matrix as
// code) decides each action. Every route goes through `expeditionAccess`, so
// Visibility (WP-5.2: unlisted and public links, anonymous readers) and
// agents (WP-5.4: API tokens and MCP, restricted to chosen Expeditions)
// change one function, not each route.
//
// The rule every route follows: an Expedition the caller can't read is a 404,
// whether it is private, in Trash or missing (so a private Expedition's
// existence never leaks); one they can read but not act on is a 403.
import {
  can,
  schema,
  type Action,
  type Actor,
  type Role,
  type Visibility,
} from "@seply/domain"
import { and, eq } from "drizzle-orm"
import type { Context } from "hono"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"

const { expeditions, collaborators } = schema

/** Who is asking: a signed-in user, or nobody (an anonymous reader). */
export type Caller = {
  userId: string | null
  /**
   * Acting through an API token or MCP agent (WP-5.4): `allowed` is false
   * when the token is restricted to other Expeditions.
   */
  agent?: { allowed: boolean }
}

export type ExpeditionAccess = {
  expeditionId: string
  /** The caller's Collaborator role, or null. */
  role: Role | null
  visibility: Visibility
  ownerId: string
  headSeq: number
  actor: Actor
  /** Whether the caller may take `action` here (the permissions matrix). */
  may: (action: Action) => boolean
}

/** The caller's role on an Expedition, or null. */
export async function roleOf(
  db: Db,
  expeditionId: string,
  userId: string | null
): Promise<Role | null> {
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
 * The caller's access to an Expedition, or null when they can't read it
 * (missing, in Trash, or private and not theirs). With `lock`, the
 * Expedition's row is locked for the rest of the transaction (pushes).
 */
export async function expeditionAccess(
  db: Db,
  expeditionId: string,
  caller: Caller | string | null,
  opts: { lock?: boolean } = {}
): Promise<ExpeditionAccess | null> {
  const who: Caller =
    typeof caller === "string" || caller === null ? { userId: caller } : caller
  const q = db
    .select({
      visibility: expeditions.visibility,
      deletedAt: expeditions.deletedAt,
      headSeq: expeditions.headSeq,
      ownerId: expeditions.ownerId,
    })
    .from(expeditions)
    .where(eq(expeditions.id, expeditionId))
  const [exp] = opts.lock ? await q.for("update") : await q
  if (!exp || exp.deletedAt) return null
  const role = await roleOf(db, expeditionId, who.userId)
  const actor: Actor = {
    role,
    signedIn: who.userId !== null,
    ...(who.agent && { agent: who.agent }),
  }
  if (!can(actor, "read", exp.visibility)) return null
  return {
    expeditionId,
    role,
    visibility: exp.visibility,
    ownerId: exp.ownerId,
    headSeq: exp.headSeq,
    actor,
    may: (action) => can(actor, action, exp.visibility),
  }
}

/** The signed-in user's id, or null (for routes open to anonymous readers). */
export async function sessionUserId(
  c: Context<AppEnv>
): Promise<string | null> {
  const auth = await c.var.auth()
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  return session?.user.id ?? null
}

/** Why a request was refused: 404 (can't read it) or 403 (can't do this). */
export class AccessDenied extends Error {
  constructor(
    readonly status: 403 | 404,
    message: string
  ) {
    super(message)
  }
}

/**
 * The caller's access, when they may take `action`; throws `AccessDenied`
 * (404 or 403) otherwise. The app answers it as `{ error }` with its status.
 */
export async function authorize(
  db: Db,
  expeditionId: string,
  caller: Caller | string | null,
  action: Action,
  opts: { lock?: boolean; refusal?: string } = {}
): Promise<ExpeditionAccess> {
  const a = await expeditionAccess(db, expeditionId, caller, opts)
  if (!a) throw new AccessDenied(404, "Expedition not found")
  if (!a.may(action)) throw new AccessDenied(403, opts.refusal ?? "not allowed")
  return a
}
