import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

import { needsDatabase, screenshot, signUp, openView } from "./helpers.ts"

// WP-3.6: "Write the article", the Concept action (spec §3.7, §5.5). An
// editor opens a Concept with no article and asks for one. A dialog asks
// first: how long, at what cost; Cancel spends nothing. The e2e Worker runs
// in bring-your-own-key mode and this account has no key, so the dialog says
// so and won't write. With the estimate stubbed, choosing Short and "Write
// it" starts an `article` job (what it writes becomes a suggestion, never a
// direct edit); it fails before any model call, and the panel says why. A
// Concept that has an article offers no action.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)

test("Write the article: starts the ask, and says why it couldn't", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 900 })

  await signUp(page)
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  const toast = page.getByRole("dialog", { name: /^Imported/ })
  await toast.locator("[data-slot=toast-close]").click()

  await openView(page, /Techniques/)
  const canvas = page.getByTestId("canvas-pane")
  const panel = page.getByTestId("side-panel")

  // A Concept with an article: "Read the full article", no action.
  await canvas
    .getByRole("rowheader", { name: "Grouped-Query Attention (GQA)" })
    .click()
  await expect(
    panel.getByRole("button", { name: /Read the full article/ })
  ).toBeVisible()
  await expect(panel.getByTestId("write-article")).toHaveCount(0)

  // One without: the owner can ask for it.
  await canvas
    .getByRole("rowheader", { name: "Multi-Query Attention (MQA)" })
    .click()
  await expect(panel.getByTestId("panel-title")).toHaveText(
    "Multi-Query Attention (MQA)"
  )
  const action = panel.getByTestId("write-article")
  await expect(action).toHaveAttribute("data-state", "idle")
  await expect(action).toContainText("Suggested for review before it's added")
  await screenshot(page, testInfo, "write-article")

  // The dialog asks first. No key in this account: it says so, won't
  // write, and Cancel starts nothing.
  const jobPosts: string[] = []
  page.on("request", (r) => {
    if (
      /\/api\/expeditions\/[^/]+\/jobs$/.test(r.url()) &&
      r.method() === "POST"
    )
      jobPosts.push(r.url())
  })
  const writeButton = action.getByRole("button", { name: /Write the article/ })
  await writeButton.click()
  const dialog = page.getByTestId("write-article-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(
    "Write the article for Multi-Query Attention (MQA)"
  )
  await expect(dialog.getByRole("alert")).toContainText(
    "There's no AI key to write with yet."
  )
  await expect(
    dialog.getByRole("link", { name: "Add one in Settings" })
  ).toBeVisible()
  await expect(dialog.getByRole("button", { name: /^Write it/ })).toBeDisabled()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toHaveCount(0)
  expect(jobPosts).toEqual([])

  // With prices (stubbed here): each length shows its cost; Short, then
  // "Write it", starts the job with that length.
  await page.route("**/api/ai/estimate/article", (route) =>
    route.fulfill({
      json: {
        lengths: {
          short: {
            words: 300,
            usd: 0.04,
            model: "anthropic/claude-sonnet-5.5",
          },
          standard: {
            words: 600,
            usd: 0.07,
            model: "anthropic/claude-sonnet-5.5",
          },
          long: {
            words: 1200,
            usd: 0.13,
            model: "anthropic/claude-sonnet-5.5",
          },
        },
        sourceChars: 0,
        askCapUsd: 0.5,
      },
    })
  )
  await writeButton.click()
  await expect(dialog.getByTestId("article-cost")).toHaveText([
    "about $0.04",
    "about $0.07",
    "about $0.13",
  ])
  await dialog.getByTestId("article-length-short").click()
  await screenshot(page, testInfo, "write-article-dialog")
  const started = page.waitForResponse(
    (r) =>
      /\/api\/expeditions\/[^/]+\/jobs$/.test(r.url()) &&
      r.request().method() === "POST"
  )
  await dialog.getByRole("button", { name: "Write it · about $0.04" }).click()
  const res = await started
  expect(res.status()).toBe(201)
  const { job } = (await res.json()) as {
    job: { kind: string; input: { conceptId: string; length?: string } }
  }
  expect(job.kind).toBe("article")
  expect(job.input.length).toBe("short")

  // No key in this account: it fails before any model call, with a reason.
  await expect(action).toHaveAttribute("data-state", "failed", {
    timeout: 30_000,
  })
  await expect(action.getByRole("alert")).toHaveText(
    "No AI key: add one in Settings"
  )
  await expect(
    page.getByRole("dialog", { name: "Couldn't write the article" })
  ).toBeVisible()
  // An ask is not a build: no build activity in the header.
  await expect(page.getByTestId("build-activity")).toHaveCount(0)
  // Nothing was written: still no article.
  await expect(
    panel.getByRole("button", { name: /Read the full article/ })
  ).toHaveCount(0)
  await screenshot(page, testInfo, "write-article-failed")
  expect(errors).toEqual([])
})
