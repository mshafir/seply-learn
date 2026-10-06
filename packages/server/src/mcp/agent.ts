// Who is calling /mcp (spec §6.1): the Bearer token is a personal API token
// (`sl_…`, Better Auth's API key plugin) or an OAuth access token (a JWT
// Better Auth signed, bound to this deploy's /mcp resource). Either way the
// agent acts as its user, with that token's scopes and Expedition
// restriction; the Collaborator role is checked on every call.
import { MCP_SCOPES, type McpScope } from "@seply/ai"
import { schema } from "@seply/domain"
import { eq } from "drizzle-orm"
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose"
import type { Caller } from "../access.ts"
import { grantExpeditions, tokenGrant } from "../agents.ts"
import {
  API_TOKEN_PREFIX,
  authIssuer,
  mcpResource,
  type Auth,
} from "../auth.ts"
import type { ServerConfig } from "../config.ts"
import type { Db } from "../db.ts"

export type Agent = {
  userId: string
  /** The user's name. */
  userName: string
  via: "token" | "oauth"
  /** What the room and Suggestions show, e.g. "Claude Code (via MCP)". */
  label: string
  scopes: ReadonlySet<McpScope>
  /** Restricted to these Expeditions; null: every Expedition the user can see. */
  expeditions: readonly string[] | null
}

/** The caller `expeditionAccess` takes for this agent on one Expedition. */
export function agentCaller(agent: Agent, expeditionId: string): Caller {
  return {
    userId: agent.userId,
    agent: {
      allowed:
        agent.expeditions === null || agent.expeditions.includes(expeditionId),
    },
  }
}

const asScopes = (xs: Iterable<string>) =>
  new Set(
    [...xs].filter((s): s is McpScope =>
      (MCP_SCOPES as readonly string[]).includes(s)
    )
  )

/** The Bearer token of a request, if any. */
export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h)
  return m ? m[1]! : null
}

async function userName(db: Db, userId: string): Promise<string | null> {
  const [u] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  return u ? u.name : null
}

/**
 * The agent behind a request, or null when the request carries no valid
 * token (the route answers 401 with the RFC 9728 challenge).
 */
export async function resolveAgent(
  req: Request,
  deps: { db: Db; auth: Auth; config: ServerConfig }
): Promise<Agent | null> {
  const token = bearer(req)
  if (!token) return null
  if (token.startsWith(API_TOKEN_PREFIX)) return fromApiToken(token, deps)
  return fromAccessToken(token, deps)
}

async function fromApiToken(
  key: string,
  { db, auth }: { db: Db; auth: Auth }
): Promise<Agent | null> {
  const res = await auth.api.verifyApiKey({ body: { key } }).catch(() => null)
  if (!res?.valid || !res.key) return null
  const [row] = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.id, res.key.id))
  if (!row) return null
  const name = await userName(db, row.referenceId)
  if (name === null) return null
  const grant = tokenGrant(row)
  return {
    userId: row.referenceId,
    userName: name,
    via: "token",
    label: `${row.name ?? "Agent"} (via MCP)`,
    scopes: new Set(grant.scopes),
    expeditions: grant.expeditions,
  }
}

async function fromAccessToken(
  token: string,
  { db, auth, config }: { db: Db; auth: Auth; config: ServerConfig }
): Promise<Agent | null> {
  // The public keys come from this deploy's own database (one query): no
  // fetch to our own /jwks, which a Worker can't make to itself.
  const keys = createLocalJWKSet((await auth.api.getJwks()) as JSONWebKeySet)
  let claims: Record<string, unknown>
  try {
    ;({ payload: claims } = await jwtVerify(token, keys, {
      issuer: authIssuer(config),
      audience: mcpResource(config),
    }))
  } catch {
    return null
  }
  const userId = typeof claims.sub === "string" ? claims.sub : null
  const clientId =
    typeof claims.azp === "string"
      ? claims.azp
      : typeof claims.client_id === "string"
        ? claims.client_id
        : null
  if (!userId || !clientId) return null
  const name = await userName(db, userId)
  if (name === null) return null
  const scope = typeof claims.scope === "string" ? claims.scope.split(" ") : []
  const [client] = await db
    .select({ name: schema.oauthClients.name })
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
  return {
    userId,
    userName: name,
    via: "oauth",
    label: `${client?.name ?? "Agent"} (via MCP)`,
    scopes: asScopes(scope),
    expeditions: await grantExpeditions(db, userId, clientId),
  }
}

/** The 401 an MCP client starts OAuth from (RFC 9728 `resource_metadata`). */
export function unauthorized(config: ServerConfig): Response {
  const metadata = `${config.baseURL}/.well-known/oauth-protected-resource${new URL(mcpResource(config)).pathname}`
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Sign in: send an OAuth access token or a Seply Learn API token as Bearer.",
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${metadata}", scope="${MCP_SCOPES.join(" ")}"`,
      },
    }
  )
}
