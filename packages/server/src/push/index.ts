// Web push (spec §2.5): browsers' subscriptions, per user, and delivery of a
// job's notification to them. Asked for on the first "Leave it building"
// (WP-3.7). Off unless the VAPID keys are set.
//
//   GET    /web-push/key                → { publicKey } | 404 when off
//   POST   /web-push/subscriptions      PushSubscription JSON → 201 (signed in)
//   DELETE /web-push/subscriptions      { endpoint } → 200 (signed in, own only)
import { schema } from "@seply/domain"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { requireUser, type AppEnv } from "../app.ts"
import { isLocalURL, type ServerEnv } from "../config.ts"
import type { Db } from "../db.ts"
import type { JobNotification } from "../jobs/types.ts"
import { sendPush, type VapidKeys } from "./webpush.ts"

export * from "./webpush.ts"

const { pushSubscriptions } = schema

/** Our VAPID keys from env, or null when web push is off. */
export function readVapid(env: ServerEnv): VapidKeys | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null
  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT || "mailto:admin@localhost",
  }
}

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/)

/**
 * A subscription body. Push services are https; a plain-http localhost
 * endpoint (a test's fake push service) is accepted only when `allowLocal`.
 */
export const Subscription = (allowLocal: boolean) =>
  z.object({
    endpoint: z
      .url()
      .max(2048)
      .refine(
        (u) =>
          u.startsWith("https://") ||
          (allowLocal && u.startsWith("http://") && isLocalURL(u)),
        "not a push service URL"
      ),
    keys: z.object({
      p256dh: b64url.min(80).max(100),
      auth: b64url.min(16).max(32),
    }),
  })

export async function saveSubscription(
  db: Db,
  userId: string,
  sub: z.infer<ReturnType<typeof Subscription>>
) {
  const row = {
    endpoint: sub.endpoint,
    userId,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
  }
  // One browser, one row: a browser that signs in as someone else moves over.
  await db
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row })
}

/**
 * Sends one notification to every browser of one user. Subscriptions the
 * push service reports gone are deleted; other failures are only logged.
 * Returns how many were delivered.
 */
export async function notifyUser(
  db: Db,
  userId: string,
  note: JobNotification,
  opts: { vapid: VapidKeys | null; fetch?: typeof fetch }
): Promise<number> {
  const { vapid } = opts
  if (!vapid) return 0
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
  let delivered = 0
  for (const s of subs) {
    try {
      const r = await sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        note,
        vapid,
        { fetch: opts.fetch, topic: note.tag }
      )
      if (r.ok) delivered++
      else if (r.gone)
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, s.endpoint))
      else console.error("web push: refused", r.status)
    } catch (err) {
      console.error("web push: failed", err)
    }
  }
  return delivered
}

export function webPushRoutes() {
  const r = new Hono<AppEnv>()

  r.get("/key", (c) => {
    const vapid = readVapid(c.env ?? {})
    if (!vapid) return c.json({ error: "web push is not configured" }, 404)
    return c.json({ publicKey: vapid.publicKey })
  })

  r.post("/subscriptions", requireUser(), async (c) => {
    const body = Subscription(c.var.config().testCredentials).safeParse(
      await c.req.json().catch(() => null)
    )
    if (!body.success)
      return c.json(
        { error: "invalid subscription", issues: body.error.issues },
        400
      )
    await saveSubscription(await c.var.db(), c.var.user.id, body.data)
    return c.json({ ok: true }, 201)
  })

  r.delete("/subscriptions", requireUser(), async (c) => {
    const body = z
      .object({ endpoint: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: "invalid body" }, 400)
    const db = await c.var.db()
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.data.endpoint),
          eq(pushSubscriptions.userId, c.var.user.id)
        )
      )
    return c.json({ ok: true })
  })

  return r
}
