// Test helpers: the app over an in-memory PGlite database with the committed
// migrations applied, and a tiny cookie jar. Not exported from the package.
import { PGlite } from "@electric-sql/pglite"
import { schema } from "@umbel/domain"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { Hono } from "hono"
import { fileURLToPath } from "node:url"
import { createApp } from "./app.ts"
import type { ServerEnv } from "./config.ts"
import type { Db } from "./db.ts"

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

export async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema })
  await migrate(db, { migrationsFolder })
  return db as unknown as Db
}

/** The app mounted at /api, as the Worker mounts it, bound to `env`. */
export function testApp(env: ServerEnv, db: Db | null) {
  const root = new Hono()
  root.route(
    "/api",
    createApp({
      connect: async () => (db ? { db, close: async () => {} } : null),
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
