import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from "@playwright/test"

import { needsDatabase, screenshot } from "./helpers.ts"

// WP-7.3, then open sign-up: hosted access approval (spec §2.6, §3.12) only
// decides who may use this server's AI. The suite's own server runs with the
// flag off (self-host), so this file starts a second one, the Node entry on
// the same database and the same web build, the way the hosted instance runs:
// ACCESS_APPROVAL=1, an admin, AI_KEY_MODE=both (readers' own keys, else the
// server's for approved accounts) and a server key that is never called. An
// account that isn't approved creates an Expedition like anyone, finds "add
// your own key, ask, or use MCP" where the AI is needed, and asks with a
// note; the admin approves it from Settings › Access requests; Settings then
// says the server's AI is on for it. Light and dark.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")
test.describe.configure({ mode: "serial" })

const PORT = Number(process.env.E2E_APPROVAL_PORT ?? 8790)
const BASE = `http://localhost:${PORT}`
const ADMIN = `e2e-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

const CHAT = `User: Why does sourdough rise?
Assistant: Wild yeast in the starter eats the flour's sugars and makes gas.
User: And why is it sour?
Assistant: Lactic acid bacteria in the starter make acids as they feed.`

const NO_AI_LINE =
  "Add your own AI key in Settings, ask to use this server's AI, or use your own agent over MCP."

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
      AI_KEY_MODE: "both",
      AI_KEYS_MASTER_KEY: "ZTJlLW9ubHktbWFzdGVyLWtleS0zMi1ieXRlcy1sb24=",
      // The server's own AI: an endpoint nothing listens on. No test here
      // runs AI work on it; it only has to be set up.
      OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:9/v1",
      AI_MODEL_SKIM: "e2e-model",
      AI_MODEL_CURATOR: "e2e-model",
      AI_MODEL_WRITER: "e2e-model",
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
    `e2e-unapproved-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
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

test("an unapproved account creates, asks to use the server's AI, and is approved", async ({
  browser,
}, testInfo) => {
  const reader = await signedIn(browser, "Wren Reader")
  const admin = await signedIn(browser, "Ada Admin", ADMIN)
  try {
    const page = reader.page
    expect((await me(page.request)).access).toMatchObject({
      approved: false,
      admin: false,
    })

    // The Library: no waiting list. New creates a draft at once.
    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "Your Expeditions" })
    ).toBeVisible()
    await expect(page.getByTestId("waiting-list-banner")).toHaveCount(0)
    await page
      .getByRole("banner")
      .getByRole("button", { name: "New", exact: true })
      .click()
    await expect(page).toHaveURL(/\/new\/[0-9A-Z]{26}$/)
    const id = /\/new\/([0-9A-Z]{26})/.exec(page.url())![1]!

    // A Source goes in; the estimate says where AI can come from.
    await page.getByLabel("Just paste in an AI chat").fill(CHAT)
    await page.getByRole("button", { name: "Add this chat" }).click()
    await expect(page.getByTestId("source-list")).toContainText("Pasted chat")
    const unavailable = page.getByTestId("estimate-unavailable")
    await expect(unavailable).toContainText("No AI to build with yet")
    await expect(unavailable).toContainText(NO_AI_LINE)
    await expect(
      unavailable.getByRole("link", { name: "MCP" })
    ).toHaveAttribute("href", "/connect")
    await screenshot(page, testInfo, "create-no-server-ai")

    // Choosing Views needs the AI too: the same line, not a failure.
    await page.getByRole("button", { name: "Next: choose Views" }).click()
    await expect(page).toHaveURL(new RegExp(`/new/${id}/views$`))
    await expect(page.getByText("No AI to propose Views with yet")).toBeVisible()
    await expect(page.getByTestId("no-server-ai")).toHaveText(NO_AI_LINE)

    // Ask, with a note, from the line.
    await page
      .getByTestId("no-server-ai")
      .getByRole("button", { name: "ask to use this server's AI" })
      .click()
    const dialog = page.getByTestId("server-ai-dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      "An admin turns on this server's AI for each account."
    )
    await dialog
      .getByRole("button", { name: "Ask to use this server's AI" })
      .click()
    await dialog
      .getByLabel("A note for the admins (optional)")
      .fill("For my reading group")
    await screenshot(page, testInfo, "server-ai-dialog")
    await dialog.getByRole("button", { name: "Send request" }).click()
    await expect(dialog.getByTestId("request-sent")).toContainText(
      /^Request sent on .+\./
    )
    await page.keyboard.press("Escape")

    // Settings › AI: own keys can be added; the server's AI isn't on yet,
    // and the request is remembered.
    await page.goto("/settings")
    const ai = page.getByTestId("ai-settings")
    await expect(ai).toContainText("Your own key is used first.")
    await expect(page.getByTestId("key-anthropic")).toBeVisible()
    const serverAi = page.getByTestId("server-ai")
    await expect(serverAi).toContainText(
      "This server's AI isn't on for your account."
    )
    await expect(serverAi.getByTestId("request-sent")).toBeVisible()
    await screenshot(page, testInfo, "settings-server-ai-off")

    // The admin: Settings › Access requests, pending first.
    const a = admin.page
    await a.goto("/settings")
    await a.getByRole("link", { name: "Access requests" }).click()
    await expect(a).toHaveURL(/\/settings\/access-requests$/)
    const request = a
      .getByTestId("access-request")
      .filter({ hasText: reader.email })
    await expect(request).toContainText("Wren Reader")
    await expect(request).toContainText("For my reading group")
    await screenshot(a, testInfo, "access-requests")
    await request.getByRole("button", { name: "Approve Wren Reader" }).click()
    await expect(a.getByText("Approved Wren Reader")).toBeVisible()
    await expect(request).toHaveCount(0)
    await a.getByRole("tab", { name: /Approved/ }).click()
    await expect(a.getByTestId("approved-accounts")).toContainText(reader.email)

    // Approved: the server's AI is on for the account.
    await page.reload()
    await expect(page.getByTestId("server-ai")).toHaveText(
      "This server's AI is on for your account."
    )
    expect((await me(page.request)).access.approved).toBe(true)
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
