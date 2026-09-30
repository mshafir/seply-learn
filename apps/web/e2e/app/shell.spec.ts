import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

import { needsDatabase, screenshot, signUp, widthOf } from "./helpers.ts"

// WP-1.5: sign in with the test credentials, reach the Library, import the
// compute fixture, open it, and check the Expedition screen's panes: Views
// rail 272 px, canvas as wide as possible, side panel 440 px and resizable by
// its edge, the width kept over a reload (a Sheet on narrow windows). Runs in light and dark (app-light, app-dark).
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)
const WIDE = { width: 1440, height: 900 }
const RAIL = 272
const PANEL = 440

test("sign in, import the compute fixture, and open it in three panes", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize(WIDE)

  // Signed out: the app sends you to sign in.
  await page.goto("/")
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible()
  await screenshot(page, testInfo, "sign-in")

  // Signed in (test credentials): the Library, empty.
  await signUp(page)
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Your Expeditions" })
  ).toBeVisible()
  await expect(page.getByText("No Expeditions yet")).toBeVisible()

  // Import the compute fixture: it opens.
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  const header = page.getByRole("banner")
  await expect(
    header.getByRole("heading", { name: "AI compute & model internals" })
  ).toBeVisible()
  const toast = page.getByRole("dialog", { name: /^Imported/ })
  await expect(toast).toContainText("201 Concepts, 425 Relationships, 12 Views")
  await toast.locator("[data-slot=toast-close]").click()
  await expect(toast).toHaveCount(0)

  // The Views rail lists the fixture's 12 Views; it opens on the best View.
  const rail = page.getByTestId("views-rail")
  await expect(rail.getByRole("button")).toHaveCount(12)
  await expect(rail.locator("[aria-current=page]")).toContainText("Outline")
  const viewButton = page.getByTestId("view-button")
  await expect(viewButton).toContainText("Outline")

  // No selection: rail + canvas fill the width.
  expect(await widthOf(page, "[data-testid=views-rail]")).toBe(RAIL)
  expect(await widthOf(page, "[data-testid=canvas-pane]")).toBe(
    WIDE.width - RAIL
  )
  await expect(page.getByTestId("side-panel")).toHaveCount(0)

  // The Learning path draws on the canvas.
  const canvas = page.getByTestId("canvas-pane")
  await rail.getByRole("button", { name: /Learning path/ }).click()
  await expect(page).toHaveURL(/\/e\/[^/]+\/[^/]+$/)
  await expect(viewButton).toContainText("Learning path")
  await expect(canvas).toHaveAttribute("data-settled", "")
  await expect(canvas.locator(".react-flow__node").first()).toBeVisible()
  await screenshot(page, testInfo, "expedition")

  // The View button opens the View panel in the side panel.
  await viewButton.click()
  const panel = page.getByTestId("side-panel")
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("View · Learning path")
  expect(await widthOf(page, "[data-testid=side-panel]")).toBe(PANEL)
  expect(await widthOf(page, "[data-testid=canvas-pane]")).toBe(
    WIDE.width - RAIL - PANEL
  )
  await screenshot(page, testInfo, "expedition-view-panel")

  // Clicking a Concept on the canvas opens it in the side panel instead.
  const node = canvas.locator(".react-flow__node").first()
  await node.click()
  await expect(panel).not.toContainText("View · Learning path")
  const conceptTitle = (await panel.getByTestId("panel-title").textContent())!
  expect(conceptTitle.length).toBeGreaterThan(0)
  // The canvas may still be re-fitting to its new width, so the click can
  // land on a neighbour of the first node: check it opened one of the canvas's.
  await expect(
    canvas.locator(".react-flow__node", { hasText: conceptTitle })
  ).not.toHaveCount(0)
  expect(await widthOf(page, "[data-testid=side-panel]")).toBe(PANEL)
  await screenshot(page, testInfo, "expedition-concept")

  // Drag the panel's edge: it widens, the canvas gives way, and the width
  // survives a reload. Then back to the default for the rest of the test.
  const dragPanelEdge = async (dx: number) => {
    const box = (await page.getByTestId("side-panel-handle").boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 8 })
    await page.mouse.up()
  }
  await dragPanelEdge(-120)
  expect(await widthOf(page, "[data-testid=side-panel]")).toBeCloseTo(
    PANEL + 120,
    0
  )
  expect(await widthOf(page, "[data-testid=canvas-pane]")).toBeCloseTo(
    WIDE.width - RAIL - PANEL - 120,
    0
  )
  await page.reload()
  await canvas
    .locator(".react-flow__node", { hasText: conceptTitle })
    .first()
    .click()
  await expect(panel.getByTestId("panel-title")).toHaveText(conceptTitle)
  expect(await widthOf(page, "[data-testid=side-panel]")).toBeCloseTo(
    PANEL + 120,
    0
  )
  await screenshot(page, testInfo, "expedition-panel-resized")
  await dragPanelEdge(120)
  expect(await widthOf(page, "[data-testid=side-panel]")).toBeCloseTo(PANEL, 0)

  // Another View: a Comparison Table.
  await rail.getByRole("button", { name: /Open models/ }).click()
  await expect(viewButton).toContainText("Open models")
  await expect(canvas.getByRole("table")).toBeVisible()
  await screenshot(page, testInfo, "expedition-table")

  // Narrow window: the side panel becomes a Sheet over the canvas.
  await page.setViewportSize({ width: 1024, height: 800 })
  const sheet = page.getByTestId("side-panel")
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveAttribute("role", "dialog")
  await expect(sheet.getByRole("heading", { name: conceptTitle })).toBeVisible()
  expect(await widthOf(page, "[data-testid=views-rail]")).toBe(RAIL)
  expect(await widthOf(page, "[data-testid=canvas-pane]")).toBe(1024 - RAIL)
  expect(await widthOf(page, "[data-testid=side-panel]")).toBe(PANEL)
  await screenshot(page, testInfo, "expedition-narrow-sheet")
  await sheet.getByRole("button", { name: "Close" }).click()
  await expect(sheet).toHaveCount(0)

  // Back to the Library: the import is listed (Continue reading may list it
  // too; reading-status.spec.ts covers that).
  await page.setViewportSize(WIDE)
  await header.getByRole("link", { name: "Library" }).click()
  await expect(
    page
      .getByRole("list", { name: "Your Expeditions" })
      .getByRole("link", { name: /AI compute & model internals/ })
  ).toBeVisible()
  await screenshot(page, testInfo, "library")

  expect(errors).toEqual([])
})

test("the account menu switches the theme", async ({ page }) => {
  await signUp(page)
  await page.goto("/")
  const html = page.locator("html")
  await page.getByRole("button", { name: "Account" }).click()
  await page.getByRole("menuitemradio", { name: "Dark" }).click()
  await expect(html).toHaveClass(/\bdark\b/)
  // Radio items keep the menu open (Base UI); Escape closes it.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await page.getByRole("button", { name: "Account" }).click()
  await page.getByRole("menuitemradio", { name: "Light" }).click()
  await expect(html).not.toHaveClass(/\bdark\b/)
  // The choice survives a reload (no flash: set before first paint).
  await page.reload()
  await expect(html).not.toHaveClass(/\bdark\b/)
})
