// Test helpers: the app over an in-memory PGlite database with the committed
// migrations applied, and a tiny cookie jar. Not exported from the package.
import { PGlite } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { schema } from "@seply/domain"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { Hono } from "hono"
import { fileURLToPath } from "node:url"
import { createApp, type AppOptions } from "./app.ts"
import type { ServerEnv } from "./config.ts"
import type { Db } from "./db.ts"
import type { Relay } from "./relay.ts"

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

export async function testDb(): Promise<Db> {
  // pg_trgm is a contrib extension; migration 0001 (search) creates it.
  const db = drizzle(new PGlite({ extensions: { pg_trgm } }), { schema })
  await migrate(db, { migrationsFolder })
  return db as unknown as Db
}

/** The app mounted at /api, as the Worker mounts it, bound to `env`. */
export function testApp(
  env: ServerEnv,
  db: Db | null,
  relay?: Relay,
  extra: Omit<AppOptions<ServerEnv>, "connect" | "relay"> = {}
) {
  const root = new Hono()
  root.route(
    "/api",
    createApp({
      connect: async () => (db ? { db, close: async () => {} } : null),
      relay,
      ...extra,
    })
  )
  const request = (path: string, init: RequestInit = {}) =>
    root.request(path, init, env)
  return { request }
}

/** Keeps cookies from Set-Cookie headers, like a browser on one origin. */
export class Jar {
  private cookies = new Map<string, string>()
  take(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";")
      const i = pair!.indexOf("=")
      const name = pair!.slice(0, i).trim()
      const value = pair!.slice(i + 1)
      if (/max-age=0/i.test(line) || value === "") this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return res
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }
  get size() {
    return this.cookies.size
  }
}

export const TEST_ORIGIN = "http://localhost:8787"

/** Env with email + password sign-in on (localhost only). */
export const TEST_ENV: ServerEnv = {
  BETTER_AUTH_URL: TEST_ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!!",
  AUTH_TEST_CREDENTIALS: "1",
}

export type TestUser = { id: string; headers: Record<string, string> }

/** Signs a new user up (with TEST_ENV); returns their id and request headers. */
export async function signUp(
  app: ReturnType<typeof testApp>,
  name: string
): Promise<TestUser> {
  const jar = new Jar()
  jar.take(
    await app.request(`${TEST_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        email: `${name}@example.com`,
        password: "correct horse battery staple",
        name,
      }),
    })
  )
  const headers = {
    cookie: jar.header(),
    origin: TEST_ORIGIN,
    "content-type": "application/json",
  }
  const me = (await (await app.request("/api/me", { headers })).json()) as {
    user: { id: string }
  }
  return { id: me.user.id, headers }
}
