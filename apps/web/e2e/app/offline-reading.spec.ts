import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-2.7: offline reading (spec §2.9). Open the compute fixture, go offline,
// reload: the service worker serves the app and the Expedition opens from
// the copy saved in IndexedDB, read-only, with the "Offline, as of …" chip.
// The Library, offline, lists what is saved on this device.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)
const TITLE = "AI compute & model internals"

/** The Expeditions saved for offline reading (IndexedDB "seply-offline"). */
function savedOffline(
  page: Page
): Promise<{ expeditionId: string; savedAt: number | null }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("seply-offline")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("meta")) return resolve([])
          const all = db.transaction("meta").objectStore("meta").getAll()
          all.onsuccess = () => {
            resolve(all.result)
            db.close()
          }
          all.onerror = () => reject(all.error)
        }
      })
  )
}

// Blocked by #76: offline, the Learning path Concepts are never measured and stay hidden.
test.fixme("an opened Expedition reads offline after a reload, read-only, with the chip", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUp(page)

  // Import the compute fixture; it opens.
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  const id = new URL(page.url()).pathname.split("/")[2]!
  const header = page.getByRole("banner")
  await expect(header.getByRole("heading", { name: TITLE })).toBeVisible()
  await page
    .getByRole("dialog", { name: /^Imported/ })
    .locator("[data-slot=toast-close]")
    .click()
  // Online and an owner: the title can be renamed; no chip.
  await expect(
    header.getByRole("button", { name: /Rename the Expedition/ })
  ).toBeVisible()
  await expect(page.getByTestId("offline-chip")).toHaveCount(0)

  // The service worker has the app shell, and the Expedition is saved.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => {}))
  await expect
    .poll(async () =>
      (await savedOffline(page)).some(
        (e) => e.expeditionId === id && e.savedAt !== null
      )
    )
    .toBe(true)

  // Offline, reload: the Expedition opens from this device.
  await context.setOffline(true)
  await page.reload()
  const chip = page.getByTestId("offline-chip")
  await expect(chip).toContainText("Offline, as of")
  await expect(chip).toContainText("read-only")
  await expect(header.getByRole("heading", { name: TITLE })).toBeVisible()
  // Read-only: no renaming.
  await expect(
    header.getByRole("button", { name: /Rename the Expedition/ })
  ).toHaveCount(0)

  // It reads: the Views rail, a View on the canvas, a Concept's article.
  const rail = page.getByTestId("views-rail")
  await expect(rail.getByRole("button")).toHaveCount(12)
  await rail.getByRole("button", { name: /Learning path/ }).click()
  const canvas = page.getByTestId("canvas-pane")
  await expect(canvas).toHaveAttribute("data-settled", "")
  const node = canvas.locator(".react-flow__node").first()
  await node.click()
  const panel = page.getByTestId("side-panel")
  await expect(panel).toBeVisible()
  const conceptTitle = (await panel.getByTestId("panel-title").textContent())!
  expect(conceptTitle.length).toBeGreaterThan(0)
  // The View panel offers no shared settings to edit.
  await page.getByTestId("view-button").click()
  await expect(panel).toContainText("View · Learning path")
  await screenshot(page, testInfo, "expedition-offline")

  // The Library, offline: what is saved on this device.
  await header.getByRole("link", { name: "Library" }).click()
  await expect(page.getByText("You're offline")).toBeVisible()
  const saved = page.getByRole("list", { name: "Available offline" })
  await expect(saved.getByRole("link", { name: TITLE })).toBeVisible()
  await screenshot(page, testInfo, "library-offline")

  // Back online: the live Expedition, editable again.
  await context.setOffline(false)
  await saved.getByRole("link", { name: TITLE }).click()
  await expect(
    header.getByRole("button", { name: /Rename the Expedition/ })
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("offline-chip")).toHaveCount(0)

  expect(errors).toEqual([])
})
