import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import pg from "pg"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-2.7: the complete Library (spec §3.2). Your Expeditions, Shared with
// you and Drafts; cards with the best View's View Type thumbnail, the
// collaborators, counts and date; the Tag filter; and "Keep available
// offline". Runs in light and dark (app-light, app-dark) for the screenshots.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../packages/domain/fixtures/compute.json",
        import.meta.url
      )
    ),
    "utf8"
  )
) as { title: string; tags: string[] }

/** Imports the compute fixture, retitled and tagged; returns its id. */
async function importAs(page: Page, title: string, tags: string[]) {
  const res = await page.request.post("/api/import", {
    data: { ...COMPUTE, title, tags },
  })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { expedition: { id: string } }).expedition.id
}

async function myId(page: Page): Promise<string> {
  return ((await (await page.request.get("/api/me")).json()) as {
    user: { id: string }
  }).user.id
}

/** Pinned ids in IndexedDB "umbel-offline". */
function pinned(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("umbel-offline")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("meta")) return resolve([])
          const all = db.transaction("meta").objectStore("meta").getAll()
          all.onsuccess = () => {
            resolve(
              (all.result as { expeditionId: string; pinned: boolean }[])
                .filter((e) => e.pinned)
                .map((e) => e.expeditionId)
            )
            db.close()
          }
          all.onerror = () => reject(all.error)
        }
      })
  )
}

test("the Library's sections, cards, Tag filter and offline pin", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 1000 })

  // Someone else shares an Expedition with me. There's no sharing UI yet
  // (WP-5.x), so the test adds the Collaborator row directly.
  const otherCtx = await browser.newContext()
  const other = await otherCtx.newPage()
  await signUp(other, "Ada Byron")
  const sharedId = await importAs(other, "Shared inference notes", [
    "inference",
  ])
  await otherCtx.close()

  await signUp(page, "Library Reader")
  const me = await myId(page)
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    await db.query(
      "insert into collaborators (expedition_id, user_id, role) values ($1, $2, 'editor')",
      [sharedId, me]
    )
  } finally {
    await db.end()
  }

  // Mine: two built ones (tagged differently) and a draft.
  await importAs(page, "Attention, closely", ["attention", "training"])
  await importAs(page, "Inference economics", ["inference"])
  const draft = await page.request.post("/api/expeditions", {
    data: { title: "A draft to build" },
  })
  expect(draft.status()).toBe(201)

  await page.goto("/")
  const yours = page.getByRole("list", { name: "Your Expeditions" })
  const shared = page.getByRole("list", { name: "Shared with you" })
  const drafts = page.getByRole("list", { name: "Drafts" })
  await expect(yours.getByTestId("expedition-card")).toHaveCount(2)
  await expect(shared.getByTestId("expedition-card")).toHaveCount(1)
  await expect(drafts.getByTestId("expedition-card")).toHaveCount(1)

  // A card: the best View's thumbnail (the fixture's best View is the
  // Outline), counts, collaborators, date.
  const card = yours
    .getByTestId("expedition-card")
    .filter({ hasText: "Attention, closely" })
  await expect(
    card.locator("[data-slot=view-type-thumbnail]")
  ).toHaveAttribute("data-view-type", "outline")
  await expect(card.getByTestId("card-counts")).toHaveText(
    "201 Concepts · 12 Views"
  )
  await expect(card).toContainText("Only you")
  await expect(card).toContainText("Today")
  const sharedCard = shared.getByTestId("expedition-card")
  await expect(sharedCard).toContainText("You and Ada Byron")
  await expect(sharedCard).toContainText("Editor")
  const draftCard = drafts.getByTestId("expedition-card")
  await expect(draftCard).toContainText("0 Concepts · 0 Views")
  await expect(
    draftCard.locator("[data-slot=view-type-thumbnail]")
  ).toHaveAttribute("data-view-type", "none")

  // The section nav counts them.
  const nav = page.getByRole("navigation", { name: "Library sections" })
  await expect(nav).toContainText("Your Expeditions2")
  await expect(nav).toContainText("Shared with you1")
  await expect(nav).toContainText("Drafts1")
  await screenshot(page, testInfo, "library")

  // The Tag filter: #inference keeps one of mine and the shared one.
  const tags = page.getByTestId("tag-filter")
  await tags.getByRole("button", { name: /#inference/ }).click()
  await expect(yours.getByTestId("expedition-card")).toHaveCount(1)
  await expect(yours).toContainText("Inference economics")
  await expect(shared.getByTestId("expedition-card")).toHaveCount(1)
  await expect(drafts).toHaveCount(0)
  await screenshot(page, testInfo, "library-tag-filter")
  // Clicking it again clears the filter.
  await tags.getByRole("button", { name: /#inference/ }).click()
  await expect(yours.getByTestId("expedition-card")).toHaveCount(2)

  // Keep available offline: pinned (and downloaded) on this device.
  const pin = card.getByTestId("pin-offline")
  await expect(pin).toHaveAttribute("aria-pressed", "false")
  await pin.click()
  await expect(pin).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("Kept available offline").first()).toBeVisible()
  await expect.poll(() => pinned(page)).toHaveLength(1)
  // Still pinned after a reload; unpinning clears it.
  await page.reload()
  await expect(
    yours
      .getByTestId("expedition-card")
      .filter({ hasText: "Attention, closely" })
      .getByTestId("pin-offline")
  ).toHaveAttribute("aria-pressed", "true")
  await pin.click()
  await expect.poll(() => pinned(page)).toHaveLength(0)

  // The card opens the Expedition.
  await card.getByRole("link", { name: "Attention, closely" }).click()
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  await expect(
    page.getByRole("banner").getByRole("heading", { name: "Attention, closely" })
  ).toBeVisible()

  expect(errors).toEqual([])
})
