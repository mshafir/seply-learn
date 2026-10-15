import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

import { needsDatabase, openView, screenshot, signUp } from "./helpers.ts"

// Issue #140: on a Map View the View button floats over the map, as it does
// over a canvas View; there is no band above the map. The map fills the
// canvas pane and its zoom buttons sit clear of the button, on desktop and
// phone widths. Runs in light and dark (app-light, app-dark).
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const TRIP = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/trip.json", import.meta.url)
)

async function openRoute(page: Page) {
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(TRIP)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  await page
    .getByRole("dialog", { name: /^Imported/ })
    .locator("[data-slot=toast-close]")
    .click()
  await openView(page, /The route/)
  await expect(page.getByTestId("view-button")).toContainText("The route")
  await expect(page.getByTestId("canvas-pane")).toHaveAttribute(
    "data-settled",
    ""
  )
}

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox()
  expect(b, `${selector} is on screen`).not.toBeNull()
  return b!
}

for (const [label, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`the View button floats over the Map View (${label})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await signUp(page, "Map Reader")
    await openRoute(page)

    const pane = await box(page, "[data-testid=canvas-pane]")
    const map = await box(page, "[data-testid=map]")
    const button = await box(page, "[data-testid=view-button]")

    // No separate row: the map fills the pane, top to bottom.
    expect(Math.abs(map.y - pane.y)).toBeLessThan(1)
    expect(Math.abs(map.height - pane.height)).toBeLessThan(1)
    expect(Math.abs(map.width - pane.width)).toBeLessThan(1)
    // The button sits over the map, not above it.
    expect(button.y).toBeGreaterThan(map.y)
    expect(button.y + button.height).toBeLessThan(map.y + map.height)

    // The map's own controls stay clear of the button.
    const zoom = await box(
      page,
      "[data-testid=map] .maplibregl-ctrl-top-right .maplibregl-ctrl-group"
    )
    expect(zoom.y).toBeGreaterThanOrEqual(button.y + button.height)
    const attribution = await box(
      page,
      "[data-testid=map] .maplibregl-ctrl-attrib"
    )
    expect(attribution.y).toBeGreaterThan(button.y + button.height)

    await screenshot(page, testInfo, `map-view-${label}`)
  })
}
