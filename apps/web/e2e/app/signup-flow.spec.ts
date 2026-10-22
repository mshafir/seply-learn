import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

import {
  signedInOn,
  startBothModeServer,
  type BothModeServer,
} from "./both-mode-server.ts"
import { needsDatabase, screenshot } from "./helpers.ts"

// The sign-up flow (spec §3.1–§3.3), on a server set up the way the hosted
// one is (AI_KEY_MODE=both, access approval on, a server key that is never
// called): sign in or create an account (email and password through the
// form; a wrong password is refused), the welcome step (connect your agent)
// once per account, the first time it opens the Library (a link to
// an Expedition goes there first), then the Library's first visit (no AI yet:
// connect, add a key, or ask to use this server's AI; "Start by reading
// one") and New Expedition with no AI ("Building needs AI. Choose how.",
// with the request built from the question).
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")
test.describe.configure({ mode: "serial" })

const PORT = Number(process.env.E2E_SIGNUP_PORT ?? 8791)
const BASE = `http://localhost:${PORT}`
const PASSWORD = "e2e password, long enough"
const QUESTION =
  "How do heat pumps work, and when are they cheaper to run than a gas boiler?"

const TRIP = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../../packages/domain/fixtures/trip.json", import.meta.url)
    ),
    "utf8"
  )
) as Record<string, unknown>

let server: BothModeServer | undefined

test.beforeAll(async () => {
  test.setTimeout(120_000)
  server = await startBothModeServer({ port: PORT, branch: "e2e-signup" })
})

test.afterAll(async () => {
  await server?.stop()
})

const newEmail = () =>
  `e2e-signup-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

async function signInWithEmail(page: Page, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

test("a new account sees the welcome step once; Skip lands on the Library", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
    colorScheme: testInfo.project.use.colorScheme,
  })
  const page = await context.newPage()
  try {
    // Sign in: the brand panel beside one card for both.
    await page.goto("/sign-in")
    await expect(
      page.getByRole("heading", {
        name: "Turn questions into something you can read and come back to.",
      })
    ).toBeVisible()
    await expect(page.getByText("Sign in or create an account")).toBeVisible()
    await expect(
      page.getByText(
        "New here? Next you connect the AI agent you already use, or skip it and read first."
      )
    ).toBeVisible()
    await expect(
      page.getByRole("link", {
        name: "Explore public Expeditions without signing in",
      })
    ).toHaveAttribute("href", "/explore")
    await screenshot(page, testInfo, "signup-sign-in")

    // At phone width it stacks: a shorter brand panel above the card.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(
      page.getByText(
        "Free to sign up. Build with the AI agent you already use, or your own API key."
      )
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390)
    await screenshot(page, testInfo, "signup-sign-in-phone")
    await page.setViewportSize({ width: 1280, height: 800 })

    // Make an account: it opens the Library, which sends it to the welcome
    // step first.
    const email = newEmail()
    await page.getByRole("button", { name: "Create an account" }).click()
    await page.getByLabel("Name", { exact: true }).fill("Ada Lovelace")
    await page.getByLabel("Email", { exact: true }).fill(email)
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
    const marked = page.waitForResponse("**/api/me/welcomed")
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/welcome$/)
    expect((await marked).status()).toBe(200)
    const welcome = page.getByTestId("welcome")
    await expect(welcome.getByText("Welcome, Ada")).toBeVisible()
    await expect(
      welcome.getByRole("heading", { name: "Connect your agent" })
    ).toBeVisible()
    await expect(
      welcome.getByRole("tab", { name: "Claude Code" })
    ).toHaveAttribute("aria-selected", "true")
    await expect(welcome.getByTestId("welcome-step-1")).toContainText(
      "Add Seply Learn to Claude Code"
    )
    await expect(
      welcome.getByLabel("prompt", { exact: true }).first()
    ).toHaveValue("Make a Seply Learn Expedition from this conversation.")
    await expect(page.getByTestId("connect-status")).toContainText(
      "Waiting for your agent's first call."
    )
    await screenshot(page, testInfo, "signup-welcome")

    // Skip for now: the Library.
    await welcome.getByRole("link", { name: "Skip for now" }).click()
    await expect(page).toHaveURL(`${BASE}/`)
    await expect(
      page.getByRole("heading", { name: "Your Expeditions" })
    ).toBeVisible()

    // A reload stays on the Library.
    await page.reload()
    await expect(
      page.getByRole("heading", { name: "Your Expeditions" })
    ).toBeVisible()
    await expect(page).toHaveURL(`${BASE}/`)

    // Signed out, a wrong password is refused; the right one goes straight
    // to the Library.
    await context.clearCookies()
    await page.goto("/sign-in")
    await page.getByLabel("Email", { exact: true }).fill(email)
    await page
      .getByLabel("Password", { exact: true })
      .fill("not the password at all")
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(page.getByRole("alert")).toHaveText(
      "That email and password don't match an account."
    )
    await expect(page).toHaveURL(/\/sign-in$/)
    await signInWithEmail(page, email)
    await expect(
      page.getByRole("heading", { name: "Your Expeditions" })
    ).toBeVisible()
    await expect(page).toHaveURL(`${BASE}/`)
    await expect(page.getByTestId("welcome")).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test("a new account that opens an Expedition link goes there; the welcome step waits for the Library", async ({
  browser,
}, testInfo) => {
  const author = await signedInOn(browser, BASE, "Pat Public")
  const reader = await signedInOn(browser, BASE, "Lin Linked", {
    colorScheme: testInfo.project.use.colorScheme ?? undefined,
    welcomed: false,
  })
  const res = await author.page.request.post("/api/import", {
    data: { ...TRIP, title: "A trip someone linked" },
  })
  expect(res.status()).toBe(201)
  const id = ((await res.json()) as { expedition: { id: string } }).expedition
    .id
  expect(
    (
      await author.page.request.patch(`/api/expeditions/${id}/visibility`, {
        data: { visibility: "public" },
      })
    ).status()
  ).toBe(200)
  try {
    const page = reader.page
    // The link opens the Expedition, not the welcome step.
    await page.goto(`/e/${id}`)
    await expect(page.getByTestId("views-bar")).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/e/${id}`))
    expect((await (await page.request.get("/api/me")).json()).welcomed).toBe(
      false
    )

    // The next visit to the Library shows it, once.
    const marked = page.waitForResponse("**/api/me/welcomed")
    await page.goto("/")
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(
      page.getByTestId("welcome").getByRole("heading", {
        name: "Connect your agent",
      })
    ).toBeVisible()
    expect((await marked).status()).toBe(200)
    await page
      .getByTestId("welcome")
      .getByRole("link", { name: "Go to my Library" })
      .click()
    await expect(page).toHaveURL(`${BASE}/`)
    await expect(
      page.getByRole("heading", { name: "Your Expeditions" })
    ).toBeVisible()
    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "Your Expeditions" })
    ).toBeVisible()
    await expect(page.getByTestId("welcome")).toHaveCount(0)
  } finally {
    await author.page.request.delete(`/api/expeditions/${id}`)
    await author.close()
    await reader.close()
  }
})

