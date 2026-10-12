import { expect, test, type Browser, type Page } from "@playwright/test"

import { needsDatabase, openView, screenshot, signUp } from "./helpers.ts"

// WP-7.5: the live embed (spec §9.3). Ada imports a small synthetic
// Expedition. While it is private, and again while unlisted, /e/:id/embed is
// a 404 for everyone, Ada included. Made public, it renders one View with no
// app chrome: the first View by default, another with ?view=, light or dark
// with ?theme=; clicking a Concept opens a small read-only card, and a link
// opens the full Expedition. seply.app may frame it; another origin may not.
//
// The e2e database is shared by every spec, and a Public Expedition shows up
// in everyone's search with "Include public Expeditions" on. So this spec's
// Expedition has words no other spec searches for (and a per-run token), and
// it goes to Trash at the end, pass or fail.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TITLE = `Embed sampler ${RUN}`
const ROW = `Quillwort lattice ${RUN}`
const ROW_SUMMARY = "A synthetic row for the embed spec, read-only in its card"

/** Two Views: an Outline (the first, so the default) and a Comparison Table. */
const SAMPLE = {
  schemaVersion: 1,
  id: "embed-sample",
  title: TITLE,
  summary: "A synthetic Expedition for the live embed spec.",
  tags: [],
  attributes: [{ id: "grade", label: "Grade", type: "text" }],
  concepts: [
    {
      id: "topic",
      kind: "builtin:idea",
      title: `Bramblefinch topic ${RUN}`,
      tags: ["embed-topic"],
      summary: "The synthetic topic",
    },
    {
      id: "row-a",
      kind: "builtin:idea",
      title: ROW,
      tags: ["embed-row"],
      summary: ROW_SUMMARY,
      attributes: { grade: "first" },
    },
    {
      id: "row-b",
      kind: "builtin:idea",
      title: `Saltmarsh spindle ${RUN}`,
      tags: ["embed-row"],
      summary: "Another synthetic row",
      attributes: { grade: "second" },
    },
  ],
  relationships: [
    { from: "row-a", type: "builtin:part-of", to: "topic" },
    { from: "row-b", type: "builtin:part-of", to: "topic" },
  ],
  views: [
    {
      id: "outline",
      viewType: "outline",
      label: "Outline",
      question: "The sample as one topic.",
      settings: { relationshipTypes: ["builtin:part-of"] },
      settingsVersion: 1,
      status: "ready",
    },
    {
      id: "rows",
      viewType: "comparison-table",
      label: "Rows",
      question: "The sample's rows side by side.",
      settings: {
        rows: { tags: ["embed-row"] },
        columns: [{ attribute: "grade" }],
      },
      settingsVersion: 1,
      status: "ready",
    },
  ],
}

async function importSample(page: Page): Promise<string> {
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles({
    name: "embed-sample.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(SAMPLE)),
  })
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  await page
    .getByRole("dialog", { name: /^Imported/ })
    .locator("[data-slot=toast-close]")
    .click()
  return new URL(page.url()).pathname.split("/")[2]!
}

async function anonymousPage(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 960, height: 640 },
  })
  return { context, page: await context.newPage() }
}

/**
 * Serves the app at a public origin too, proxied to the local server by the
 * test: Chrome won't let a public page frame localhost at all (Private
 * Network Access), so the frame-ancestors check needs both on public origins.
 * The live room's socket isn't proxied; the embed then pulls instead.
 */
async function servePublicly(page: Page, origin: string, local: string) {
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({
      url: `${local}${url.pathname}${url.search}`,
    })
    await route.fulfill({ response })
  })
}

/** A page at `origin` (served by the test, not the network) that frames `src`. */
async function framedFrom(page: Page, origin: string, src: string) {
  await page.route(`${origin}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><iframe id="embed" src="${src}" width="900" height="560"></iframe>`,
    })
  )
  await page.goto(`${origin}/`)
  return page.frameLocator("#embed")
}

