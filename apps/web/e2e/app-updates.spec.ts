import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

// The web client after a deploy (spec §2.9). Pages load from the network
// first, so a new build shows on the next load; a tab that is open when a
// new version takes over offers a reload. A "deploy" here is a change to the
// built index.html that `vite preview` serves. No database needed. (Offline,
// the service worker opening the app and the Expedition is
// app/offline-reading.spec.ts.)

const INDEX = fileURLToPath(new URL("../dist/index.html", import.meta.url))

/** Swaps the served index.html in one step, so no load sees half a file. */
function deploy(html: string) {
  writeFileSync(`${INDEX}.next`, html)
  renameSync(`${INDEX}.next`, INDEX)
}

/** Opens a page and waits until the service worker controls it. */
async function openControlled(page: Page, path: string) {
  await page.goto(path)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => {}))
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null)
    )
    .toBe(true)
}

const marker = (page: Page) =>
  page
    .locator('meta[name="seply-build"]')
    .getAttribute("content", { timeout: 1000 })
    .catch(() => null)

test("a new build shows on the next load", async ({ page }, testInfo) => {
  // It changes the built page, so it runs in one project only.
  test.skip(testInfo.project.name !== "chromium-light", "one project is enough")
  await openControlled(page, "/showcase")
  expect(await marker(page)).toBeNull()

  const original = readFileSync(INDEX, "utf8")
  try {
    deploy(
      original.replace(
        "</head>",
        '<meta name="seply-build" content="next" /></head>'
      )
    )
    // One ordinary reload, under the same service worker.
    await page.reload()
    expect(await marker(page)).toBe("next")
  } finally {
    deploy(original)
  }
})

test("an open tab offers a reload when a new version takes over", async ({
  page,
}) => {
  await openControlled(page, "/showcase")
  // What the browser does when a new worker claims the tab.
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"))
  )
  const offer = page.getByRole("dialog", { name: "Seply Learn was updated" })
  await expect(offer).toContainText("Reload to use the new version.")
  const reloaded = page.waitForEvent("load")
  await offer.getByRole("button", { name: "Reload" }).click()
  await reloaded
  await expect(offer).toHaveCount(0)
})
