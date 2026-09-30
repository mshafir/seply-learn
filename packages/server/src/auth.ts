// Better Auth, built per request over that request's database connection
// (spec §2.6). Google is the hosted sign-in. Previews sign in through
// production with the OAuth proxy plugin, because Google allows no wildcard
// redirect URIs (docs/ops/deploy.md).
import { schema } from "@seply/domain"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { betterAuth } from "better-auth/minimal"
import { oAuthProxy } from "better-auth/plugins/oauth-proxy"
import type { ServerConfig } from "./config.ts"
import type { Db } from "./db.ts"

export const AUTH_BASE_PATH = "/api/auth"

export function createAuth(config: ServerConfig, db: Db) {
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
    plugins: config.proxyURL
      ? [oAuthProxy({ productionURL: config.proxyURL })]
      : [],
    telemetry: { enabled: false },
  })
}

export type Auth = ReturnType<typeof createAuth>
