import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

import {
  needsDatabase,
  openView,
  screenshot,
  settledWidthOf,
  signUp,
  widthOf,
} from "./helpers.ts"

// WP-1.5: sign in with the test credentials, reach the Library, import the
// compute fixture, open it, and check the Expedition screen: the Views bar
// under the header (tabs that fit, the rest under "more", a card on hover),
// the canvas full width, the side panel sliding open at 520 px, resizable
// by its edge (kept over a reload), wider for the full article and back
// again (a Sheet on narrow windows). Runs in light and dark (app-light, app-dark).
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)
const WIDE = { width: 1440, height: 900 }
const PANEL = 520
const ARTICLE = 860

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

  // The Views bar holds the fixture's 12 Views: those that fit as tabs, the
  // rest under "more". It opens on the best View.
  const bar = page.getByTestId("views-bar")
  await expect(bar).toHaveAttribute("data-views", "12")
  await expect(bar.locator("[aria-current=page]")).toContainText("Outline")
  const tabs = bar.getByTestId("view-tab")
  const more = bar.getByTestId("more-views")
  await expect(more).toBeVisible()
  const tabCount = await tabs.count()
  expect(tabCount).toBeGreaterThan(3)
  await expect(more).toHaveText(`${12 - tabCount} more`)
  await more.click()
  await expect(page.getByRole("menuitem")).toHaveCount(12 - tabCount)
  await screenshot(page, testInfo, "views-more")
  await page.keyboard.press("Escape")
  const viewButton = page.getByTestId("view-button")
  await expect(viewButton).toContainText("Outline")

  // Hovering a tab shows its card: the question and what the View Type is.
  await tabs.first().hover()
  const card = page.getByTestId("view-card")
  await expect(card).toBeVisible()
  await expect(card).toContainText("Outline")
  await screenshot(page, testInfo, "views-card")
  await page.mouse.move(WIDE.width / 2, WIDE.height / 2)
  await expect(card).toHaveCount(0)

  // No selection: the canvas fills the width.
  expect(await widthOf(page, "[data-testid=canvas-pane]")).toBe(WIDE.width)
  await expect(page.getByTestId("side-panel")).toHaveCount(0)

  // The Learning path draws on the canvas.
  const canvas = page.getByTestId("canvas-pane")
  await openView(page, /Learning path/)
  await expect(page).toHaveURL(/\/e\/[^/]+\/[^/]+$/)
  await expect(viewButton).toContainText("Learning path")
  await expect(bar.locator("[aria-current=page]")).toContainText(
    "Learning path"
  )
  await expect(canvas).toHaveAttribute("data-settled", "")
  await expect(canvas.locator(".react-flow__node").first()).toBeVisible()
  await screenshot(page, testInfo, "expedition")

  // The View button slides the View panel open.
  await viewButton.click()
  const panel = page.getByTestId("side-panel")
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("View · Learning path")
  expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBe(PANEL)
  expect(await widthOf(page, "[data-testid=canvas-pane]")).toBe(
    WIDE.width - PANEL
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
  expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBe(PANEL)
  await screenshot(page, testInfo, "expedition-concept")

  // The full article reads wider; back to the overview narrows again.
  const readArticle = panel.getByRole("button", {
    name: /Read the full article/,
  })
  if (await readArticle.isVisible()) {
    await readArticle.click()
    expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBe(ARTICLE)
    await screenshot(page, testInfo, "expedition-article")
    await panel.getByTestId("panel-back").click()
    expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBe(PANEL)
  }

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
    WIDE.width - PANEL - 120,
    0
  )
  await page.reload()
  await canvas
    .locator(".react-flow__node", { hasText: conceptTitle })
    .first()
    .click()
  await expect(panel.getByTestId("panel-title")).toHaveText(conceptTitle)
  expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBeCloseTo(
    PANEL + 120,
    0
  )
  await screenshot(page, testInfo, "expedition-panel-resized")
  await dragPanelEdge(120)
  expect(await widthOf(page, "[data-testid=side-panel]")).toBeCloseTo(PANEL, 0)

  // Closing slides the panel shut; the canvas takes the width back.
  await panel.getByRole("button", { name: "Close" }).click()
  await expect(panel).toHaveCount(0)
  expect(await settledWidthOf(page, "[data-testid=canvas-pane]")).toBe(
    WIDE.width
  )
  await canvas
    .locator(".react-flow__node", { hasText: conceptTitle })
    .first()
    .click()
  await expect(panel.getByTestId("panel-title")).toHaveText(conceptTitle)

  // Another View: a Comparison Table.
  await openView(page, /Open models/)
  await expect(viewButton).toContainText("Open models")
  await expect(canvas.getByRole("table")).toBeVisible()
  await screenshot(page, testInfo, "expedition-table")

  // Narrow window: the side panel becomes a Sheet over the canvas.
  const NARROW = 900
  await page.setViewportSize({ width: NARROW, height: 800 })
  const sheet = page.getByTestId("side-panel")
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveAttribute("role", "dialog")
  await expect(sheet.getByRole("heading", { name: conceptTitle })).toBeVisible()
  expect(await settledWidthOf(page, "[data-testid=canvas-pane]")).toBe(NARROW)
  expect(await settledWidthOf(page, "[data-testid=side-panel]")).toBe(PANEL)
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
