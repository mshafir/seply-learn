// The live embed (spec §9.3; WP-7.5):
//
//   GET /e/:id/embed[?view=<viewId>&theme=light|dark]
//     → 200 the embed page (the runtime's `embedPage`), or 404
//
// One View of a PUBLIC Expedition, read-only, for other sites to frame (the
// seply.app landing page). The access check is deliberately anonymous: the
// session is never read, so a private or unlisted Expedition is a 404 here
// even for its owner, and an embed can't leak one through a signed-in
// visitor's cookies. The page itself then reads the Expedition as any
// anonymous reader does (/api/pull and the live room).
//
// Every answer on this route, 404s included, carries
// `Content-Security-Policy: frame-ancestors <EMBED_FRAME_ANCESTORS>` and is
// never cached (Visibility can change at any time). No other route's framing
// policy changes.
import { Hono, type Context } from "hono"
import { expeditionAccess } from "./access.ts"
import type { AppEnv } from "./app.ts"

/**
 * Serves the embed page's HTML (the web build's `embed.html`), or null when
 * this runtime has no web build.
 */
export type EmbedPage<Env> = (
  env: Env,
  request: Request
) => Promise<Response | null>

function embedHeaders(c: Context<AppEnv>): Record<string, string> {
  return {
    "content-security-policy": `frame-ancestors ${c.var
      .config()
      .embedFrameAncestors.join(" ")}`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    // The framing page learns nothing about where the embed links to.
    "referrer-policy": "strict-origin-when-cross-origin",
  }
}

const notFound = (headers: Record<string, string>) =>
  new Response("Not found", {
    status: 404,
    headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
  })

export function embedRoutes<Env>(page: EmbedPage<Env> | undefined) {
  const r = new Hono<AppEnv>()
  r.on(["GET", "HEAD"], "/e/:id/embed", async (c) => {
    const headers = embedHeaders(c)
    const db = await c.var.db()
    // Anonymous on purpose: only Public Expeditions embed, whoever asks.
    const access = await expeditionAccess(db, c.req.param("id"), null)
    if (!access || access.visibility !== "public") return notFound(headers)
    const html = await page?.(c.env as Env, c.req.raw)
    if (!html?.ok) return notFound(headers)
    const out = new Response(c.req.method === "HEAD" ? null : html.body, {
      status: 200,
      headers: html.headers,
    })
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v)
    // The runtime's static file headers (an etag, a length) don't apply to a
    // page whose answer depends on the database.
    out.headers.delete("etag")
    out.headers.delete("last-modified")
    return out
  })
  return r
}
