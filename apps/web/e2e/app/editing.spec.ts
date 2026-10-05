import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

import { needsDatabase, openView, screenshot, signUp } from "./helpers.ts"

// WP-4.5: editing in place. An editor merges two Concepts (the survivor
// keeps the other's title as an alias, its Relationships and the higher
// Reading status), then re-parents a Concept in the Outline "Just this
// View", and the Anatomy, which follows the same shared part-of
// Relationships, keeps it where it was.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)

async function importCompute(page: Page): Promise<string> {
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  const toast = page.getByRole("dialog", { name: /^Imported/ })
  await toast.locator("[data-slot=toast-close]").click()
  return new URL(page.url()).pathname.split("/")[2]!
}

const canvas = (page: Page) => page.getByTestId("canvas-pane")
const panel = (page: Page) => page.getByTestId("side-panel")
const title = (page: Page) => page.getByTestId("panel-title")
/** An Outline line, by its title. */
const line = (page: Page, name: string) =>
  canvas(page).getByRole("treeitem", { name, exact: true })
/** An Anatomy box, by its title. */
const partSel = (name: string) =>
  `.seply-part:has(> .seply-part__head > .seply-part__title:text-is("${name}"))`
const part = (page: Page, name: string) => canvas(page).locator(partSel(name))

/** Waits until nothing is waiting to be pushed. */
async function saved(page: Page) {
  await expect(page.getByTestId("sync-status")).toHaveCount(0, {
    timeout: 15_000,
  })
}

test("merge two Concepts, then re-parent in one View without touching another", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUp(page, "Editor")
  const exp = await importCompute(page)

  // ── Merge: Mamba into State-space models ────────────────────────────────
  await openView(page, /Outline/)
  await line(page, "Mamba").locator("[data-concept]").first().click()
  await expect(title(page)).toHaveText("Mamba")
  await panel(page)
    .getByTestId("reading-status")
    .getByRole("button", { name: "Read", exact: true })
    .click()
  await expect(panel(page).getByTestId("reading-status")).toHaveAttribute(
    "data-state",
    "read"
  )

  await panel(page).getByTestId("concept-actions").click()
  await page.getByRole("menuitem", { name: "Merge with…" }).click()
  const dialog = page.getByTestId("merge-dialog")
  await dialog.getByPlaceholder("Search Concepts").fill("State-space")
  await dialog.getByRole("option", { name: /State-space models/ }).click()
  await dialog
    .getByRole("button", { name: "State-space models", exact: true })
    .click()
  await expect(dialog.getByTestId("merge-summary")).toContainText(
    "Mamba becomes an alias of State-space models"
  )
  await screenshot(page, testInfo, "merge-dialog")
  await dialog.getByTestId("merge-confirm").click()
  await expect(dialog).toHaveCount(0)

  // The panel moves to the survivor: alias, Relationships, Reading status.
  await expect(title(page)).toHaveText("State-space models")
  await expect(panel(page).getByTestId("concept-aliases")).toHaveText(
    "Also called Mamba"
  )
  const linkedFrom = panel(page).getByRole("region", { name: "Linked from" })
  await expect(linkedFrom).toContainText("Jamba")
  await expect(linkedFrom).toContainText("Nemotron-H")
  await expect(
    panel(page).getByRole("region", { name: "Links to" })
  ).toContainText("Mamba–Transformer hybrids")
  await expect(panel(page).getByTestId("reading-status")).toHaveAttribute(
    "data-state",
    "read"
  )
  await expect(line(page, "Mamba")).toHaveCount(0)
  await expect(
    line(page, "State-space models").locator("[data-covered]").first()
  ).toBeVisible()
  await screenshot(page, testInfo, "merged")
  await saved(page)

  // Kept on the server: the log, and the reader's status.
  const reader = await page.evaluate(async (exp) => {
    const res = await fetch(`/api/reader/expeditions/${exp}`)
    return (await res.json()) as {
      reading: { conceptId: string; state: string }[]
    }
  }, exp)
  const ssmId = await line(page, "State-space models")
    .locator("[data-concept]")
    .first()
    .getAttribute("data-concept")
  expect(reader.reading).toContainEqual(
    expect.objectContaining({ conceptId: ssmId, state: "read" })
  )
  await page.reload()
  await openView(page, /Outline/)
  await expect(line(page, "State-space models")).toBeVisible()
  await expect(line(page, "Mamba")).toHaveCount(0)

  // ── Re-parent KV-cache under Serving system, just in the Outline ────────
  await openView(page, /Anatomy/)
  await expect(
    part(page, "Attention").locator(partSel("KV-cache"))
  ).toHaveCount(1)
  await canvas(page)
    .getByRole("button", { name: "KV-cache", exact: true })
    .click()
  await expect(title(page)).toHaveText("KV-cache")
  await openView(page, /Outline/)
  await expect(title(page)).toHaveText("KV-cache")
  await expect(
    line(page, "Attention").getByRole("treeitem", {
      name: "KV-cache",
      exact: true,
    })
  ).toBeVisible()

  await panel(page).getByTestId("concept-actions").click()
  await page.getByRole("menuitem", { name: "Move under…" }).click()
  const move = page.getByTestId("reparent-dialog")
  await expect(move).toContainText("Now under Attention in Outline")
  await move
    .getByPlaceholder("Search for its new parent")
    .fill("Serving system")
  await move.getByRole("option", { name: /Serving system/ }).click()
  await screenshot(page, testInfo, "reparent-dialog")
  await move.getByRole("button", { name: "Just this View" }).click()
  await expect(move).toHaveCount(0)

  // The Outline draws it under Serving system now…
  await expect(
    line(page, "Serving system").getByRole("treeitem", {
      name: "KV-cache",
      exact: true,
    })
  ).toBeVisible()
  await expect(
    line(page, "Attention").getByRole("treeitem", {
      name: "KV-cache",
      exact: true,
    })
  ).toHaveCount(0)
  await screenshot(page, testInfo, "reparented-outline")
  // …while the shared Relationship stays, so the Anatomy keeps it in Attention.
  await expect(
    panel(page).getByRole("region", { name: "Links to" })
  ).toContainText("is part of Attention")
  await saved(page)
  await page.reload()
  await openView(page, /Anatomy/)
  await expect(
    part(page, "Attention").locator(partSel("KV-cache"))
  ).toHaveCount(1)
  await expect(
    part(page, "Serving system").locator(partSel("KV-cache"))
  ).toHaveCount(0)
  await screenshot(page, testInfo, "anatomy-unchanged")

  // The View panel lists it as placed differently, with a way back.
  await openView(page, /Outline/)
  await page.getByTestId("view-button").click()
  await expect(page.getByTestId("placed-concepts")).toContainText(
    "KV-cache under Serving system"
  )
})

