import { fileURLToPath } from "node:url"
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import pg from "pg"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-2.5: Reading status and Continue reading. A reader marks a Concept read
// in one browser context and sees it in another (after a refresh), lands where
// they left off, and finds it under Continue reading. An anonymous reader of
// an unlisted Expedition (a link) marks a Concept, signs in, and keeps the
// mark. Unlisted, not public, so it never shows in other tests' searches.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)
const PASSWORD = "e2e password, long enough"
const GQA = "Grouped-Query Attention (GQA)"

type ReaderState = {
  reading: { conceptId: string; state: string }[]
  position: { viewId: string | null; focusConceptId: string | null } | null
}

/** Imports the compute fixture as the signed-in user; returns its id. */
async function importCompute(page: Page): Promise<string> {
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  const toast = page.getByRole("dialog", { name: /^Imported/ })
  await toast.locator("[data-slot=toast-close]").click()
  return new URL(page.url()).pathname.split("/")[2]!
}

/** Opens GQA from the Techniques table. */
async function openGqa(page: Page) {
  await page
    .getByTestId("views-rail")
    .getByRole("button", { name: /Techniques/ })
    .click()
  await page
    .getByTestId("canvas-pane")
    .getByRole("rowheader", { name: GQA })
    .click()
  await expect(page.getByTestId("panel-title")).toHaveText(GQA)
}

const statusControl = (page: Page) => page.getByTestId("reading-status")
const statusButton = (page: Page, name: string) =>
  statusControl(page).getByRole("button", { name, exact: true })
const gqaRow = (page: Page) =>
  page.getByTestId("canvas-pane").locator("tr", {
    has: page.getByRole("rowheader", { name: GQA }),
  })

/** The signed-in reader's state on the server, fetched from inside the page. */
async function serverState(page: Page, exp: string): Promise<ReaderState> {
  return page.evaluate(async (exp) => {
    const res = await fetch(`/api/reader/expeditions/${exp}`)
    return res.json()
  }, exp)
}

async function freshContext(browser: Browser): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  return [context, page]
}

