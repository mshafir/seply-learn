import { expect, test, type Page } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-3.7: the Building UX (spec §3.5) against WP-3.2's stubbed `fake` job
// (test credentials are on in the e2e Worker). The Expedition opens while it
// builds: the rail's statuses (queued → building → ready / failed), the
// skeleton with streamed Concepts, the first ready View opening by itself,
// toasts, the failed-View card and Retry; Cancel and what it leaves behind;
// the spending-cap pause (Continue, Stop); "Leave it building"; and the
// header activity indicator throughout. Light and dark (app-light, app-dark).
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

/** A fresh reader with an empty Expedition, open on its screen. */
async function openEmpty(page: Page, title: string) {
  await signUp(page)
  const res = await page.request.post("/api/expeditions", { data: { title } })
  expect(res.status()).toBe(201)
  const id = ((await res.json()) as { id: string }).id
  await page.goto(`/e/${id}`)
  await expect(page.getByRole("heading", { name: title })).toBeVisible()
  return id
}

type FakeInput = {
  views: number
  stepMs?: number
  failView?: { n: number }
  capAt?: number
}

async function startFake(page: Page, id: string, input: FakeInput) {
  const res = await page.request.post(`/api/expeditions/${id}/jobs`, {
    data: { kind: "fake", input },
  })
  expect(res.status()).toBe(201)
}

const rail = (page: Page) => page.getByTestId("rail-view")
const railView = (page: Page, n: number) =>
  rail(page).filter({ hasText: `Test View ${n}` })

test("queued → building → ready and failed → retry, with toasts and the first View opening by itself", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const id = await openEmpty(page, "Building")
  await expect(page.getByTestId("build-activity")).toHaveCount(0)

  // Three Views, 2.5 s each; View 3 fails on every try of this attempt.
  await startFake(page, id, { views: 3, stepMs: 2500, failView: { n: 3 } })

  // The rail: View 1 building (step and progress), the others queued.
  await expect(rail(page)).toHaveCount(3)
  await expect(railView(page, 1)).toHaveAttribute("data-status", "building")
  await expect(railView(page, 1)).toContainText("Building Test View 1")
  await expect(railView(page, 1).getByRole("progressbar")).toBeVisible()
  await expect(railView(page, 2)).toHaveAttribute("data-status", "queued")
  await expect(railView(page, 3)).toHaveAttribute("data-status", "queued")

  // The canvas shows View 1's skeleton, with its streamed Concepts in slots.
  const building = page.getByTestId("view-building")
  await expect(building).toHaveAttribute("data-view-type", "outline")
  await expect(building.getByTestId("preview-node")).toHaveText([
    "Preview 1.1",
    "Preview 1.2",
  ])
  await expect(building.getByTestId("reserved-slot").first()).toBeVisible()
  await expect(page.getByTestId("building-step")).toContainText(
    "2 Concepts so far"
  )

  // The header activity indicator.
  const activity = page.getByTestId("build-activity")
  await expect(activity).toHaveAttribute("data-status", "running")
  await expect(activity).toContainText("Building")
  await expect(activity).toContainText("0 of 3 Views ready")
  await screenshot(page, testInfo, "building")

  // View 1 finishes: it opens by itself (no View in the URL), with a toast.
  await expect(railView(page, 1)).toHaveAttribute("data-status", "ready", {
    timeout: 20_000,
  })
  await expect(page.getByTestId("view-building")).toHaveCount(0)
  await expect(page.getByTestId("canvas-view")).toBeVisible()
  await expect(page.getByText("Test View 1 is ready")).toBeVisible()
  await expect(activity).toContainText("1 of 3 Views ready")

  // View 2 finishes while View 1 is open: its toast offers to open it.
  await expect(railView(page, 2)).toHaveAttribute("data-status", "ready", {
    timeout: 20_000,
  })
  const toast2 = page
    .locator("[data-slot=toast]")
    .filter({ hasText: "Test View 2 is ready" })
  await expect(toast2).toBeVisible()
  await toast2.getByRole("button", { name: "Open" }).click()
  await expect(page).toHaveURL(new RegExp(`/e/${id}/.+`))
  await expect(
    railView(page, 2).getByRole("button", { name: /Test View 2/ })
  ).toHaveAttribute("aria-current", "page")

  // View 3 fails: the reason in the rail and a toast; the others are untouched.
  const reason = "Forced failure while building Test View 3"
  await expect(railView(page, 3)).toHaveAttribute("data-status", "failed", {
    timeout: 20_000,
  })
  await expect(railView(page, 3).getByTestId("build-reason")).toHaveText(reason)
  await expect(page.getByText("Couldn't build Test View 3")).toBeVisible()
  await expect(railView(page, 1)).toHaveAttribute("data-status", "ready")
  await expect(page.getByTestId("build-activity")).toHaveCount(0)

  // Its card: the reason, Retry, Try another View, Remove.
  await railView(page, 3).getByRole("button").click()
  const card = page.getByTestId("failed-view")
  await expect(card.getByTestId("failed-reason")).toHaveText(reason)
  await expect(
    card.getByRole("button", { name: "Try another View" })
  ).toBeVisible()
  await expect(card.getByRole("button", { name: "Remove" })).toBeVisible()
  await screenshot(page, testInfo, "failed-view")

  // Retry: a fresh attempt that skips the ready Views.
  await card.getByRole("button", { name: "Retry" }).click()
  await expect(railView(page, 3)).toHaveAttribute("data-status", "building", {
    timeout: 20_000,
  })
  await expect(page.getByTestId("build-activity")).toBeVisible()
  await expect(railView(page, 1)).toHaveAttribute("data-status", "ready")
  await expect(railView(page, 3)).toHaveAttribute("data-status", "ready", {
    timeout: 20_000,
  })
  await expect(page.getByTestId("canvas-view")).toBeVisible()
  await expect(page.getByText("Every View is built")).toBeVisible()
  await expect(page.getByTestId("build-activity")).toHaveCount(0)
})