test("edit fields and Relationships in place, hide in one View, remove a Kind in use", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUp(page, "Editor")
  await importCompute(page)
  await openView(page, /Outline/)

  // ── Fields and a Relationship, in the panel's Edit mode ─────────────────
  await line(page, "Block diffusion").locator("[data-concept]").first().click()
  await expect(title(page)).toHaveText("Block diffusion")
  await panel(page).getByTestId("concept-edit").click()
  const editor = panel(page).getByTestId("concept-editor")
  await editor
    .getByLabel("Summary")
    .fill("Blocks left to right, denoised inside")
  await editor.getByLabel("Also called").fill("BD3-LM, semi-autoregressive")
  await editor.getByLabel("Also called").press("Enter")
  await editor.getByRole("button", { name: "Pick a Concept" }).click()
  await page.getByPlaceholder("Search Concepts").fill("Gemini Diffusion")
  await page.getByRole("option", { name: /Gemini Diffusion/ }).click()
  await editor.getByRole("button", { name: "Add", exact: true }).click()
  await expect(editor.getByTestId("relationship-edit")).toContainText([
    "Gemini Diffusion",
  ])
  await screenshot(page, testInfo, "edit-mode")
  await panel(page).getByTestId("concept-edit").click()
  await expect(panel(page).getByTestId("concept-aliases")).toHaveText(
    "Also called BD3-LM, semi-autoregressive"
  )
  await expect(panel(page)).toContainText(
    "Blocks left to right, denoised inside"
  )
  await expect(
    panel(page).getByRole("region", { name: "Links to" })
  ).toContainText("Gemini Diffusion")
  await expect(line(page, "Block diffusion")).toContainText(
    "Blocks left to right, denoised inside"
  )

  // ── Hide from this View, then show it again from the View panel ─────────
  await panel(page).getByTestId("concept-actions").click()
  await page.getByRole("menuitem", { name: "Hide from this View" }).click()
  await expect(line(page, "Block diffusion")).toHaveCount(0)
  await page.getByTestId("view-button").click()
  const hidden = page.getByTestId("hidden-concepts")
  await expect(hidden).toContainText("Block diffusion")
  await hidden
    .getByRole("button", { name: "Show Block diffusion again" })
    .click()
  await expect(line(page, "Block diffusion")).toBeVisible()

  // ── Remove the Risk Kind, reassigning its Concept to Idea first ─────────
  await page.getByTestId("vocabulary-open").click()
  const vocab = page.getByTestId("vocabulary-dialog")
  const risk = vocab.locator('[data-testid=vocab-item][data-id="builtin:risk"]')
  await expect(risk).toContainText("1 Concept")
  await risk.getByRole("button", { name: "Remove Risk" }).click()
  await risk.getByRole("combobox", { name: "Reassign to" }).click()
  await page.getByRole("option", { name: "Idea", exact: true }).click()
  await screenshot(page, testInfo, "vocabulary-remove")
  await risk.getByRole("button", { name: "Reassign and remove" }).click()
  await expect(risk).toHaveAttribute("data-hidden", "")
  await expect(risk).toContainText("0 Concepts")
  await page.keyboard.press("Escape")
  await expect(vocab).toHaveCount(0)
  await line(page, "Construction & interconnection delays")
    .locator("[data-concept]")
    .first()
    .click()
  await expect(page.getByTestId("panel-eyebrow")).toContainText(/idea/i)
  await saved(page)
})

