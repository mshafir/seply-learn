import { fileURLToPath } from "node:url"
import { expect, test, type Browser, type Page } from "@playwright/test"
import { makeOps, ulid, type OpBody } from "@seply/domain"
import pg from "pg"

import { needsDatabase, openView, screenshot, signUp } from "./helpers.ts"

// WP-4.2: History. Ada imports the compute fixture and Ed joins as an editor,
// each in their own browser context. Ada renames MLA and rewrites its
// summary; Ed then rewrites the same summary. Ada undoes her Change from the
// History panel: her title goes, Ed's summary stays, and the toast says so
// ("1 edit kept: changed since by Ed"). Both canvases show the old title.
// Then "View as of here" shows Ada's rename again, read-only, and "Restore
// to here" brings that point back as a new Change. Edits go through
// /api/push (editing in place is WP-4.5's); everything else is the UI.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)
const MLA = "Multi-head Latent Attention (MLA)"
const RENAMED = "Latent attention, renamed by Ada"

async function person(browser: Browser, name: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await signUp(page, name)
  const me = await (await page.request.get("/api/me")).json()
  return { context, page, id: me.user.id as string, errors }
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

async function sql<T>(query: string, params: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    return (await db.query(query, params)).rows as T[]
  } finally {
    await db.end()
  }
}

/** One edit, pushed as its own Change with this label. */
async function edit(
  who: { page: Page; id: string },
  expeditionId: string,
  label: string,
  bodies: OpBody[]
) {
  const changeId = ulid(Date.now())
  const res = await who.page.request.post("/api/push", {
    data: {
      expeditionId,
      ops: makeOps(bodies, {
        expeditionId,
        actor: who.id,
        changeId,
        nextOpId: () => ulid(Date.now()),
      }),
      changes: [{ id: changeId, label }],
    },
  })
  expect(res.status()).toBe(200)
}

const node = (page: Page, title: string) =>
  page.getByTestId("canvas-pane").locator(".react-flow__node", {
    hasText: title,
  })

async function openLearningPath(page: Page, expeditionId: string) {
  await page.goto(`/e/${expeditionId}`)
  await openView(page, /Learning path/)
  await expect(page.getByTestId("canvas-pane")).toHaveAttribute(
    "data-settled",
    ""
  )
}

