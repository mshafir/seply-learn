import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

import { needsDatabase, screenshot, signUp, openView } from "./helpers.ts"

// WP-3.6: "Write the article", the Concept action (spec §3.7, §5.5). An
// editor opens a Concept with no article and asks for one: it starts an
// `article` job, and what it writes becomes a suggestion (a Proposal), never
// a direct edit. The e2e Worker runs in bring-your-own-key mode and this
// account has no key, so the job fails before any model call, and the panel
// says why. A Concept that has an article offers no action.
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

  const started = page.waitForResponse(
    (r) =>
      /\/api\/expeditions\/[^/]+\/jobs$/.test(r.url()) &&
      r.request().method() === "POST"
  )
  await action.getByRole("button", { name: /Write the article/ }).click()
  const res = await started
  expect(res.status()).toBe(201)
  const { job } = (await res.json()) as {
    job: { kind: string; input: { conceptId: string } }
  }
  expect(job.kind).toBe("article")

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
