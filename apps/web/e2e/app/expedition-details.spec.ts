import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import { makeOps, ulid, type OpBody } from "@seply/domain"
import pg from "pg"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// Issue #139: the Expedition's title, summary and Tags. Ada imports the
// compute fixture, which carries a #synthetic Tag (pushed as an ordinary
// edit). The pencil next to the title opens the details: she removes
// #synthetic, adds #ml and rewrites the summary, and History has the edit.
// Then an agent's suggestion to change the summary and Tags (seeded, as MCP
// propose_changes writes it) is accepted from the Suggestions tab like any
// other: one Change, and the Expedition reads the new summary.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)

async function sql<T>(query: string, params: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    return (await db.query(query, params)).rows as T[]
  } finally {
    await db.end()
  }
}

const tagsOf = async (exp: string) =>
  (
    await sql<{ tag: string }>(
      "select tag from expedition_tags where expedition_id = $1 order by tag",
      [exp]
    )
  ).map((r) => r.tag)

const summaryOf = async (exp: string) =>
  (
    await sql<{ summary: string }>(
      "select summary from expeditions where id = $1",
      [exp]
    )
  )[0]?.summary

/** Imports the compute fixture and tags it #synthetic; returns its id and Ada's. */
async function setUp(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUp(page, "Ada")
  const me = (await (await page.request.get("/api/me")).json()).user
    .id as string
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  await page
    .getByRole("dialog", { name: /^Imported/ })
    .locator("[data-slot=toast-close]")
    .click()
  const exp = new URL(page.url()).pathname.split("/")[2]!
  const changeId = ulid(Date.now())
  const res = await page.request.post("/api/push", {
    data: {
      expeditionId: exp,
      ops: makeOps(
        [{ kind: "expedition.tag.add", target: exp, value: "synthetic" }],
        {
          expeditionId: exp,
          actor: me,
          changeId,
          nextOpId: () => ulid(Date.now()),
        }
      ),
      changes: [{ id: changeId, label: "Tagged it" }],
    },
  })
  expect(res.status()).toBe(200)
  await expect.poll(() => tagsOf(exp)).toEqual(["synthetic"])
  return { exp, me }
}

test("expedition details: remove a Tag, add one, rewrite the summary", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  const { exp } = await setUp(page)

  // The pencil sits next to the title; the Expedition menu has it too.
  await page.getByTestId("expedition-menu").click()
  await expect(page.getByTestId("details-item")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByTestId("details-open").click()
  const dialog = page.getByTestId("details-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel("Title")).toHaveValue(
    "AI compute & model internals"
  )
  const chips = dialog.locator("[data-slot=combobox-chip]")
  await expect(chips).toHaveText(["#synthetic"])

  // Remove #synthetic with its ×, add #ml by typing.
  await chips
    .filter({ hasText: "#synthetic" })
    .locator("[data-slot=combobox-chip-remove]")
    .click()
  await expect(chips).toHaveCount(0)
  const tags = dialog.getByLabel("Expedition Tags")
  await tags.fill("#ml")
  await page.getByRole("option", { name: "Add “ml”" }).click()
  await expect(chips).toHaveText(["#ml"])
  // Close the Tag list (clicking elsewhere in the dialog), then the summary.
  await dialog.getByText("Expedition details").click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel("Summary").fill("How compute shapes models.")
  await screenshot(page, testInfo, "expedition-details")
  await dialog.getByTestId("details-save").click()
  await expect(dialog).toBeHidden()

  await expect.poll(() => tagsOf(exp), { timeout: 15_000 }).toEqual(["ml"])
  await expect.poll(() => summaryOf(exp)).toBe("How compute shapes models.")

  // It reopens with what was saved.
  await page.getByTestId("details-open").click()
  await expect(dialog.locator("[data-slot=combobox-chip]")).toHaveText(["#ml"])
  await expect(dialog.getByLabel("Summary")).toHaveValue(
    "How compute shapes models."
  )
  await dialog.getByRole("button", { name: "Cancel" }).click()
  expect(errors).toEqual([])
})

test("expedition details: accept an agent's expedition_update suggestion", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  const { exp, me } = await setUp(page)
  const before = await summaryOf(exp)

  const ops: OpBody[] = [
    {
      kind: "expedition.set",
      target: exp,
      path: "summary",
      value: "What compute costs, and why.",
    },
    { kind: "expedition.tag.add", target: exp, value: "ml" },
    { kind: "expedition.tag.remove", target: exp, value: "synthetic" },
  ]
  await sql(
    "insert into proposals (expedition_id, id, author, origin, rationale) values ($1, $2, $3, $4, $5)",
    [exp, "p-tidy", me, "mcp", "Tidy the showcase"]
  )
  await sql(
    "insert into proposal_items (expedition_id, id, proposal_id, position, ops, base) values ($1, $2, $3, $4, $5, $6)",
    [
      exp,
      "x-exp",
      "p-tidy",
      1,
      JSON.stringify(ops),
      JSON.stringify({
        [JSON.stringify(["exp", exp, "summary"])]: before,
        [JSON.stringify(["exp", exp, "tag:synthetic"])]: true,
      }),
    ]
  )
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  const button = page.getByTestId("suggestions-button")
  await expect(button).toHaveAccessibleName("Suggestions · 1")
  await button.click()
  const panel = page.getByTestId("side-panel")
  const item = panel.locator('[data-testid=suggestion][data-item-id="x-exp"]')
  await expect(item).toContainText("Summary and Tags of the Expedition")
  await expect(item).toContainText(
    "What compute costs, and why. · add #ml, remove #synthetic"
  )
  await screenshot(page, testInfo, "expedition-update-suggestion")
  await item.getByRole("button", { name: "Accept" }).click()
  await expect(
    page.getByRole("dialog", { name: "Accepted 1 suggestion" })
  ).toBeVisible()
  await expect.poll(() => summaryOf(exp)).toBe("What compute costs, and why.")
  await expect.poll(() => tagsOf(exp)).toEqual(["ml"])
  await expect(button).toHaveAccessibleName("Suggestions")

  // Recorded like a person's edit: one Change in History.
  await page.getByTestId("history-button").click()
  await expect(
    panel.getByTestId("change").filter({ hasText: "Accepted 1 suggestion" })
  ).toHaveCount(1)
  expect(errors).toEqual([])
})
