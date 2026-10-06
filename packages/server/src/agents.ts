// Connected agents (spec §3.10, §6.1; WP-5.4): personal API tokens and MCP
// OAuth grants, each with scopes and an optional restriction to chosen
// Expeditions. Signed in; each user sees and manages only their own.
//
//   GET    /agents                      → 200 AgentsOverview
//   POST   /agents/tokens               { name, scopes[], expeditions?: id[] | null, expiresInDays? }
//                                       → 201 { token: ApiToken, key }   the key is shown this once
//   DELETE /agents/tokens/:id           → 204
//   POST   /agents/consent              { clientId, expeditions: id[] | null }
//                                       → 204   the consent screen, before Better Auth's /oauth2/consent
//   DELETE /agents/grants/:clientId     → 204   forgets the consent and revokes its tokens
//
// Tokens are Better Auth API keys (`@better-auth/api-key`): only a hash is
// stored. Their scopes live in `permissions.mcp`, their Expeditions in
// `metadata.expeditions`. An OAuth grant's Expeditions live in `agent_grants`
// (ours), keyed by user and client.
import { MCP_SCOPE_LABELS, MCP_SCOPES, McpScope } from "@seply/ai"
import { schema } from "@seply/domain"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"

const {
  apiKeys,
  agentGrants,
  collaborators,
  expeditions,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} = schema

