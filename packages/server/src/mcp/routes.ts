// The MCP endpoint and OAuth discovery (spec §6.1), at the origin's root, not
// under /api: MCP clients connect to `<origin>/mcp`, and OAuth discovery
// documents must sit at `<origin>/.well-known/…`.
//
//   POST|GET|DELETE /mcp        streamable HTTP, stateless (MCP TS SDK v2
//                               `createMcpHandler`); 2025-era clients are
//                               served by its stateless fallback
//   GET /.well-known/oauth-protected-resource[/mcp]       RFC 9728 (Better Auth's mcp plugin)
//   GET /.well-known/oauth-authorization-server[/api/auth] RFC 8414
//   GET /.well-known/openid-configuration[…]              (not an OIDC server: 404)
//
// A request without a valid Bearer token gets 401 with the RFC 9728
// `resource_metadata` challenge, which is where an MCP client starts OAuth.
import type { ViewReader } from "@seply/ai"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import type { AppEnv } from "../app.ts"
import type { Relay } from "../relay.ts"
import { resolveAgent, unauthorized } from "./agent.ts"
import { mcpServer } from "./tools.ts"

/** Requests MCP may carry (spec 2026-07-28 adds Mcp-Method and Mcp-Name). */
const MCP_CORS = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: [
    "authorization",
    "content-type",
    "accept",
    "mcp-protocol-version",
    "mcp-session-id",
    "mcp-method",
    "mcp-name",
    "last-event-id",
  ],
  exposeHeaders: ["www-authenticate", "mcp-session-id", "mcp-protocol-version"],
  maxAge: 86400,
})

export function mcpRoutes(relay: Relay, opts: { views?: ViewReader } = {}) {
  const r = new Hono<AppEnv>()
  r.use("/mcp", MCP_CORS)
  r.use(
    "/.well-known/*",
    cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"] })
  )

  r.on(["GET", "POST", "DELETE"], "/mcp", async (c) => {
    const db = await c.var.db()
    const config = c.var.config()
    const agent = await resolveAgent(c.req.raw, {
      db,
      auth: await c.var.auth(),
      config,
    })
    if (!agent) return unauthorized(config)
    const handler = createMcpHandler(
      () =>
        mcpServer({
          db,
          agent,
          relay,
          config,
          blobs: c.var.blobs,
          views: opts.views,
        }),
      { onerror: (err) => console.error("mcp:", err) }
    )
    // Buffered: the database connection closes when this handler returns,
    // so the whole answer is made first (a stateless exchange is short).
    const res = await handler.fetch(c.req.raw)
    const body = await res.arrayBuffer()
    return new Response(body.byteLength ? body : null, {
      status: res.status,
      headers: res.headers,
    })
  })

  // Discovery documents: Better Auth serves them from its handler.
  r.on(["GET", "HEAD"], "/.well-known/*", async (c) => {
    const auth = await c.var.auth()
    const res = await auth.handler(c.req.raw)
    return res.status === 404 ? c.json({ error: "not found" }, 404) : res
  })

  return r
}
