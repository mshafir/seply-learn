import { createHash, randomBytes } from "node:crypto"
import { expect, test } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-8.2: signing the desktop app in through the browser (spec §10.3). The
// browser's page asks, then hands the sign-in over as a seply:// link with a
// one-time token; the app's window trades the token and the app's verifier
// for a session of its own. Here a second browser context plays the app's
// window, and the shell's part (the verifier, the link) is covered by the
// desktop app's own tests. Light and dark.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

/** What the shell makes: a verifier it keeps, and the challenge it sends. */
function pkce() {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

test("the browser hands a sign-in to the app's window", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const { email } = await signUp(page)
  const { verifier, challenge } = pkce()

  // In the browser, signed in: it asks first.
  await page.goto(`/desktop/sign-in?challenge=${challenge}`)
  const card = page.getByTestId("desktop-sign-in")
  await expect(card).toContainText("Open Seply Learn?")
  await expect(card).toContainText(email)
  await screenshot(page, testInfo, "desktop-sign-in")

  // The seply:// link has nowhere to go in a test browser; the token is in
  // the answer it was made from.
  const answered = page.waitForResponse("**/api/auth/desktop/handoff")
  await card.getByRole("button", { name: "Open the app" }).click()
  const { token } = (await (await answered).json()) as { token: string }
  await expect(card).toContainText("You can close this tab.")

  // In the app's window (signed out until now): the token and the verifier
  // sign it in, and the Library opens.
  const app = await browser.newContext({ baseURL })
  const appPage = await app.newPage()
  await appPage.goto(`/desktop/complete#token=${token}&verifier=${verifier}`)
  await expect(appPage).toHaveURL(new RegExp(`^${baseURL}/$`))
  const me = await (await appPage.request.get("/api/me")).json()
  expect(me.user).toMatchObject({ email })

  // The link works once.
  const again = await browser.newContext({ baseURL })
  const againPage = await again.newPage()
  await againPage.goto(`/desktop/complete#token=${token}&verifier=${verifier}`)
  await expect(againPage.getByTestId("desktop-sign-in")).toContainText(
    "expired or was already used"
  )
  expect((await againPage.request.get("/api/me")).status()).toBe(401)

  // Signing the app out leaves the browser signed in.
  const out = await appPage.request.post("/api/auth/sign-out", {
    headers: { origin: baseURL! },
    data: {},
  })
  expect(out.status()).toBe(200)
  expect((await appPage.request.get("/api/me")).status()).toBe(401)
  expect((await page.request.get("/api/me")).status()).toBe(200)
  await app.close()
  await again.close()
})

test("signed out, the browser signs in first, then asks", async ({ page }) => {
  const { challenge } = pkce()
  await page.goto(`/desktop/sign-in?challenge=${challenge}`)
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdesktop%2Fsign-in/)
  // Sign in (the test account, by API), and the screen carries on to `next`.
  await signUp(page)
  await page.reload()
  await expect(page).toHaveURL(
    new RegExp(`/desktop/sign-in\\?challenge=${challenge}$`)
  )
  await expect(page.getByTestId("desktop-sign-in")).toContainText(
    "Open Seply Learn?"
  )
})

test("without the app's challenge there is nothing to hand over", async ({
  page,
}) => {
  await signUp(page)
  await page.goto("/desktop/sign-in?challenge=nope")
  const card = page.getByTestId("desktop-sign-in")
  await expect(card).toContainText("Start again from the app")
  await expect(card.getByRole("button")).toHaveCount(0)

  // In the app's window, a link with nothing in it signs nobody in.
  await page.context().clearCookies()
  await page.goto("/desktop/complete")
  await expect(page.getByTestId("desktop-sign-in")).toContainText(
    "Couldn't sign in"
  )
})

test("in the app, Google sign-in goes through the browser", async ({
  page,
}) => {
  const options = await (await page.request.get("/api/sign-in-options")).json()
  test.skip(!options.google, "this server has no Google sign-in")
  // The shell's bridge, as the page sees it.
  await page.addInitScript(() => {
    const calls: number[] = []
    Object.assign(window, {
      bridgeCalls: calls,
      seplyDesktop: {
        version: 1,
        signInWithBrowser: async () => void calls.push(Date.now()),
      },
    })
  })
  await page.goto("/sign-in")
  await page.getByRole("button", { name: "Continue with Google" }).click()
  await expect(page.getByRole("status")).toContainText(
    "Finish signing in in your browser"
  )
  // The window stayed where it was; the bridge was asked once.
  await expect(page).toHaveURL(/\/sign-in$/)
  expect(
    await page.evaluate(
      () => (window as unknown as { bridgeCalls: number[] }).bridgeCalls.length
    )
  ).toBe(1)
})
