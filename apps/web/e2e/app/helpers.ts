import { expect, type Page, type TestInfo } from "@playwright/test"

/**
 * Signs a fresh test account in (email + password: the CI-only test
 * credentials, on a localhost Worker with AUTH_TEST_CREDENTIALS=1). The page
 * shares the request context's cookies, so it is signed in too.
 */
export async function signUp(page: Page, name = "E2E Reader") {
  const email = `e2e-app-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { email, password: "e2e password, long enough", name },
  })
  expect(res.status()).toBe(200)
  return { email, name }
}

/** Needs the Worker and a migrated Postgres (see playwright.config.ts). */
export const needsDatabase = () =>
  !process.env.E2E_DATABASE_URL && !process.env.CI

/** A full-page screenshot, attached to the report and kept in test-results. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const theme = testInfo.project.use.colorScheme ?? "light"
  const path = testInfo.outputPath(`${name}-${theme}.png`)
  await page.screenshot({ path, animations: "disabled" })
  await testInfo.attach(`${name}-${theme}`, { path, contentType: "image/png" })
  return path
}

/** The rendered width of an element, in CSS px. */
export async function widthOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  expect(box, `${selector} is on screen`).not.toBeNull()
  return box!.width
}

/**
 * Opens a View from the Views bar: its tab, or the "more" menu when its tab
 * doesn't fit.
 */
export async function openView(page: Page, name: string | RegExp) {
  const bar = page.getByTestId("views-bar")
  await expect(bar).toBeVisible()
  const tab = bar.getByRole("button", { name })
  if (await tab.isVisible()) return tab.click()
  await bar.getByTestId("more-views").click()
  await page.getByRole("menuitem", { name }).click()
}

/** The side panel's width once it has finished sliding. */
export async function settledWidthOf(page: Page, selector: string) {
  let last = -1
  await expect
    .poll(async () => {
      const w = await widthOf(page, selector)
      const settled = Math.abs(w - last) < 0.5
      last = w
      return settled
    })
    .toBe(true)
  return last
}
