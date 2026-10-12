import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test"

import { needsDatabase, screenshot } from "./helpers.ts"

// WP-7.3: hosted access approval (spec §2.6, §3.12). The suite's own server
// runs with the flag off (self-host), so this file starts a second one, the
// Node entry on the same database and the same web build, with
// ACCESS_APPROVAL=1 and an admin, and stops it afterwards. An unapproved
// account sees the waiting-list banner, finds New explaining instead of
// failing, and sends a request with a note; the admin approves it from
// Settings › Access requests; the account can then create. Light and dark.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")
test.describe.configure({ mode: "serial" })

const PORT = Number(process.env.E2E_APPROVAL_PORT ?? 8790)
const BASE = `http://localhost:${PORT}`
const ADMIN = `e2e-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

let server: ChildProcess | undefined

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/api/health`)).ok
  } catch {
    return false
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  expect(await healthy(), `something already serves ${BASE}`).toBe(false)
  server = spawn("pnpm", ["--filter", "@seply/server-node", "start"], {
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      PORT: String(PORT),
      HOST: "127.0.0.1",
      BETTER_AUTH_URL: BASE,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else",
      AUTH_TEST_CREDENTIALS: "1",
      DB_BRANCH: "e2e-approval",
      AI_KEY_MODE: "byok",
      AI_KEYS_MASTER_KEY: "ZTJlLW9ubHktbWFzdGVyLWtleS0zMi1ieXRlcy1sb24=",
      BLOB_DIR: mkdtempSync(join(tmpdir(), "seply-e2e-approval-blobs-")),
      SHUTDOWN_GRACE_SECONDS: "2",
      ACCESS_APPROVAL: "1",
      ADMIN_EMAILS: ADMIN,
    },
  })
  const until = Date.now() + 90_000
  while (!(await healthy())) {
    if (Date.now() > until) throw new Error(`${BASE} didn't start`)
    if (server.exitCode !== null)
      throw new Error(`the approval server exited (${server.exitCode})`)
    await new Promise((r) => setTimeout(r, 500))
  }
})

test.afterAll(async () => {
  if (!server?.pid) return
  // pnpm and the node process under it: the whole group.
  try {
    process.kill(-server.pid, "SIGTERM")
  } catch {
    // Gone already.
  }
  const until = Date.now() + 10_000
  while ((await healthy()) && Date.now() < until)
    await new Promise((r) => setTimeout(r, 200))
})

/** A fresh page on the approval server, signed in as a new account. */
async function signedIn(browser: Browser, name: string, email?: string) {
  const context = await browser.newContext({ baseURL: BASE })
  const page = await context.newPage()
  const address =
    email ??
    `e2e-waiting-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { email: address, password: "e2e password, long enough", name },
  })
  expect(res.status()).toBe(200)
  return { page, email: address, close: () => context.close() }
}

async function me(request: APIRequestContext) {
  return (await (await request.get("/api/me")).json()) as {
    access: { approved: boolean; admin: boolean }
  }
}

async function openNew(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "New" }).click()
}

test("waiting list, request access, admin approves, then create", async ({
  browser,
}, testInfo) => {
  const reader = await signedIn(browser, "Wren Waiting")
  const admin = await signedIn(browser, "Ada Admin", ADMIN)
  try {
    const page = reader.page
    expect((await me(page.request)).access).toMatchObject({
      approved: false,
      admin: false,
    })

    // The Library: a calm banner, the spec's words, Request access.
    await page.goto("/")
    const banner = page.getByTestId("waiting-list-banner")
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(
      "Your account is on the waiting list. You can read anything shared with you now, and you can create your own Expeditions once you're approved."
    )
    await screenshot(page, testInfo, "waiting-list-banner")

    // New explains instead of failing.
    await openNew(page)
    const dialog = page.getByTestId("waiting-list-dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("Your account is on the waiting list.")
    await screenshot(page, testInfo, "waiting-list-dialog")
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(`${BASE}/`)

    // Request access, with a note.
    await banner.getByRole("button", { name: "Request access" }).click()
    await banner
      .getByLabel("A note for the admins (optional)")
      .fill("For my reading group")
    await banner.getByRole("button", { name: "Send request" }).click()
    await expect(banner.getByTestId("request-sent")).toContainText(
      /^Request sent on .+\./
    )
    // Kept across a reload.
    await page.reload()
    await expect(page.getByTestId("request-sent")).toBeVisible()

    // The admin: Settings › Access requests, pending first.
    const a = admin.page
    await a.goto("/settings")
    await a.getByRole("link", { name: "Access requests" }).click()
    await expect(a).toHaveURL(/\/settings\/access-requests$/)
    const request = a
      .getByTestId("access-request")
      .filter({ hasText: reader.email })
    await expect(request).toContainText("Wren Waiting")
    await expect(request).toContainText("For my reading group")
    await screenshot(a, testInfo, "access-requests")
    await request.getByRole("button", { name: "Approve Wren Waiting" }).click()
    await expect(a.getByText("Approved Wren Waiting")).toBeVisible()
    await expect(request).toHaveCount(0)
    await a.getByRole("tab", { name: /Approved/ }).click()
    await expect(a.getByTestId("approved-accounts")).toContainText(reader.email)

    // Approved: no banner, and New creates.
    await page.reload()
    await expect(page.getByRole("heading", { name: "Your Expeditions" })).toBeVisible()
    await expect(page.getByTestId("waiting-list-banner")).toHaveCount(0)
    await openNew(page)
    await expect(page).toHaveURL(/\/new\/[0-9A-Z]+/)
  } finally {
    await reader.close()
    await admin.close()
  }
})

test("Settings shows no Admin section to an account that isn't an admin", async ({
  browser,
}) => {
  const reader = await signedIn(browser, "Nell Notadmin")
  try {
    await reader.page.goto("/settings")
    await expect(
      reader.page.getByRole("heading", { name: "Settings" })
    ).toBeVisible()
    await expect(
      reader.page.getByRole("link", { name: "Access requests" })
    ).toHaveCount(0)
    expect(
      (await reader.page.request.get("/api/admin/access-requests")).status()
    ).toBe(403)
  } finally {
    await reader.close()
  }
})