test("the embed renders a Public View read-only, refuses private and unlisted ones, and only seply.app may frame it", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const errors: string[] = []
  await signUp(page, "Ada Lovelace")
  const exp = await importSample(page)
  const embedPath = `/e/${exp}/embed`
  const anon = await anonymousPage(browser)
  anon.page.on("pageerror", (err) => errors.push(err.message))
  try {
    // The Rows View's id, from the app's URL.
    await openView(page, /Rows/)
    await expect(page).toHaveURL(/\/e\/[^/]+\/[^/]+$/)
    const rows = new URL(page.url()).pathname.split("/")[3]!

    const setVisibility = async (visibility: string) => {
      const res = await page.request.patch(
        `/api/expeditions/${exp}/visibility`,
        { data: { visibility } }
      )
      expect(res.status()).toBe(200)
    }

    // Private, then unlisted: a 404 for anyone, the owner too.
    for (const visibility of ["private", "unlisted"]) {
      if (visibility !== "private") await setVisibility(visibility)
      for (const who of [page, anon.page]) {
        const res = await who.goto(embedPath)
        expect(res?.status(), `${visibility}`).toBe(404)
        await expect(who.getByTestId("embed-view")).toHaveCount(0)
        await expect(who.locator("body")).toHaveText("Not found")
      }
    }

    // Public: the first View (Outline), with no header, rail or panels.
    await setVisibility("public")
    const res = await anon.page.goto(embedPath)
    expect(res?.status()).toBe(200)
    expect(res?.headers()["content-security-policy"]).toBe(
      "frame-ancestors https://seply.app"
    )
    const footer = anon.page.getByTestId("embed-title")
    await expect(footer).toHaveText(`${TITLE} · Outline`)
    await expect(anon.page.getByTestId("embed-view")).toBeVisible()
    await expect(anon.page.getByTestId("views-bar")).toHaveCount(0)
    await expect(anon.page.getByTestId("side-panel")).toHaveCount(0)
    await expect(anon.page.getByRole("heading", { level: 1 })).toHaveCount(0)
    // The app's own route keeps its (absent) framing policy.
    const app = await anon.page.request.get(`/e/${exp}`)
    expect(app.headers()["content-security-policy"]).toBeUndefined()

    // Another View with ?view=, in the theme ?theme= asks for.
    const theme = testInfo.project.use.colorScheme === "dark" ? "light" : "dark"
    await anon.page.goto(`${embedPath}?view=${rows}&theme=${theme}`)
    await expect(footer).toHaveText(`${TITLE} · Rows`)
    await expect(anon.page.locator("html")).toHaveClass(
      theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/
    )
    // A Concept opens a small read-only card; Escape closes it.
    await anon.page
      .getByTestId("embed-view")
      .getByRole("rowheader", { name: ROW })
      .click()
    const card = anon.page.getByTestId("embed-concept-card")
    await expect(card).toContainText(ROW)
    await expect(card).toContainText(ROW_SUMMARY)
    await expect(card.getByRole("textbox")).toHaveCount(0)
    await screenshot(anon.page, testInfo, "embed")
    await anon.page.keyboard.press("Escape")
    await expect(card).toHaveCount(0)

    // "Open in Seply Learn" goes to the full Expedition, on the same View.
    const open = anon.page.getByRole("link", { name: "Open in Seply Learn" })
    await expect(open).toHaveAttribute("href", `${baseURL}/e/${exp}/${rows}`)
    await expect(open).toHaveAttribute("target", "_blank")

    // Framing: seply.app may, another origin may not.
    const PUBLIC = "https://learn.seply.test"
    await servePublicly(anon.page, PUBLIC, baseURL!)
    const src = `${PUBLIC}${embedPath}?view=${rows}`
    const allowed = await framedFrom(anon.page, "https://seply.app", src)
    await expect(allowed.getByTestId("embed-title")).toHaveText(
      `${TITLE} · Rows`
    )
    // Refused: the embed answers 200 with its policy, and Chrome puts its
    // error page in the frame instead. Chrome's console wording for this
    // changes between versions, and newer ones don't report it to the page,
    // so the frame's own URL is the signal.
    const answered = anon.page.waitForResponse((r) => r.url() === src)
    await framedFrom(anon.page, "https://elsewhere.example", src)
    const refused = await answered
    expect(refused.status()).toBe(200)
    expect(refused.headers()["content-security-policy"]).toBe(
      "frame-ancestors https://seply.app"
    )
    const iframe = await anon.page.locator("#embed").elementHandle()
    await expect
      .poll(async () => (await iframe?.contentFrame())?.url())
      .toMatch(/^chrome-error:/)

    // Private again: a 404 again.
    await setVisibility("private")
    expect((await anon.page.goto(embedPath))?.status()).toBe(404)
    expect(errors).toEqual([])
  } finally {
    await anon.context.close()
    // Out of everyone's way: to Trash, pass or fail.
    const trashed = await page.request.delete(`/api/expeditions/${exp}`)
    expect(trashed.status()).toBe(200)
  }
})
