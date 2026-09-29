import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-2.6: search. Sign in with the test credentials and import the compute
// fixture. From the Library, the command dialog finds a Concept by its title
// (server full-text over the maintained tsvector columns, on CI's Postgres),
// opens it in the side panel, and filters by #tag through the Tags group. A
// stranger never finds the private Expedition, public toggle or not. Inside
// the Expedition, the search box dims every Concept that doesn't match.
// Runs in light and dark (app-light, app-dark).
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)
const GQA = "Grouped-Query Attention (GQA)"

async function importCompute(page: Page) {
  await signUp(page)
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  const toast = page.getByRole("dialog", { name: /^Imported/ })
  await toast.locator("[data-slot=toast-close]").click()
  return page.url().split("/e/")[1]!
}

test("search from the Library: a Concept, a #tag, and access", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  const expeditionId = await importCompute(page)

  await page.goto("/")
  await page.getByTestId("global-search").click()
  const dialog = page.getByRole("dialog", { name: "Search" })
  const input = dialog.getByRole("combobox", { name: "Search" })
  await expect(input).toBeFocused()

  // Free text: grouped results, the Concept with its Expedition.
  await input.fill("grouped query attention")
  const concepts = dialog.getByRole("group", { name: "Concepts" })
  const gqa = concepts.getByRole("option", {
    name: new RegExp(`^${escape(GQA)}`),
  })
  await expect(gqa).toBeVisible()
  await expect(gqa).toContainText("AI compute & model internals")
  await screenshot(page, testInfo, "search-library")

  // #tag: the Tags group suggests by prefix; picking one filters by it.
  await input.fill("#techn")
  const tags = dialog.getByRole("group", { name: "Tags" })
  await tags.getByRole("option", { name: /technique/ }).click()
  await expect(input).toHaveValue("#technique ")
  await expect(concepts.getByRole("option").first()).toBeVisible()
  await input.fill("#technique grouped query")
  await expect(concepts.getByRole("option").first()).toContainText(GQA)
  await input.fill("#source grouped query")
  await expect(dialog.getByText("No results.")).toBeVisible()

  // The Expedition itself, by title.
  await input.fill("model internals")
  await expect(
    dialog
      .getByRole("group", { name: "Expeditions" })
      .getByRole("option", { name: /AI compute & model internals/ })
  ).toBeVisible()

  // Picking a Concept opens its Expedition with the Concept in the side panel.
  await input.fill("grouped query attention")
  await gqa.click()
  await expect(page).toHaveURL(new RegExp(`/e/${expeditionId}\\?concept=`))
  await expect(page.getByTestId("panel-title")).toHaveText(GQA)

  // A stranger never finds the private Expedition, even with public ones included.
  const stranger = await browser.newContext()
  const other = await stranger.newPage()
  await signUp(other, "Stranger")
  await other.goto("/")
  await other.getByTestId("global-search").click()
  const theirs = other.getByRole("dialog", { name: "Search" })
  await theirs
    .getByRole("switch", { name: "Include public Expeditions" })
    .click()
  await theirs
    .getByRole("combobox", { name: "Search" })
    .fill("grouped query attention")
  await expect(theirs.getByText("No results.")).toBeVisible()
  await expect(theirs.getByRole("option")).toHaveCount(0)
  await stranger.close()

  expect(errors).toEqual([])
})

test("search inside an Expedition highlights matches on the canvas", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await importCompute(page)

  await page
    .getByTestId("views-rail")
    .getByRole("button", { name: /Compute economics/ })
    .click()
  const canvas = page.getByTestId("canvas-pane")
  await expect(canvas).toHaveAttribute("data-settled", "")
  const nodes = canvas.locator(".umbel-concept")
  await expect(nodes.first()).toBeVisible()
  await expect(canvas.locator(".umbel-concept--dim")).toHaveCount(0)

  const search = page.getByRole("searchbox", { name: "Search this Expedition" })

  // Text: the Concept whose title it is stays lit; others dim.
  const total = await nodes.count()
  const title = (await nodes
    .first()
    .locator(".umbel-concept__title")
    .textContent())!
  await search.fill(title)
  await expect(page.getByTestId("search-count")).toHaveText(/^\d+ match/)
  const found = nodes.filter({ hasText: title }).first()
  await expect(found).not.toHaveClass(/umbel-concept--dim/)
  await expect(canvas.locator(".umbel-concept--dim").first()).toBeVisible()
  const litByTitle = await canvas
    .locator(".umbel-concept:not(.umbel-concept--dim)")
    .count()
  expect(litByTitle).toBeLessThan(total)
  await screenshot(page, testInfo, "search-canvas")

  // #tag: every Concept with the Tag stays lit.
  await search.fill("#economics")
  await expect(page.getByTestId("search-count")).toHaveText(/\d+ matches/)
  const lit = await canvas
    .locator(".umbel-concept:not(.umbel-concept--dim)")
    .count()
  expect(lit).toBeGreaterThan(1)
  expect(lit).toBeLessThan(total)

  // Escape clears: nothing is dimmed.
  await search.press("Escape")
  await expect(search).toHaveValue("")
  await expect(page.getByTestId("search-count")).toHaveCount(0)
  await expect(canvas.locator(".umbel-concept--dim")).toHaveCount(0)

  expect(errors).toEqual([])
})

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
