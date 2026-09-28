import { expect, test } from "@playwright/test"

// Each project sets colorScheme; the ThemeProvider defaults to "system".
// shadcn's convention: <html> gets .dark in dark mode and no theme class in light.
test("the app renders in the system theme", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))

  await page.goto("/")

  // React mounted something into #root (the screen itself is other WPs' job).
  await expect(page.locator("#root")).not.toBeEmpty()

  const scheme = testInfo.project.use.colorScheme
  expect(scheme === "light" || scheme === "dark").toBe(true)
  const html = page.locator("html")
  if (scheme === "dark") await expect(html).toHaveClass(/\bdark\b/)
  else await expect(html).not.toHaveClass(/\bdark\b/)

  expect(errors).toEqual([])
})
