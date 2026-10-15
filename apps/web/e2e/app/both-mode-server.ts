import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type Browser } from "@playwright/test"

// A second server for the specs that need the hosted set-up, which the
// suite's own server (self-host, bring-your-own-key) doesn't have: the Node
// entry on the same database and the same web build, with ACCESS_APPROVAL=1,
// AI_KEY_MODE=both (readers' own keys, else the server's for approved
// accounts) and a server key that is never called. Email and password
// sign-in is on (the Node entry's default), so sign-up can go through the UI.

export type BothModeServer = {
  base: string
  stop: () => Promise<void>
}

async function healthy(base: string): Promise<boolean> {
  try {
    return (await fetch(`${base}/api/health`)).ok
  } catch {
    return false
  }
}

/** Starts the server on `port` and waits until it answers. */
export async function startBothModeServer(opts: {
  port: number
  /** DB_BRANCH: keeps this server's rooms apart from the others'. */
  branch: string
  /** Emails of the admins (Settings › Access requests). */
  admins?: string[]
}): Promise<BothModeServer> {
  const base = `http://localhost:${opts.port}`
  expect(await healthy(base), `something already serves ${base}`).toBe(false)
  const server: ChildProcess = spawn(
    "pnpm",
    ["--filter", "@seply/server-node", "start"],
    {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
        PORT: String(opts.port),
        HOST: "127.0.0.1",
        BETTER_AUTH_URL: base,
        BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else",
        AUTH_TEST_CREDENTIALS: "1",
        DB_BRANCH: opts.branch,
        AI_KEY_MODE: "both",
        AI_KEYS_MASTER_KEY: "ZTJlLW9ubHktbWFzdGVyLWtleS0zMi1ieXRlcy1sb24=",
        // The server's own AI: an endpoint nothing listens on. No test runs
        // AI work on it; it only has to be set up.
        OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:9/v1",
        AI_MODEL_SKIM: "e2e-model",
        AI_MODEL_CURATOR: "e2e-model",
        AI_MODEL_WRITER: "e2e-model",
        BLOB_DIR: mkdtempSync(join(tmpdir(), `seply-${opts.branch}-blobs-`)),
        SHUTDOWN_GRACE_SECONDS: "2",
        ACCESS_APPROVAL: "1",
        ADMIN_EMAILS: (opts.admins ?? []).join(","),
      },
    }
  )
  const until = Date.now() + 90_000
  while (!(await healthy(base))) {
    if (Date.now() > until) throw new Error(`${base} didn't start`)
    if (server.exitCode !== null)
      throw new Error(`the ${opts.branch} server exited (${server.exitCode})`)
    await new Promise((r) => setTimeout(r, 500))
  }
  return {
    base,
    async stop() {
      if (!server.pid) return
      // pnpm and the node process under it: the whole group.
      try {
        process.kill(-server.pid, "SIGTERM")
      } catch {
        // Gone already.
      }
      const end = Date.now() + 10_000
      while ((await healthy(base)) && Date.now() < end)
        await new Promise((r) => setTimeout(r, 200))
    },
  }
}

/** A fresh page on `base`, signed in as a new account (through the API). */
export async function signedInOn(
  browser: Browser,
  base: string,
  name: string,
  opts: { email?: string; colorScheme?: "light" | "dark" } = {}
) {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1280, height: 800 },
    colorScheme: opts.colorScheme,
  })
  const page = await context.newPage()
  const address =
    opts.email ??
    `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { email: address, password: "e2e password, long enough", name },
  })
  expect(res.status()).toBe(200)
  return { page, email: address, close: () => context.close() }
}