/** A personal API token as Settings lists it (never the key). */
export type ApiToken = {
  id: string
  name: string
  /** The key's first characters, e.g. `sl_AbC`. */
  start: string | null
  scopes: McpScope[]
  /** Restricted to these Expeditions; null: every Expedition the user can see. */
  expeditions: string[] | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

/** An OAuth client the user consented to, e.g. Claude Code. */
export type AgentGrant = {
  clientId: string
  name: string
  uri: string | null
  icon: string | null
  scopes: McpScope[]
  expeditions: string[] | null
  createdAt: string | null
}

export type AgentsOverview = {
  tokens: ApiToken[]
  grants: AgentGrant[]
  /** Each scope with its words, for the forms. */
  scopes: { id: McpScope; label: string }[]
}

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null

const asScopes = (xs: readonly string[] | null | undefined): McpScope[] =>
  (xs ?? []).filter((s): s is McpScope =>
    (MCP_SCOPES as readonly string[]).includes(s)
  )

function parseJson(s: string | null): Record<string, unknown> {
  if (!s) return {}
  try {
    const v: unknown = JSON.parse(s)
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** A token row's scopes and Expedition restriction. */
export function tokenGrant(row: {
  permissions: string | null
  metadata: string | null
}): { scopes: McpScope[]; expeditions: string[] | null } {
  const perms = parseJson(row.permissions) as { mcp?: string[] }
  const meta = parseJson(row.metadata) as { expeditions?: string[] | null }
  return {
    scopes: asScopes(perms.mcp),
    expeditions: Array.isArray(meta.expeditions) ? meta.expeditions : null,
  }
}

/** An OAuth grant's restriction to chosen Expeditions, or null (all). */
export async function grantExpeditions(
  db: Db,
  userId: string,
  clientId: string
): Promise<string[] | null> {
  const [row] = await db
    .select({ ids: agentGrants.expeditionIds })
    .from(agentGrants)
    .where(
      and(eq(agentGrants.userId, userId), eq(agentGrants.clientId, clientId))
    )
  return row?.ids ?? null
}

export async function listAgents(
  db: Db,
  userId: string
): Promise<AgentsOverview> {
  const keys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.referenceId, userId))
    .orderBy(desc(apiKeys.createdAt))
  const consents = await db
    .select({
      clientId: oauthConsents.clientId,
      scopes: oauthConsents.scopes,
      createdAt: oauthConsents.createdAt,
      name: oauthClients.name,
      uri: oauthClients.uri,
      icon: oauthClients.icon,
      expeditions: agentGrants.expeditionIds,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
    .leftJoin(
      agentGrants,
      and(
        eq(agentGrants.userId, oauthConsents.userId),
        eq(agentGrants.clientId, oauthConsents.clientId)
      )
    )
    .where(eq(oauthConsents.userId, userId))
    .orderBy(desc(oauthConsents.createdAt))
  return {
    tokens: keys.map((k) => ({
      id: k.id,
      name: k.name ?? "API token",
      start: k.start,
      ...tokenGrant(k),
      createdAt: iso(k.createdAt)!,
      lastUsedAt: iso(k.lastRequest),
      expiresAt: iso(k.expiresAt),
    })),
    grants: consents.map((g) => ({
      clientId: g.clientId,
      name: g.name ?? g.clientId,
      uri: g.uri,
      icon: g.icon,
      scopes: asScopes(g.scopes),
      expeditions: g.expeditions ?? null,
      createdAt: iso(g.createdAt),
    })),
    scopes: MCP_SCOPES.map((id) => ({ id, label: MCP_SCOPE_LABELS[id] })),
  }
}

/** Of `ids`, those the user collaborates on (and aren't in Trash). */
async function ownExpeditions(db: Db, userId: string, ids: string[]) {
  if (!ids.length) return []
  const rows = await db
    .select({ id: collaborators.expeditionId })
    .from(collaborators)
    .innerJoin(expeditions, eq(expeditions.id, collaborators.expeditionId))
    .where(
      and(
        eq(collaborators.userId, userId),
        inArray(collaborators.expeditionId, ids),
        isNull(expeditions.deletedAt)
      )
    )
  return rows.map((r) => r.id)
}

const Restriction = z
  .array(z.string().min(1))
  .max(200)
  .nullable()
  .describe("Expedition ids; null: every Expedition the user can see")

export const CreateTokenBody = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(McpScope).min(1),
  expeditions: Restriction.default(null),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
})

export const ConsentBody = z.object({
  clientId: z.string().min(1).max(2000),
  expeditions: Restriction,
})

export function agentRoutes() {
  const r = new Hono<AppEnv>()

  r.get("/", async (c) =>
    c.json(await listAgents(await c.var.db(), c.var.user.id))
  )

  r.post("/tokens", async (c) => {
    const body = CreateTokenBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const userId = c.var.user.id
    const { name, scopes, expiresInDays } = body.data
    let restricted: string[] | null = null
    if (body.data.expeditions) {
      const ids = [...new Set(body.data.expeditions)]
      restricted = await ownExpeditions(db, userId, ids)
      if (restricted.length !== ids.length)
        return c.json({ error: "Expedition not found" }, 404)
    }
    const auth = await c.var.auth()
    const made = await auth.api.createApiKey({
      body: {
        userId,
        name,
        permissions: { mcp: [...new Set(scopes)] },
        metadata: { expeditions: restricted },
        ...(expiresInDays && { expiresIn: expiresInDays * 24 * 60 * 60 }),
      },
    })
    const token: ApiToken = {
      id: made.id,
      name,
      start: made.start ?? null,
      scopes: asScopes(scopes),
      expeditions: restricted,
      createdAt: iso(made.createdAt)!,
      lastUsedAt: null,
      expiresAt: iso(made.expiresAt),
    }
    return c.json({ token, key: made.key }, 201)
  })

  r.delete("/tokens/:id", async (c) => {
    const db = await c.var.db()
    const gone = await db
      .delete(apiKeys)
      .where(
        and(
          eq(apiKeys.id, c.req.param("id")),
          eq(apiKeys.referenceId, c.var.user.id)
        )
      )
      .returning({ id: apiKeys.id })
    if (!gone.length) return c.json({ error: "not found" }, 404)
    return c.body(null, 204)
  })

  r.post("/consent", async (c) => {
    const body = ConsentBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const userId = c.var.user.id
    let ids: string[] | null = null
    if (body.data.expeditions) {
      const asked = [...new Set(body.data.expeditions)]
      ids = await ownExpeditions(db, userId, asked)
      if (ids.length !== asked.length)
        return c.json({ error: "Expedition not found" }, 404)
    }
    const now = new Date()
    await db
      .insert(agentGrants)
      .values({
        userId,
        clientId: body.data.clientId,
        expeditionIds: ids,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [agentGrants.userId, agentGrants.clientId],
        set: { expeditionIds: ids, updatedAt: now },
      })
    return c.body(null, 204)
  })

  r.delete("/grants/:clientId", async (c) => {
    const db = await c.var.db()
    const userId = c.var.user.id
    const clientId = c.req.param("clientId")
    await db.transaction(async (tx) => {
      const mine = (t: typeof oauthAccessTokens | typeof oauthRefreshTokens) =>
        and(eq(t.userId, userId), eq(t.clientId, clientId))
      await tx.delete(oauthAccessTokens).where(mine(oauthAccessTokens))
      await tx.delete(oauthRefreshTokens).where(mine(oauthRefreshTokens))
      await tx
        .delete(oauthConsents)
        .where(
          and(
            eq(oauthConsents.userId, userId),
            eq(oauthConsents.clientId, clientId)
          )
        )
      await tx
        .delete(agentGrants)
        .where(
          and(
            eq(agentGrants.userId, userId),
            eq(agentGrants.clientId, clientId)
          )
        )
    })
    return c.body(null, 204)
  })

  return r
}
