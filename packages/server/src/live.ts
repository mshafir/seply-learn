// The live room over HTTP (spec §2.4).
//
//   GET /expeditions/:id/live   WebSocket upgrade into the Expedition's room
//
// Anyone who may view the Expedition may connect, signed in or not (like
// /pull): collaborators (owner, editors, viewers) with presence, other
// signed-in readers of a public or unlisted link read-only, and anonymous
// readers of one for `ops` only. Which is which goes to the room as the
// join's `access`. An Expedition the caller can't view is a 404, whether it
// is private or missing; a request that isn't an upgrade is a 426; without a
// relay that takes upgrades, 501.
import { can, schema } from "@seply/domain"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "./app.ts"
import { roleOf } from "./oplog.ts"
import type { Relay, RoomAccess } from "./relay.ts"

export function liveRoutes(relay: Relay) {
  const r = new Hono<AppEnv>()

  r.get("/expeditions/:id/live", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return c.json({ error: "expected a WebSocket upgrade" }, 426)
    if (!relay.handleUpgrade)
      return c.json({ error: "the live room is not available" }, 501)
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const [exp] = await db
      .select({
        visibility: schema.expeditions.visibility,
        deletedAt: schema.expeditions.deletedAt,
        headSeq: schema.expeditions.headSeq,
      })
      .from(schema.expeditions)
      .where(eq(schema.expeditions.id, expeditionId))
    const notFound = () => c.json({ error: "Expedition not found" }, 404)
    if (!exp || exp.deletedAt) return notFound()
    const auth = await c.var.auth()
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    const user = session?.user ?? null
    const role = await roleOf(db, expeditionId, user?.id ?? null)
    if (!can({ role, signedIn: !!user }, "read", exp.visibility))
      return notFound()
    const access: RoomAccess = role
      ? "collaborator"
      : user
        ? "reader"
        : "anonymous"
    return relay.handleUpgrade(c.req.raw, {
      expeditionId,
      userId: user?.id ?? null,
      name: user ? user.name || user.email : "",
      access,
      headSeq: exp.headSeq,
    })
  })

  return r
}
