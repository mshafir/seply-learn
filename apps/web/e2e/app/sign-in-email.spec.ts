import { expect, test } from "@playwright/test"

import { needsDatabase, screenshot } from "./helpers.ts"

// WP-6.1: email + password sign-in, where the server offers it (the Node
// entry by default; E2E_SERVER=node). Make an account from the sign-in
// screen, land in the Library, sign out, then a wrong password is refused and
// the right one signs in again. The Worker doesn't offer it, so there this
// spec skips. Runs in light and dark (app-light, app-dark).
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

test("make an account with email and password, then sign in with it", async ({
  page,
}, testInfo) => {
  const options = await (await page.request.get("/api/sign-in-options")).json()
  test.skip(
    !options.emailPassword,
    "this server has no email + password sign-in"
  )

  const email = `e2e-email-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const password = "e2e password, long enough"

  await page.goto("/")
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible()
  // Google is configured too (dummy credentials in playwright.config.ts).
  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible()
  await screenshot(page, testInfo, "sign-in-email")

  await page.getByRole("button", { name: "Create an account" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Email Reader")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
  const me = await (await page.request.get("/api/me")).json()
  expect(me.user).toMatchObject({ email, name: "Email Reader" })

  // Signed out, a wrong password is refused, the right one gets back in.
  await page.context().clearCookies()
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
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
  expect((await page.request.get("/api/me")).status()).toBe(200)
})
