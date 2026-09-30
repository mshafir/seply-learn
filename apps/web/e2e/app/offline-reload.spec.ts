import { expect, test, type Page } from "@playwright/test"

import { needsDatabase, signUp } from "./helpers.ts"

// The real-browser reload test WP-1.3 couldn't run: rename the Expedition
// through the sync client with the network blocked, reload (still blocked),
// and the pending edit is still there, in IndexedDB; once the network is back
// it is pushed and the server has it. (Reading offline, WP-2.7, is
// offline-reading.spec.ts.)
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

/** Pending ops the sync client keeps in IndexedDB (@seply/sync's store). */
function pendingOps(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("seply-sync")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("pendingOps")) return resolve(0)
          const count = db
            .transaction("pendingOps")
            .objectStore("pendingOps")
            .count()
          count.onsuccess = () => {
            resolve(count.result)
            db.close()
          }
          count.onerror = () => reject(count.error)
        }
      })
  )
}

async function serverTitle(page: Page, id: string): Promise<string> {
  // page.request is not routed through page.route: it always reaches the server.
  const res = await page.request.get("/api/expeditions")
  const { expeditions } = await res.json()
  return expeditions.find((e: { id: string }) => e.id === id)?.title
}

test("an edit made offline survives a reload and is pushed when the network is back", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "app-light", "one theme is enough")
  await signUp(page)
  const created = await page.request.post("/api/expeditions", {
    data: { title: "Before" },
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()

  await page.goto(`/e/${id}`)
  const header = page.getByRole("banner")
  await expect(header.getByRole("heading", { name: "Before" })).toBeVisible()

  // The network goes away (for the API; the app's files still load).
  const block = (route: { abort: () => Promise<void> }) => route.abort()
  await page.route("**/api/**", block)

  await header.getByRole("button", { name: /Rename the Expedition/ }).click()
  const input = header.getByRole("textbox", { name: "Expedition title" })
  await input.fill("Renamed offline")
  await input.press("Enter")
  await expect(
    header.getByRole("heading", { name: "Renamed offline" })
  ).toBeVisible()
  await expect(page.getByTestId("sync-status")).toContainText(
    "Offline · 1 edit waiting"
  )
  await expect.poll(() => pendingOps(page)).toBe(1)
  expect(await serverTitle(page, id)).toBe("Before")

  // Reload while still offline: the edit is still pending on this device.
  // The screen reads the copy saved for offline reading (WP-2.7), read-only,
  // as of before the edit, and counts the edit waiting.
  await page.reload()
  await expect(page.getByTestId("offline-chip")).toContainText("Offline, as of")
  await expect(header.getByRole("heading", { name: "Before" })).toBeVisible()
  await expect(
    header.getByRole("button", { name: /Rename the Expedition/ })
  ).toHaveCount(0)
  await expect(page.getByTestId("sync-status")).toContainText(
    "Offline · 1 edit waiting"
  )
  expect(await pendingOps(page)).toBe(1)
  expect(await serverTitle(page, id)).toBe("Before")

  // The network is back: the client opens, rebases the edit and pushes it.
  await page.unroute("**/api/**", block)
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(
    header.getByRole("heading", { name: "Renamed offline" })
  ).toBeVisible()
  await expect.poll(() => serverTitle(page, id)).toBe("Renamed offline")
  await expect.poll(() => pendingOps(page)).toBe(0)
  await expect(page.getByTestId("sync-status")).toHaveCount(0)

  // And a fresh load reads it from the server.
  await page.reload()
  await expect(
    header.getByRole("heading", { name: "Renamed offline" })
  ).toBeVisible()
})