test("undo keeps a later edit by someone else and says so; view as of; restore", async ({
  browser,
}, testInfo) => {
  // Two contexts loading the app cold and a few sync windows.
  test.setTimeout(90_000)
  const ada = await person(browser, "Ada")
  const ed = await person(browser, "Ed")
  try {
    const exp = await importCompute(ada.page)
    await sql(
      "insert into collaborators (expedition_id, user_id, role) values ($1, $2, 'editor')",
      [exp, ed.id]
    )
    const [mla] = await sql<{ id: string; summary: string }>(
      "select id, summary from concepts where expedition_id = $1 and title = $2",
      [exp, MLA]
    )
    const concept = async () =>
      (
        await sql<{ title: string; summary: string }>(
          "select title, summary from concepts where expedition_id = $1 and id = $2",
          [exp, mla!.id]
        )
      )[0]

    await openLearningPath(ada.page, exp)
    await openLearningPath(ed.page, exp)

    // Ada renames MLA and rewrites its summary; then Ed rewrites the summary.
    await edit(ada, exp, "Renamed MLA", [
      { kind: "concept.set", target: mla!.id, path: "title", value: RENAMED },
      {
        kind: "concept.set",
        target: mla!.id,
        path: "summary",
        value: "Ada's summary",
      },
    ])
    await edit(ed, exp, "Rewrote the MLA summary", [
      {
        kind: "concept.set",
        target: mla!.id,
        path: "summary",
        value: "Ed's summary",
      },
    ])
    await expect(node(ada.page, RENAMED)).toBeVisible({ timeout: 15_000 })
    await expect(node(ed.page, RENAMED)).toBeVisible({ timeout: 15_000 })

    // Ada opens History: newest first, with author, label and time.
    await ada.page.getByTestId("history-button").click()
    const panel = ada.page.getByTestId("side-panel")
    await expect(panel.getByTestId("panel-eyebrow")).toHaveText("History")
    const changes = panel.getByTestId("change")
    await expect(changes.nth(0)).toContainText("Rewrote the MLA summary")
    await expect(changes.nth(0).getByTestId("change-meta")).toHaveText(
      /^Ed · (just now|\dm ago)$/
    )
    const adas = changes.filter({
      has: ada.page.getByTestId("change-label").getByText("Renamed MLA", {
        exact: true,
      }),
    })
    await expect(adas.getByTestId("change-meta")).toHaveText(/^You · /)
    await expect(changes.filter({ hasText: "Imported from file" })).toHaveCount(
      1
    )
    await screenshot(ada.page, testInfo, "history-panel")

    // Undo Ada's Change: her title goes, Ed's summary is kept and reported.
    await adas.getByRole("button", { name: "Undo" }).click()
    const toast = ada.page.getByRole("dialog", {
      name: "Undid “Renamed MLA”",
    })
    await expect(toast).toContainText("1 edit kept: changed since by Ed")
    await screenshot(ada.page, testInfo, "history-undo-kept")
    await expect(node(ada.page, MLA)).toBeVisible()
    await expect(node(ed.page, MLA)).toBeVisible({ timeout: 15_000 })
    await expect.poll(concept).toEqual({ title: MLA, summary: "Ed's summary" })
    // The undo is a Change of its own, at the top.
    await expect(changes.nth(0)).toContainText("Undid “Renamed MLA”")
    await expect(changes.nth(0).getByTestId("change-meta")).toHaveText(
      /^You · /
    )

    // View as of Ada's rename: read-only, as it was then.
    await adas.getByRole("button", { name: "View as of here" }).click()
    const banner = ada.page.getByTestId("as-of-banner")
    await expect(banner).toContainText("As of “Renamed MLA”")
    await expect(node(ada.page, RENAMED)).toBeVisible()
    await expect(adas).toHaveAttribute("aria-current", "true")
    await screenshot(ada.page, testInfo, "history-as-of")
    // Nothing was written.
    expect((await concept())!.title).toBe(MLA)
    await banner.getByRole("button", { name: "Back to latest" }).click()
    await expect(banner).toHaveCount(0)
    await expect(node(ada.page, MLA)).toBeVisible()

    // Restore to here: that point comes back, as a new Change.
    await adas.getByRole("button", { name: "Restore to here" }).click()
    await expect(
      ada.page.getByRole("dialog", { name: "Restored to “Renamed MLA”" })
    ).toBeVisible()
    await expect(node(ada.page, RENAMED)).toBeVisible()
    await expect
      .poll(concept)
      .toEqual({ title: RENAMED, summary: "Ada's summary" })
    await expect(changes.nth(0)).toContainText("Restored to “Renamed MLA”")
    await expect(node(ed.page, RENAMED)).toBeVisible({ timeout: 15_000 })

    expect(ada.errors).toEqual([])
    expect(ed.errors).toEqual([])
  } finally {
    await ada.context.close()
    await ed.context.close()
  }
})

test("viewers have no History", async ({ browser }) => {
  const ada = await person(browser, "Ada")
  const vic = await person(browser, "Vic")
  try {
    const exp = await importCompute(ada.page)
    await sql(
      "insert into collaborators (expedition_id, user_id, role) values ($1, $2, 'viewer')",
      [exp, vic.id]
    )
    await expect(ada.page.getByTestId("history-button")).toBeVisible()
    await vic.page.goto(`/e/${exp}`)
    await expect(vic.page.getByTestId("views-bar")).toBeVisible()
    await expect(vic.page.getByTestId("history-button")).toHaveCount(0)
    const res = await vic.page.request.get(`/api/history?expedition=${exp}`)
    expect(res.status()).toBe(403)
  } finally {
    await ada.context.close()
    await vic.context.close()
  }
})
