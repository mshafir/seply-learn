import { fileURLToPath } from "node:url"
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import pg from "pg"

import { needsDatabase, openView, screenshot, signUp } from "./helpers.ts"

// WP-4.1: the live relay and presence (spec §2.4, §3.6). Ada imports the
// compute fixture and Ed joins as an editor, each in their own browser
// context, both on the Learning path. They see each other's avatar; the
// room is left idle until the Durable Object hibernates (local workerd
// evicts an idle object after about 10 s while its sockets stay open); then
// Ada's cursor on a Concept shows on the same Concept for Ed, her rename
// reaches Ed's tab without a single pull, and Ed's presence clears when his
// context closes. An anonymous reader of an unlisted link gets edits as
// `ops` and never sends or hears presence.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)

/** Longer than local workerd keeps an idle Durable Object in memory. */
const HIBERNATE_MS = 15_000

type Person = {
  context: BrowserContext
  page: Page
  id: string | null
  errors: string[]
  /** `/api/pull` requests since the last `resetPulls()`. */
  pulls: () => number
  resetPulls: () => void
  /** The room frames this page sent and received. */
  frames: { sent: string[]; received: string[] }
}

async function person(browser: Browser, name: string | null): Promise<Person> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  let pulls = 0
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/pull") pulls += 1
  })
  const frames = { sent: [] as string[], received: [] as string[] }
  page.on("websocket", (ws) => {
    if (!ws.url().endsWith("/live")) return
    ws.on("framesent", (f) => frames.sent.push(String(f.payload)))
    ws.on("framereceived", (f) => frames.received.push(String(f.payload)))
  })
  let id: string | null = null
  if (name) {
    await signUp(page, name)
    const me = await (await page.request.get("/api/me")).json()
    id = me.user.id as string
  }
  return {
    context,
    page,
    id,
    errors,
    pulls: () => pulls,
    resetPulls: () => {
      pulls = 0
    },
    frames,
  }
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

async function sql(query: string, params: unknown[]) {
  // No invite or Visibility API yet: straight to the database.
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    await db.query(query, params)
  } finally {
    await db.end()
  }
}

async function openLearningPath(page: Page, exp: string) {
  await page.goto(`/e/${exp}`)
  await openView(page, /Learning path/)
  await expect(page.getByTestId("view-button")).toContainText(/Learning path/)
  await expect(page.getByTestId("canvas-pane")).toHaveAttribute(
    "data-settled",
    ""
  )
}

async function rename(page: Page, title: string) {
  await page.getByRole("button", { name: /^Rename the Expedition/ }).click()
  const input = page.getByRole("textbox", { name: "Expedition title" })
  await input.fill(title)
  await input.press("Enter")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)
}

/** Moves the mouse onto a point of an element, in a few steps. */
async function pointAt(page: Page, el: ReturnType<Page["locator"]>) {
  const box = (await el.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, {
    steps: 5,
  })
  return box
}

const types = (frames: string[]) =>
  frames.map((f) => (JSON.parse(f) as { t: string }).t)

