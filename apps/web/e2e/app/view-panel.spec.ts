import { fileURLToPath } from "node:url"
import { expect, test, type Browser, type Page } from "@playwright/test"
import pg from "pg"

import { needsDatabase, screenshot, signUp, openView } from "./helpers.ts"

// WP-2.4: the View panel. Ada imports the compute fixture and Ed joins as an
// editor, each in their own browser context. A shared setting Ada changes
// (Cause & Effect's mode) reaches Ed's open tab; a personal setting she
// changes (Learning path's "Show all steps") stays hers, and survives her
// reload. Plus Duplicate, "Read the View Type" and the status chip.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)

async function person(browser: Browser, name: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await signUp(page, name)
  const me = await (await page.request.get("/api/me")).json()
  return { context, page, id: me.user.id as string, errors }
}

async function importCompute(page: Page): Promise<string> {
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  await page
    .getByRole("dialog", { name: /^Imported/ })
    .locator("[data-slot=toast-close]")
    .click()
  return new URL(page.url()).pathname.split("/")[2]!
}

async function addEditor(expeditionId: string, userId: string) {
  // No invite API yet (M3): add the editor directly.
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    await db.query(
      "insert into collaborators (expedition_id, user_id, role) values ($1, $2, 'editor')",
      [expeditionId, userId]
    )
  } finally {
    await db.end()
  }
}

async function openSettledView(page: Page, name: RegExp) {
  await openView(page, name)
  await expect(page.getByTestId("view-button")).toContainText(name)
  await expect(page.getByTestId("canvas-pane")).toHaveAttribute(
    "data-settled",
    ""
  )
}

async function openPanel(page: Page) {
  await page.getByTestId("view-button").click()
  const panel = page.getByTestId("side-panel")
  await expect(panel).toContainText("View ·")
  return panel
}

test("shared settings sync to another context; personal ones don't", async ({
  browser,
}, testInfo) => {
  // Two contexts, each loading the app cold (the service worker precaches
  // the shell on first load, WP-2.7), a fixed 4 s wait and two 15 s sync
  // windows: more than the default 30 s budget allows on a slow runner.
  test.setTimeout(60_000)
  const ada = await person(browser, "Ada")
  const ed = await person(browser, "Ed")
  try {
    const exp = await importCompute(ada.page)
    await addEditor(exp, ed.id)

    // Both open Cause & Effect ("Compute economics") and its View panel.
    await ada.page.goto(`/e/${exp}`)
    await openSettledView(ada.page, /Compute economics/)
    const adaPanel = await openPanel(ada.page)
    await ed.page.goto(`/e/${exp}`)
    await openSettledView(ed.page, /Compute economics/)
    const edPanel = await openPanel(ed.page)

    // The description comes from the View Type's doc; editors see shared settings.
    await expect(adaPanel.getByTestId("view-description")).not.toBeEmpty()
    const adaShared = adaPanel.getByTestId("shared-settings")
    const edShared = edPanel.getByTestId("shared-settings")
    await expect(
      adaShared.getByRole("combobox", { name: "Mode", exact: true })
    ).toHaveText(/Mechanism/)
    await expect(
      edShared.getByRole("combobox", { name: "Mode", exact: true })
    ).toHaveText(/Mechanism/)
    await screenshot(ada.page, testInfo, "view-panel-shared")

    // Ada switches the mode to risk: Ed's tab picks it up.
    await adaShared.getByRole("combobox", { name: "Mode", exact: true }).click()
    await ada.page.getByRole("option", { name: "Risk" }).click()
    await expect(
      adaShared.getByRole("combobox", { name: "Mode", exact: true })
    ).toHaveText(/Risk/)
    await expect(
      edShared.getByRole("combobox", { name: "Mode", exact: true })
    ).toHaveText(/Risk/, {
      timeout: 15_000,
    })
    // …and an Attribute setting, picked from a searchable combobox.
    const rankBy = adaShared.getByLabel("Rank by", { exact: true })
    await rankBy.click()
    await rankBy.fill("Total")
    await ada.page.getByRole("option", { name: "Total params" }).click()
    await expect(rankBy).toHaveValue("Total params")
    await expect(edShared.getByLabel("Rank by", { exact: true })).toHaveValue(
      "Total params",
      {
        timeout: 15_000,
      }
    )

    // Personal: Ada turns on "Show all steps" in the Learning path.
    await openSettledView(ada.page, /Learning path/)
    await openSettledView(ed.page, /Learning path/)
    const adaMine = adaPanel.getByTestId("personal-settings")
    const edMine = edPanel.getByTestId("personal-settings")
    const adaShowAll = adaMine.getByRole("switch", { name: "Show all steps" })
    await expect(adaShowAll).not.toBeChecked()
    await adaShowAll.click()
    await expect(adaShowAll).toBeChecked()
    // The setting lives in the View panel only: no checkbox on the canvas.
    await expect(
      ada.page.getByTestId("canvas-pane").getByLabel(/Show all steps/)
    ).toHaveCount(0)
    await screenshot(ada.page, testInfo, "view-panel-personal")

    // Ed's stays off, even after a pull and a reload.
    await ed.page.waitForTimeout(4_000)
    await expect(
      edMine.getByRole("switch", { name: "Show all steps" })
    ).not.toBeChecked()
    await ed.page.reload()
    await openPanel(ed.page)
    await expect(
      ed.page
        .getByTestId("personal-settings")
        .getByRole("switch", { name: "Show all steps" })
    ).not.toBeChecked()

    // Ada's survives her reload.
    await ada.page.reload()
    await openPanel(ada.page)
    await expect(
      ada.page
        .getByTestId("personal-settings")
        .getByRole("switch", { name: "Show all steps" })
    ).toBeChecked()

    expect(ada.errors).toEqual([])
    expect(ed.errors).toEqual([])
  } finally {
    await ada.context.close()
    await ed.context.close()
  }
})

