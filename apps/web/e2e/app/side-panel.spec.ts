import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

import {
  needsDatabase,
  openView,
  screenshot,
  settledWidthOf,
  signUp,
} from "./helpers.ts"

// WP-1.7: the side panel reads a Concept. Sign in with the test credentials,
// import the compute fixture, open GQA from the Techniques table, follow an
// in-text `#c/` link (the panel navigates, not the page), go back, and see
// the provenance badges on the overview and on every article section. The
// fixture's content has no Source segments, so every badge reads
// "Background knowledge". Runs in light and dark (app-light, app-dark).
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)

test("read a Concept: overview, in-text link, back, article, provenance", async ({
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

  // Open GQA from the Techniques table.
  await openView(page, /Techniques/)
  const canvas = page.getByTestId("canvas-pane")
  await canvas
    .getByRole("rowheader", { name: "Grouped-Query Attention (GQA)" })
    .click()

  const panel = page.getByTestId("side-panel")
  const title = panel.getByTestId("panel-title")
  await expect(title).toHaveText("Grouped-Query Attention (GQA)")
  await expect(panel.getByTestId("panel-eyebrow")).toHaveText("Idea · 2023")
  await expect(panel.getByTestId("panel-back")).toHaveCount(0)
  const url = page.url()

  // The overview is rendered markdown (Typeset), not raw text.
  const overview = panel.getByTestId("overview")
  await expect(overview).toHaveClass(/typeset/)
  await expect(overview.locator("strong").first()).toHaveText(
    "Grouped-Query Attention (GQA)"
  )
  await expect(overview).not.toContainText("**")
  await expect(overview).not.toContainText("](#c/")

  // Tags, Attributes, and Relationships both ways in natural language.
  await expect(panel.getByRole("list", { name: "Tags" })).toContainText(
    "#technique"
  )
  const attributes = panel.locator("[data-slot=attribute-list]")
  await expect(attributes).toContainText("Maturity")
  await expect(attributes).toContainText("standard")
  const linksTo = panel.getByRole("region", { name: "Links to" })
  await expect(linksTo).toContainText("is needed to understand")
  await expect(
    linksTo.getByRole("link", { name: "Multi-head Latent Attention (MLA)" })
  ).toBeVisible()
  const linkedFrom = panel.getByRole("region", { name: "Linked from" })
  await expect(linkedFrom).toContainText("needs")
  await expect(linkedFrom).toContainText("is used by")
  await expect(linkedFrom).toContainText("came from")
  await expect(linkedFrom).toContainText("(a middle ground)")

  // Provenance of the overview.
  const overviewBadge = panel.getByTestId("provenance")
  await expect(overviewBadge).toHaveCount(1)
  await expect(overviewBadge).toHaveText("Background knowledge")
  await screenshot(page, testInfo, "panel-overview")
  await linkedFrom.scrollIntoViewIfNeeded()
  await screenshot(page, testInfo, "panel-relationships")

  // Follow an in-text link: the panel navigates, the page doesn't.
  await overview.getByRole("link", { name: "multi-head attention" }).click()
  await expect(title).toHaveText("Multi-head attention")
  expect(page.url()).toBe(url)
  await expect(panel.getByTestId("panel-back")).toHaveText(
    "Back to Grouped-Query Attention (GQA)"
  )
  await screenshot(page, testInfo, "panel-followed-link")

  // Back: GQA again, at the top of the stack.
  await panel.getByTestId("panel-back").click()
  await expect(title).toHaveText("Grouped-Query Attention (GQA)")
  await expect(panel.getByTestId("panel-back")).toHaveCount(0)

  // The article reads wider: the panel slides from 520 to 860 px.
  expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBe(520)
  await panel.getByRole("button", { name: /Read the full article/ }).click()
  expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBe(860)

  // The article: one provenance badge per section.
  await expect(panel.getByTestId("panel-eyebrow")).toHaveText(
    /^Article · \d+ min$/
  )
  const sections = panel.getByTestId("article-section")
  await expect(sections).toHaveCount(7)
  await expect(
    panel.getByRole("region", { name: "How it works" })
  ).toBeVisible()
  const badges = panel.getByTestId("provenance")
  await expect(badges).toHaveCount(7)
  for (const badge of await badges.all())
    await expect(badge).toHaveText("Background knowledge")
  // A table in a section renders as a table.
  await expect(panel.getByRole("table").first()).toBeVisible()
  await screenshot(page, testInfo, "panel-article")

  // A Relationship link from the article's back stack: back to the overview.
  await expect(panel.getByTestId("panel-back")).toHaveText("Back to overview")
  await panel.getByTestId("panel-back").click()
  await expect(panel.getByTestId("concept-overview")).toBeVisible()
  // Back to the overview: narrower again.
  expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBe(520)
  await linksTo
    .getByRole("link", { name: "Multi-head Latent Attention (MLA)" })
    .click()
  await expect(title).toHaveText(/Multi-head Latent Attention/)
  await panel.getByTestId("panel-back").click()
  await expect(title).toHaveText("Grouped-Query Attention (GQA)")

  expect(errors).toEqual([])
})
