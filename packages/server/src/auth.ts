// Better Auth, built per request over that request's database connection
// (spec §2.6). Google is the hosted sign-in. Previews sign in through
// production with the OAuth proxy plugin, because Google allows no wildcard
// redirect URIs (docs/ops/deploy.md).
//
// MCP (spec §6.1, WP-5.4): Better Auth is also the OAuth 2.1 authorization
// server for MCP clients (`@better-auth/mcp`, with JWT access tokens bound to
// the `/mcp` resource). Clients register by Client ID Metadata Document
// (`@better-auth/cimd`) when the runtime supplies a safe metadata fetch;
// dynamic client registration stays off. Personal API tokens come from
// `@better-auth/api-key` and go on the same Bearer header.
import { apiKey } from "@better-auth/api-key"
import { cimd } from "@better-auth/cimd"
import { mcp } from "@better-auth/mcp"
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider"
import { MCP_SCOPES } from "@seply/ai"
import { schema } from "@seply/domain"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { betterAuth } from "better-auth/minimal"
import { jwt } from "better-auth/plugins/jwt"
import { oAuthProxy } from "better-auth/plugins/oauth-proxy"
import type { ServerConfig } from "./config.ts"
import type { Db } from "./db.ts"

export const AUTH_BASE_PATH = "/api/auth"

/** Where MCP clients connect: the protected resource their tokens are bound to. */
export const MCP_PATH = "/mcp"

/** The prefix of personal API tokens, so `/mcp` tells them from OAuth JWTs at a glance. */
export const API_TOKEN_PREFIX = "sl_"

/** The MCP resource (RFC 8707/9728) of this deploy: its origin plus `/mcp`. */
export const mcpResource = (config: ServerConfig) =>
  `${config.baseURL}${MCP_PATH}`

/** The OAuth issuer: Better Auth's base URL. */
export const authIssuer = (config: ServerConfig) =>
  `${config.baseURL}${AUTH_BASE_PATH}`

export type AuthOptions = {
  /**
   * The CIMD metadata fetch (spec §6.1). It must resolve a host once, refuse
   * private addresses and redirects; the runtime supplies one it can make
   * safe (`@better-auth/cimd/node` on Node, a no-redirect fetch on Workers,
   * where outbound fetches can't reach private addresses). Without it,
   * clients can't register, and agents use API tokens.
   */
  cimdFetch?: ClientMetadataResourceFetch
}

export function createAuth(
  config: ServerConfig,
  db: Db,
  opts: AuthOptions = {}
) {
  return betterAuth({
    baseURL: config.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        apiKeys: schema.apiKeys,
        jwks: schema.jwks,
        oauthClients: schema.oauthClients,
        oauthResources: schema.oauthResources,
        oauthClientResources: schema.oauthClientResources,
        oauthRefreshTokens: schema.oauthRefreshTokens,
        oauthAccessTokens: schema.oauthAccessTokens,
        oauthConsents: schema.oauthConsents,
        oauthClientAssertions: schema.oauthClientAssertions,
      },
    }),
    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            prompt: "select_account",
          },
        }
      : {},
    // Tests only: see ServerEnv.AUTH_TEST_CREDENTIALS and readConfig.
    emailAndPassword: { enabled: config.testCredentials },
    plugins: [
      ...(config.proxyURL
        ? [oAuthProxy({ productionURL: config.proxyURL })]
        : []),
      // Signs MCP access tokens only. usePlural adds the "s": the table is
      // `jwks`. No JWT on every session read (the app uses cookies), so the
      // app's sign-in never depends on the signing keys.
      jwt({
        schema: { jwks: { modelName: "jwk" } },
        disableSettingJwtHeader: true,
      }),
      mcp({
        resource: mcpResource(config),
        // The app's pages (apps/web): sign in, then the consent screen,
        // where the reader picks scopes and Expeditions.
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: [...MCP_SCOPES, "offline_access"],
      }),
      ...(opts.cimdFetch
        ? [
            cimd({
              fetchClientMetadataResource: opts.cimdFetch,
              metadataProfile: "mcp-2026-07-28",
            }),
          ]
        : []),
      apiKey({
        schema: { apikey: { modelName: "apiKey" } },
        defaultPrefix: API_TOKEN_PREFIX,
        enableMetadata: true,
        maximumNameLength: 60,
        // Agents call often; the user's role and our scopes are the limits.
        rateLimit: { enabled: false },
      }),
    ],
    telemetry: { enabled: false },
  })
}

export type Auth = ReturnType<typeof createAuth>