test("the Library's first visit: no AI yet, then a key hides the bar", async ({
  browser,
}, testInfo) => {
  const scheme = testInfo.project.use.colorScheme ?? undefined
  // Someone else's public Expedition, so there is one to start reading.
  const author = await signedInOn(browser, BASE, "Pat Public")
  const reader = await signedInOn(browser, BASE, "Wren Reader", {
    colorScheme: scheme,
  })
  const res = await author.page.request.post("/api/import", {
    data: { ...TRIP, title: "A trip to read first" },
  })
  expect(res.status()).toBe(201)
  const id = ((await res.json()) as { expedition: { id: string } }).expedition
    .id
  expect(
    (
      await author.page.request.patch(`/api/expeditions/${id}/visibility`, {
        data: { visibility: "public" },
      })
    ).status()
  ).toBe(200)
  try {
    const page = reader.page
    await page.goto("/")
    const bar = page.getByTestId("no-ai-bar")
    await expect(bar).toContainText("No AI connected yet")
    await expect(bar).toContainText(
      "You can read, edit and import now. To build Expeditions, connect your agent or add a key."
    )
    await expect(
      bar.getByRole("link", { name: "Connect your agent" })
    ).toHaveAttribute("href", "/connect")
    await expect(bar.getByRole("link", { name: "Add a key" })).toHaveAttribute(
      "href",
      "/settings#ai"
    )
    const ask = bar.getByRole("button", { name: "Ask to use this server's AI" })
    await expect(ask).toBeVisible()

    // An empty Library: New, Import, and public Expeditions to start with.
    await expect(page.getByText("No Expeditions yet")).toBeVisible()
    const start = page.getByTestId("start-reading")
    await expect(
      start.getByRole("heading", { name: "Start by reading one" })
    ).toBeVisible()
    const cards = start.getByTestId("expedition-card")
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeLessThanOrEqual(3)
    await expect(
      start.getByRole("link", { name: "See all public Expeditions" })
    ).toHaveAttribute("href", "/explore")
    await page.evaluate(() => window.scrollTo(0, 0))
    await screenshot(page, testInfo, "signup-library-first-visit")

    // Ask to use this server's AI: once asked, the bar says so.
    await ask.click()
    const dialog = page.getByTestId("server-ai-dialog")
    await dialog
      .getByRole("button", { name: "Ask to use this server's AI" })
      .click()
    await dialog.getByRole("button", { name: "Send request" }).click()
    await expect(dialog.getByTestId("request-sent")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(bar.getByTestId("server-ai-requested")).toContainText(
      "You asked to use this server's AI on"
    )

    // Add a key: Settings › AI. Back in the Library, the bar is gone.
    await bar.getByRole("link", { name: "Add a key" }).click()
    await expect(page).toHaveURL(/\/settings#ai$/)
    await page
      .locator("input#key-anthropic")
      .fill("sk-ant-e2e-not-a-real-key-signup")
    await page
      .getByTestId("key-anthropic")
      .getByRole("button", { name: "Save" })
      .click()
    await expect(page.getByTestId("key-anthropic-last4")).toBeVisible()
    await page.goto("/")
    await expect(
      page.getByRole("heading", { name: "Your Expeditions" })
    ).toBeVisible()
    await expect(page.getByTestId("start-reading")).toBeVisible()
    await expect(page.getByTestId("no-ai-bar")).toHaveCount(0)
  } finally {
    await author.page.request.delete(`/api/expeditions/${id}`)
    await author.close()
    await reader.close()
  }
})

test("New Expedition starts on A question, and with no AI says how to build", async ({
  browser,
}, testInfo) => {
  const reader = await signedInOn(browser, BASE, "Nell Newcomer", {
    colorScheme: testInfo.project.use.colorScheme ?? undefined,
  })
  try {
    const page = reader.page
    await page.goto("/")
    await page
      .getByRole("banner")
      .getByRole("button", { name: "New", exact: true })
      .click()
    await expect(page).toHaveURL(/\/new\/[0-9A-Z]{26}$/)

    // A question is the first tab, and the default.
    const tabs = page.getByRole("tab")
    await expect(tabs).toHaveText(["A question", "Paste a chat", "Files"])
    await expect(page.getByRole("tab", { name: "A question" })).toHaveAttribute(
      "aria-selected",
      "true"
    )

    // No AI: ask your agent (the request is built from the question) or add
    // a key; Choose Views stays off.
    await page.getByLabel("What do you want to understand?").fill(QUESTION)
    const panel = page.getByTestId("no-ai-panel")
    await expect(
      panel.getByRole("heading", { name: "Building needs AI. Choose how." })
    ).toBeVisible()
    await expect(panel).toContainText(
      "You have no API key here and this server's AI isn't on for your account."
    )
    await expect(panel.getByTestId("agent-request")).toHaveValue(
      `Make a Seply Learn Expedition about: ${QUESTION}`
    )
    await expect(panel.getByTestId("agent-status")).toContainText(
      "Your agent isn't connected yet."
    )
    await expect(
      panel.getByRole("link", { name: "Connect it" })
    ).toHaveAttribute("href", "/connect")
    await expect(
      panel.getByRole("link", { name: "Add an API key" })
    ).toHaveAttribute("href", "/settings#ai")
    await expect(
      panel.getByRole("button", { name: "Ask to use this server's AI" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Next: choose Views" })
    ).toBeDisabled()
    await screenshot(page, testInfo, "signup-create-no-ai")

    // The question goes in as a Source and stays in the draft.
    await page.getByRole("button", { name: "Add this question" }).click()
    await expect(page.getByTestId("source-list")).toContainText("heat pumps")
    await expect(
      page.getByText("Your Sources are saved as a draft.")
    ).toBeVisible()
    await expect(panel.getByTestId("agent-request")).toHaveValue(
      `Make a Seply Learn Expedition about: ${QUESTION}`
    )

    // From a chat: ask in that same chat.
    await page.getByRole("tab", { name: "Paste a chat" }).click()
    await expect(panel.getByTestId("agent-request")).toHaveValue(
      "Make a Seply Learn Expedition from this conversation."
    )
  } finally {
    await reader.close()
  }
})
