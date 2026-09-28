import { expect, test } from "@playwright/test"

// Each project sets colorScheme; the ThemeProvider defaults to "system",
// so the root element should carry the matching theme class.
test("the app renders in the system theme", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))

  await page.goto("/")

  // React mounted something into #root (the screen itself is other WPs' job).
  await expect(page.locator("#root")).not.toBeEmpty()

  const scheme = testInfo.project.use.colorScheme
  expect(scheme === "light" || scheme === "dark").toBe(true)
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`))

  expect(errors).toEqual([])
})