test("Duplicate, Read the View Type and the status chip", async ({
  browser,
}, testInfo) => {
  const ada = await person(browser, "Ada")
  const { page } = ada
  try {
    await importCompute(page)
    await openSettledView(page, /Learning path/)
    const panel = await openPanel(page)

    // Read the View Type: its docs/view-types file, then back.
    await panel.getByRole("button", { name: "Read the View Type" }).click()
    const doc = panel.getByTestId("view-type-doc")
    await expect(
      doc.getByRole("heading", { name: "Instructions" })
    ).toBeVisible()
    await expect(panel).toContainText("What do I need to understand first?")
    await screenshot(page, testInfo, "view-type-doc")
    await panel.getByRole("button", { name: "Back to the View" }).click()
    await expect(panel.getByTestId("personal-settings")).toBeVisible()

    // The status chip: focus a path by clicking a target.
    const canvas = page.getByTestId("canvas-pane")
    await canvas
      .locator(".react-flow__node", {
        hasText: "Multi-head Latent Attention (MLA)",
      })
      .click()
    const chip = page.getByTestId("view-status")
    await expect(chip).toHaveText(
      /^Path to Multi-head Latent Attention \(MLA\) · 0 of \d+ read$/
    )
    await screenshot(page, testInfo, "view-status-chip")
    await chip.getByRole("button", { name: "Clear" }).click()
    await expect(chip).toHaveCount(0)

    // Duplicate: a new View next to this one, opened.
    await expect(page.getByTestId("views-bar")).toHaveAttribute(
      "data-views",
      "12"
    )
    const before = page.url()
    await page.getByTestId("view-button").click()
    await page
      .getByTestId("side-panel")
      .getByRole("button", { name: "Duplicate" })
      .click()
    await expect(page).not.toHaveURL(before)
    await expect(page.getByTestId("views-bar")).toHaveAttribute(
      "data-views",
      "13"
    )
    await expect(page.getByTestId("view-button")).toContainText(
      "Learning path (copy)"
    )
    // It is saved: still there after a reload.
    await page.reload()
    await expect(page.getByTestId("view-button")).toContainText(
      "Learning path (copy)"
    )
    expect(ada.errors).toEqual([])
  } finally {
    await ada.context.close()
  }
})