test("mark read on one device, see it on another; Continue reading lands where you left off", async ({
  browser,
}, testInfo) => {
  const [ctxA, a] = await freshContext(browser)
  const { email } = await signUp(a, "Reader A")
  const exp = await importCompute(a)
  await openGqa(a)

  // Not read yet, then Read: the table row gets its check at once.
  await expect(statusButton(a, "Not read yet")).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await statusButton(a, "Read").click()
  await expect(statusButton(a, "Read")).toHaveAttribute("aria-pressed", "true")
  await expect(gqaRow(a)).toHaveAttribute("data-covered", "true")
  await expect(gqaRow(a).getByTestId("read-check")).toBeVisible()
  await screenshot(a, testInfo, "reading-status-read")

  // Saved on the server: the mark, and the position (Techniques, GQA open).
  await expect
    .poll(async () => {
      const st = await serverState(a, exp)
      return {
        gqa: st.reading.map((r) => r.state),
        focus: !!st.position?.focusConceptId,
      }
    })
    .toEqual({ gqa: ["read"], focus: true })
  const techniques = new URL(a.url()).pathname.split("/")[3]

  // Another device: the same reader signs in in a new context.
  const [ctxB, b] = await freshContext(browser)
  const signIn = await b.request.post("/api/auth/sign-in/email", {
    data: { email, password: PASSWORD },
  })
  expect(signIn.status()).toBe(200)

  // The Library lists it under Continue reading; opening it lands on the
  // Techniques table with GQA open, marked Read.
  await b.goto("/")
  const continueList = b.getByTestId("continue-reading")
  await expect(continueList.getByRole("listitem")).toHaveCount(1)
  await continueList.getByRole("link").click()
  await expect(b).toHaveURL(new RegExp(`/e/${exp}/${techniques}$`))
  await expect(b.getByTestId("resumed")).toContainText(
    "Continuing where you left off"
  )
  await expect(b.getByTestId("panel-title")).toHaveText(GQA)
  await expect(statusButton(b, "Read")).toHaveAttribute("aria-pressed", "true")
  await expect(gqaRow(b)).toHaveAttribute("data-covered", "true")
  await screenshot(b, testInfo, "reading-status-other-device")

  // B says "I knew this"; A sees it after a refresh.
  await statusButton(b, "I knew this").click()
  await expect
    .poll(async () => (await serverState(b, exp)).reading.map((r) => r.state))
    .toEqual(["known"])
  await a.reload()
  await openGqa(a)
  await expect(statusButton(a, "I knew this")).toHaveAttribute(
    "aria-pressed",
    "true"
  )

  // Back to the start: the best View, nothing open.
  await b.getByRole("button", { name: "Back to the start" }).click()
  await expect(b.getByTestId("resumed")).toHaveCount(0)
  await expect(b.getByTestId("side-panel")).toHaveCount(0)

  // The Learning path checks GQA; "Hide what I've read" (a personal setting,
  // saved for this reader) takes it off the canvas.
  const gqaId = (await serverState(b, exp)).reading[0]!.conceptId
  await b
    .getByTestId("views-rail")
    .getByRole("button", { name: /Learning path/ })
    .click()
  const gqaNode = b
    .getByTestId("canvas-pane")
    .locator(`.react-flow__node [data-concept="${gqaId}"]`)
  await expect(gqaNode).toHaveAttribute("data-covered", "true")
  await expect(gqaNode.getByTestId("read-check")).toBeVisible()
  await b.getByTestId("view-button").click()
  const settings = b.getByTestId("personal-settings")
  await settings.getByRole("switch", { name: "Hide what I've read" }).click()
  await expect(gqaNode).toHaveCount(0)
  await screenshot(b, testInfo, "reading-status-hide-read")
  await expect
    .poll(async () => {
      const st = (await serverState(b, exp)) as ReaderState & {
        viewSettings: { settings: Record<string, unknown> }[]
      }
      return st.viewSettings.map((v) => v.settings)
    })
    .toEqual([{ hideRead: true }])

  await ctxA.close()
  await ctxB.close()
})

test("an anonymous reader's marks are kept when they sign in", async ({
  browser,
}, testInfo) => {
  // An owner shares the compute sample by link. There's no Visibility UI yet
  // (WP-5.2), so the test sets it directly.
  const [ownerCtx, owner] = await freshContext(browser)
  await signUp(owner, "Owner")
  const exp = await importCompute(owner)
  await ownerCtx.close()
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    await db.query(
      "update expeditions set visibility = 'unlisted' where id = $1",
      [exp]
    )
  } finally {
    await db.end()
  }

  // Signed out, the unlisted Expedition opens read-only from its link.
  const [ctx, page] = await freshContext(browser)
  await page.goto(`/e/${exp}`)
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible()
  await openGqa(page)
  await statusButton(page, "Read").click()
  await expect(gqaRow(page)).toHaveAttribute("data-covered", "true")
  await expect(page.getByTestId("sign-in-hint")).toContainText(
    "to keep your progress across devices"
  )
  await screenshot(page, testInfo, "reading-status-anonymous")

  // Still there after a reload: it lives in this browser.
  await page.reload()
  await openGqa(page)
  await expect(statusButton(page, "Read")).toHaveAttribute(
    "aria-pressed",
    "true"
  )

  // Sign in (a new account): the mark moves into the account.
  await signUp(page, "Anonymous Reader")
  await page.reload()
  await expect
    .poll(async () =>
      (await serverState(page, exp)).reading.map((r) => r.state)
    )
    .toEqual(["read"])
  await openGqa(page)
  await expect(statusButton(page, "Read")).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await expect(gqaRow(page)).toHaveAttribute("data-covered", "true")
  await expect(page.getByTestId("sign-in-hint")).toHaveCount(0)
  await ctx.close()
})