test("live edits, cursors and presence between two collaborators, across hibernation", async ({
  browser,
}, testInfo) => {
  // Two cold contexts, a hibernation wait and two context lifetimes.
  test.setTimeout(120_000)
  const ada = await person(browser, "Ada Lovelace")
  const ed = await person(browser, "Ed Hopper")
  let edOpen = true
  try {
    const exp = await importCompute(ada.page)
    await sql(
      "insert into collaborators (expedition_id, user_id, role) values ($1, $2, 'editor')",
      [exp, ed.id]
    )
    await openLearningPath(ada.page, exp)
    await openLearningPath(ed.page, exp)

    // Each sees the other's avatar in the header, never their own.
    const avatar = (p: Page, userId: string | null) =>
      p.locator(`[data-testid=presence-avatar][data-user="${userId}"]`)
    await expect(avatar(ada.page, ed.id)).toBeVisible()
    await expect(avatar(ed.page, ada.id)).toBeVisible()
    await expect(avatar(ada.page, ada.id)).toHaveCount(0)
    await expect(avatar(ada.page, ed.id)).toHaveAccessibleName(
      "Ed Hopper, on Learning path"
    )

    // Leave the room idle until its Durable Object hibernates.
    await ada.page.waitForTimeout(HIBERNATE_MS)
    ed.resetPulls()

    // Ada points at a Concept: her cursor shows on that Concept for Ed.
    const concept = ada.page
      .getByTestId("canvas-pane")
      .locator("[data-concept]")
      .first()
    const conceptId = await concept.getAttribute("data-concept")
    await pointAt(ada.page, concept)
    const cursor = ed.page.locator(
      `[data-testid=live-cursor][data-user="${ada.id}"]`
    )
    await expect(cursor).toBeVisible()
    await expect(cursor).toContainText("Ada Lovelace")
    const edConcept = ed.page
      .getByTestId("canvas-pane")
      .locator(`[data-concept="${conceptId}"]`)
      .first()
    await expect
      .poll(async () => {
        const c = (await cursor.boundingBox())!
        const b = (await edConcept.boundingBox())!
        return (
          c.x >= b.x - 2 &&
          c.x <= b.x + b.width + 2 &&
          c.y >= b.y - 2 &&
          c.y <= b.y + b.height + 2
        )
      })
      .toBe(true)
    await screenshot(ed.page, testInfo, "live-cursor")
    // Off the canvas, the cursor goes.
    await ada.page.mouse.move(5, 5)
    await expect(cursor).toHaveCount(0)

    // Ada renames the Expedition: Ed's tab has it at once, without a pull.
    await rename(ada.page, "Compute, live")
    await expect(ed.page.getByRole("heading", { level: 1 })).toHaveText(
      "Compute, live",
      { timeout: 5_000 }
    )
    expect(ed.pulls()).toBe(0)
    expect(types(ed.frames.received)).toContain("ops")

    // On another View, Ada's cursor isn't drawn for Ed.
    await openView(ed.page, /Compute economics/)
    await pointAt(ada.page, concept)
    await expect(avatar(ada.page, ed.id)).toHaveAccessibleName(
      "Ed Hopper, on Compute economics"
    )
    await expect(cursor).toHaveCount(0)

    // Ed closes his browser: his presence clears for Ada.
    await ed.context.close()
    edOpen = false
    await expect(avatar(ada.page, ed.id)).toHaveCount(0, { timeout: 10_000 })
    await expect(ada.page.getByTestId("presence")).toHaveCount(0)

    expect(ada.errors).toEqual([])
    expect(ed.errors).toEqual([])
  } finally {
    await ada.context.close()
    if (edOpen) await ed.context.close()
  }
})

test("an anonymous reader of a link gets edits as ops, and no presence", async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const ada = await person(browser, "Ada Lovelace")
  const anon = await person(browser, null)
  try {
    const exp = await importCompute(ada.page)
    // Unlisted, not public, so it never shows in other tests' searches.
    await sql("update expeditions set visibility = 'unlisted' where id = $1", [
      exp,
    ])
    await openLearningPath(ada.page, exp)
    await openLearningPath(anon.page, exp)
    await expect(anon.page.getByRole("link", { name: "Sign in" })).toBeVisible()
    await expect.poll(() => types(anon.frames.received)).toContain("hello")
    anon.resetPulls()

    // Ada's pointer and rename: the anonymous tab gets the rename, no pull.
    await pointAt(
      ada.page,
      ada.page.getByTestId("canvas-pane").locator("[data-concept]").first()
    )
    await rename(ada.page, "Compute, for everyone")
    await expect(anon.page.getByRole("heading", { level: 1 })).toHaveText(
      "Compute, for everyone",
      { timeout: 5_000 }
    )
    expect(anon.pulls()).toBe(0)

    // It never sent a frame, heard nobody's presence, and nobody sees it.
    const hello = JSON.parse(anon.frames.received[0]!) as {
      t: string
      you?: string
      presence: unknown[]
    }
    expect(hello).toMatchObject({ t: "hello", presence: [] })
    expect(hello.you).toBeUndefined()
    expect(anon.frames.sent).toEqual([])
    expect(types(anon.frames.received)).toContain("ops")
    expect(types(anon.frames.received)).not.toContain("presence")
    await expect(anon.page.getByTestId("live-cursor")).toHaveCount(0)
    await expect(ada.page.getByTestId("presence")).toHaveCount(0)

    expect(ada.errors).toEqual([])
    expect(anon.errors).toEqual([])
  } finally {
    await ada.context.close()
    await anon.context.close()
  }
})