test("Cancel keeps the finished Views; the rest are not built and can be removed", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const id = await openEmpty(page, "Cancelled build")
  await startFake(page, id, { views: 3, stepMs: 6000 })

  await expect(railView(page, 1)).toHaveAttribute("data-status", "ready", {
    timeout: 20_000,
  })
  await expect(railView(page, 2)).toHaveAttribute("data-status", "building")

  // The activity indicator opens the build panel: each View's status.
  await page.getByTestId("build-activity").click()
  const panel = page.getByTestId("build-panel")
  await expect(panel).toContainText("Built 1 of 3")
  await expect(panel.getByRole("listitem")).toHaveText([
    /Test View 1\s*Ready/,
    /Test View 2\s*Building/,
    /Test View 3\s*Queued/,
  ])
  await screenshot(page, testInfo, "build-panel")
  await panel.getByRole("button", { name: "Cancel" }).click()

  await expect(page.getByText("Build cancelled")).toBeVisible()
  await expect(page.getByTestId("build-activity")).toHaveCount(0)
  await expect(railView(page, 1)).toHaveAttribute("data-status", "ready")
  for (const n of [2, 3]) {
    await expect(railView(page, n)).toHaveAttribute("data-status", "stopped")
    await expect(railView(page, n)).toContainText("Not built")
  }

  // The job never commits after a cancel: the Views stay as they were.
  await page.waitForTimeout(4000)
  await expect(railView(page, 2)).toHaveAttribute("data-status", "stopped")

  // A View it left behind: Retry is offered; Remove takes it off the rail.
  await railView(page, 3).getByRole("button").click()
  const card = page.getByTestId("failed-view")
  await expect(card).toContainText("Test View 3 wasn't built")
  await expect(card.getByRole("button", { name: "Retry" })).toBeEnabled()
  await card.getByRole("button", { name: "Remove" }).click()
  await expect(page.getByText("Removed Test View 3")).toBeVisible()
  await expect(rail(page)).toHaveCount(2)
  await expect(page.getByTestId("canvas-view")).toBeVisible()
})

test("the spending cap pauses the build: Continue goes on, Stop keeps what's built", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const id = await openEmpty(page, "Capped build")
  await startFake(page, id, { views: 2, capAt: 2, stepMs: 500 })

  const paused = page.getByTestId("cap-paused")
  await expect(paused).toBeVisible({ timeout: 20_000 })
  await expect(paused).toContainText("Spent $0.50 of the $0.50 cap")
  await expect(page.getByTestId("build-activity")).toHaveAttribute(
    "data-status",
    "paused"
  )
  await expect(railView(page, 1)).toHaveAttribute("data-status", "ready")
  await expect(railView(page, 2)).toContainText("Paused at the spending cap")
  await screenshot(page, testInfo, "cap-paused")

  await paused.getByRole("button", { name: "Continue" }).click()
  await expect(paused).toHaveCount(0)
  await expect(railView(page, 2)).toHaveAttribute("data-status", "ready", {
    timeout: 20_000,
  })
  await expect(page.getByTestId("build-activity")).toHaveCount(0)

  // Again, one View further: Stop, from the activity panel this time.
  await startFake(page, id, { views: 3, capAt: 3 })
  await expect(paused).toBeVisible({ timeout: 20_000 })
  await page.getByTestId("build-activity").click()
  await page
    .getByTestId("build-panel")
    .getByRole("button", { name: "Stop" })
    .click()
  await expect(page.getByText("Build stopped")).toBeVisible()
  await expect(paused).toHaveCount(0)
  await expect(railView(page, 3)).toHaveAttribute("data-status", "stopped")
  await expect(railView(page, 1)).toHaveAttribute("data-status", "ready")
  await expect(railView(page, 2)).toHaveAttribute("data-status", "ready")
})

test("Leave it building: asks about notifications, then goes to the Library", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const id = await openEmpty(page, "Left building")
  await startFake(page, id, { views: 2, stepMs: 3000 })

  await page.getByTestId("build-activity").click()
  await page
    .getByTestId("build-panel")
    .getByRole("button", { name: "Leave it building" })
    .click()
  const dialog = page.getByTestId("leave-building")
  await expect(dialog).toContainText("We can send a notification")

  // This Worker has no VAPID keys, so the server can't send one; it says so.
  await dialog.getByRole("button", { name: "Notify me" }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByText("Notifications aren't set up on this server")
  ).toBeVisible()

  // "Just leave" goes straight back.
  await page.goto(`/e/${id}`)
  await page.getByTestId("build-activity").click()
  await page
    .getByTestId("build-panel")
    .getByRole("button", { name: "Leave it building" })
    .click()
  await page
    .getByTestId("leave-building")
    .getByRole("button", { name: "Just leave" })
    .click()
  await expect(page).toHaveURL(/\/$/)
})
