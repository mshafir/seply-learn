import { expect, test } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-3.3: Settings → AI in bring-your-own-key mode (the e2e Worker runs with
// AI_KEY_MODE=byok and a test-only master key; playwright.config.ts). A key
// is saved, shown only by its last 4 characters (never sent back by the API),
// tested, and deleted; the per-ask spending cap is kept. Light and dark.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

// Not a real key: the provider refuses it when tested.
const KEY = "sk-ant-e2e-not-a-real-key-7Qz4"

test("add, test and delete an API key; set the per-ask cap", async ({ page }, testInfo) => {
  await signUp(page)

  // Every API response the page reads, to check the key never comes back.
  const bodies: string[] = []
  page.on("response", async (res) => {
    if (res.url().includes("/api/") && res.request().method() !== "OPTIONS")
      bodies.push(await res.text().catch(() => ""))
  })

  await page.goto("/")
  await page.getByRole("button", { name: "Account" }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await expect(page).toHaveURL(/\/settings$/)

  const ai = page.getByTestId("ai-settings")
  await expect(ai.getByText("This instance uses your own API keys")).toBeVisible()
  await expect(ai.getByText("Add a key to build Expeditions")).toBeVisible()

  const anthropic = page.getByTestId("key-anthropic")
  await anthropic.getByLabel("Anthropic").fill(KEY)
  await anthropic.getByRole("button", { name: "Save" }).click()
  await expect(page.getByTestId("key-anthropic-last4")).toHaveText("••••7Qz4")
  await expect(anthropic.getByLabel("Anthropic")).toHaveCount(0)
  await expect(ai.getByText("Add a key to build Expeditions")).toHaveCount(0)
  await screenshot(page, testInfo, "settings-ai-key")

  // Kept across a reload, still only the last 4.
  await page.reload()
  await expect(page.getByTestId("key-anthropic-last4")).toHaveText("••••7Qz4")

  // Test: the server calls the provider with the key; this one is refused.
  await anthropic.getByRole("button", { name: "Test" }).click()
  await expect(
    page.getByText(/Anthropic: (The provider refused this key|Couldn't reach the provider)/)
  ).toBeVisible()

  // Advanced: the model per stage, defaults as placeholders.
  await ai.getByRole("button", { name: "Advanced" }).click()
  await expect(ai.getByLabel("Curator")).toHaveAttribute("placeholder", "claude-opus-5-5")

  // The per-ask cap.
  const cap = ai.getByLabel("Spending cap per ask")
  await expect(cap).toHaveValue("0.50")
  await cap.fill("1.25")
  await cap.press("Enter")
  await expect(page.getByText("Spending cap saved.")).toBeVisible()
  await page.reload()
  await expect(ai.getByLabel("Spending cap per ask")).toHaveValue("1.25")

  await anthropic.getByRole("button", { name: "Delete" }).click()
  await expect(anthropic.getByLabel("Anthropic")).toBeVisible()
  await expect(page.getByTestId("key-anthropic-last4")).toHaveCount(0)

  // The key went up once, in the save request, and never came back down.
  expect(bodies.length).toBeGreaterThan(3)
  for (const body of bodies) expect(body).not.toContain(KEY)
  expect(bodies.join("\n")).not.toContain("e2e-not-a-real")
})
