import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test, type Browser, type Page } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// Explore (spec §3.13): public Expeditions for anyone, signed out too. Ada
// imports four copies of the compute sample, each titled with a word made up
// for this run: two public, one unlisted, one private. Signed out, Explore
// lists the public ones and never the others; search narrows to one, and it
// opens read-only. Fork while signed out goes through sign-in and comes back
// with the share dialog open, where Fork is one click.
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
) as Record<string, unknown>

/** A made-up lower-case word, so this run's Expeditions are easy to find. */
const word = () =>
  Array.from({ length: 9 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join("")

async function importAs(
  page: Page,
  title: string,
  visibility: "private" | "unlisted" | "public"
) {
  const res = await page.request.post("/api/import", {
    data: { ...COMPUTE, title },
  })
  expect(res.status()).toBe(201)
  const id = ((await res.json()) as { expedition: { id: string } }).expedition
    .id
  if (visibility !== "private") {
    const set = await page.request.patch(`/api/expeditions/${id}/visibility`, {
      data: { visibility },
    })
    expect(set.status()).toBe(200)
  }
  return id
}

async function signedOutPage(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
  })
  return { context, page: await context.newPage() }
}

test("signed out, Explore lists public Expeditions only, searches and opens one", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  await signUp(page, "Ada Lovelace")
  const run = word()
  const tide = word()
  const kelp = word()
  const tideId = await importAs(page, `Tide pools ${tide} ${run}`, "public")
  await importAs(page, `Kelp forests ${kelp} ${run}`, "public")
  await importAs(page, `Unlisted notes ${run}`, "unlisted")
  await importAs(page, `Private notes ${run}`, "private")

  const anon = await signedOutPage(browser)
  try {
    const p = anon.page
    await p.goto("/explore")
    await expect(p.getByRole("heading", { name: "Explore" })).toBeVisible()
    await expect(p.getByRole("link", { name: "Sign in" })).toBeVisible()

    const search = p.getByRole("searchbox", {
      name: "Search public Expeditions",
    })
    const cards = p.getByRole("list", { name: "Public Expeditions" })
    await search.fill(run)
    await expect(cards.getByTestId("expedition-card")).toHaveCount(2)
    await expect(cards).toContainText(`Tide pools ${tide}`)
    await expect(cards).toContainText(`Kelp forests ${kelp}`)
    await expect(cards).not.toContainText("Unlisted notes")
    await expect(cards).not.toContainText("Private notes")
    await expect(cards.getByTestId("card-counts").first()).toContainText(
      "Concepts"
    )
    // No people on a public card.
    await expect(cards).not.toContainText("Ada")
    await screenshot(p, testInfo, "explore")

    // Search narrows it.
    await search.fill(tide)
    await expect(cards.getByTestId("expedition-card")).toHaveCount(1)
    await expect(cards).toContainText(`Tide pools ${tide}`)

    // Nothing matches: the empty state.
    await search.fill(word())
    await expect(p.getByText("Nothing matches")).toBeVisible()

    // Opening a card shows the Expedition, read-only.
    await search.fill(tide)
    await cards.getByRole("link", { name: `Tide pools ${tide} ${run}` }).click()
    await expect(p).toHaveURL(new RegExp(`/e/${tideId}`))
    await expect(p.getByRole("heading", { level: 1 })).toHaveText(
      `Tide pools ${tide} ${run}`
    )
    await expect(
      p.getByRole("button", { name: /^Rename the Expedition/ })
    ).toHaveCount(0)
    await expect(p.getByRole("link", { name: "Sign in" })).toBeVisible()
    await expect(p.getByTestId("fork-sign-in")).toBeVisible()
  } finally {
    await anon.context.close()
  }
})

test("Fork while signed out signs in, then offers the Fork", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  await signUp(page, "Ada Lovelace")
  const title = `Forkable ${word()}`
  const id = await importAs(page, title, "public")

  const anon = await signedOutPage(browser)
  try {
    const p = anon.page
    await p.goto(`/e/${id}`)
    await expect(p.getByRole("heading", { level: 1 })).toHaveText(title)
    await p.getByTestId("fork-sign-in").click()
    await expect(p).toHaveURL(/\/sign-in\?next=/)
    expect(new URL(p.url()).searchParams.get("next")).toBe(`/e/${id}?fork=1`)

    // Sign in (the test credentials have no UI: an account through the
    // API, then the sign-in screen sends a signed-in reader on to `next`).
    await signUp(p, "Bob Reader")
    await p.reload()
    await expect(p).toHaveURL(new RegExp(`/e/${id}$`))
    const dialog = p.getByTestId("share-dialog")
    await expect(dialog).toBeVisible()
    await dialog.getByTestId("fork-button").click()

    // My own copy opens.
    await expect(p).not.toHaveURL(new RegExp(`/e/${id}`))
    await expect(p).toHaveURL(/\/e\/[^/?]+$/)
    await expect(p.getByText("Forked: this copy is yours")).toBeVisible()
    await expect(p.getByRole("heading", { level: 1 })).toHaveText(title)
  } finally {
    await anon.context.close()
  }
})

test("the Library links to Explore, and sign-in offers it", async ({
  page,
}) => {
  await page.goto("/sign-in")
  await page.getByRole("link", { name: "Explore public Expeditions" }).click()
  await expect(page).toHaveURL(/\/explore$/)

  await signUp(page)
  await page.goto("/")
  await page.getByTestId("explore-link").click()
  await expect(page).toHaveURL(/\/explore$/)
  await expect(page.getByTestId("library-link")).toBeVisible()
})