test("edit an overview in the rich editor: bold, a Concept link, a list", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUp(page, "Editor")
  await importCompute(page)
  await openView(page, /Outline/)

  await line(page, "Block diffusion").locator("[data-concept]").first().click()
  await expect(title(page)).toHaveText("Block diffusion")
  const before = (await panel(page).getByTestId("overview").innerText())
    .trim()
    .slice(0, 40)
  await panel(page).getByTestId("concept-edit").click()
  const editor = panel(page).getByTestId("concept-editor")
  const overview = editor.getByRole("textbox", { name: "Overview" })
  // The editor loads on demand, with the overview's markdown as rich text.
  await expect(overview).toBeVisible()
  await expect(overview).toContainText(before)
  await expect(overview).not.toContainText("**")
  await expect(overview).not.toContainText("](#c/")
  const toolbar = editor.getByRole("toolbar", { name: "Formatting" }).first()

  // At the end: a bold sentence, a Concept link, then a bulleted list.
  // A click just past the end of the last line puts the caret at the end.
  const lastBlock = overview.locator(":scope > *").last()
  const box = (await lastBlock.boundingBox())!
  await lastBlock.click({ position: { x: box.width - 2, y: box.height - 4 } })
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await toolbar.getByRole("button", { name: "Bold" }).click()
  await page.keyboard.type("Bold claim.")
  await toolbar.getByRole("button", { name: "Bold" }).click()
  await page.keyboard.press("Enter")
  await page.keyboard.type("Compare ")
  await toolbar.getByRole("button", { name: "Link" }).click()
  const linkForm = page.getByTestId("link-form")
  await linkForm.getByPlaceholder("Search Concepts").fill("Gemini Diff")
  await page.getByRole("option", { name: "Gemini Diffusion" }).click()
  await expect(linkForm).toHaveCount(0)
  await expect(overview.locator("a[data-concept-link]").last()).toHaveText(
    "Gemini Diffusion"
  )
  await page.keyboard.press("Enter")
  await toolbar.getByRole("button", { name: "Bulleted list" }).click()
  await page.keyboard.type("First point")
  await page.keyboard.press("Enter")
  await page.keyboard.type("Second point")
  await screenshot(page, testInfo, "markdown-editor")

  // Blur writes it; leaving Edit mode shows it rendered.
  await title(page).click()
  await saved(page)
  await panel(page).getByTestId("concept-edit").click()
  const rendered = panel(page).getByTestId("overview")
  const link = rendered.locator(
    'a[data-concept-link]:text-is("Gemini Diffusion")'
  )
  const check = async () => {
    await expect(rendered).toContainText(before)
    await expect(rendered.locator("strong").last()).toHaveText("Bold claim.")
    await expect(link).toHaveCount(1)
    await expect(rendered.locator("ul > li")).toHaveText([
      "First point",
      "Second point",
    ])
    await expect(rendered).not.toContainText("**")
  }
  await check()
  await screenshot(page, testInfo, "markdown-rendered")

  // Kept: after a reload it renders the same, and the link still navigates.
  await page.reload()
  await openView(page, /Outline/)
  await line(page, "Block diffusion").locator("[data-concept]").first().click()
  await expect(title(page)).toHaveText("Block diffusion")
  await check()
  await link.click()
  await expect(title(page)).toHaveText("Gemini Diffusion")

  // An article section's table and lists edit as a table and lists.
  await openView(page, /Anatomy/)
  await canvas(page)
    .getByRole("button", { name: "KV-cache", exact: true })
    .click()
  await expect(title(page)).toHaveText("KV-cache")
  await panel(page).getByTestId("concept-edit").click()
  await panel(page)
    .getByRole("button", { name: /^Edit the article/ })
    .click()
  const sections = panel(page)
    .getByTestId("article-editor")
    .getByRole("textbox", { name: "Text" })
  const table = sections.locator("table").first()
  await expect(table).toBeVisible()
  await expect(sections.first()).not.toContainText("|---")
  // Its editor, not the table, so nothing scrolls sideways.
  await table.evaluate((t) =>
    t.closest("[data-slot=markdown-editor]")!.scrollIntoView()
  )
  await screenshot(page, testInfo, "markdown-editor-table")
})
