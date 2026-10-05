import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import pg from "pg"

import { needsDatabase, openView, screenshot, signUp } from "./helpers.ts"

// WP-4.4: Grow. Ada imports the compute fixture and asks "What would I need
// to understand QLoRA?" from the Ask tab. The model is scripted (the e2e
// Worker runs `grow` jobs with a test-only script; no provider, no key): the
// agent suggests two Concepts and three Relationships, a step at a time.
// They stream into the Ask tab and dashed into the Techniques table while it
// works, and the header counts them. Suggestions shows each new Concept as
// a package with its Relationship to QLoRA. Accept all makes one Change; its Undo
// takes them out again and makes them pending. A second ask is stopped
// mid-way: what streamed is kept, nothing more arrives, and Activity says
// who asked and that it stopped.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)
const ASK = "What would I need to understand QLoRA?"
const NF4 = "NormalFloat (NF4)"
const PAGED = "Paged optimizers"

const concept = (title: string) => ({
  title,
  kind: "builtin:idea",
  summary: `${title}, in one line.`,
  overview: `${title}, explained in one paragraph for someone who knows LoRA.`,
  tags: ["technique"],
  // So they're rows of the Techniques table.
  attributes: { area: "training", effect: "efficiency" },
  prov: [],
})

/** The agent's turns, as the server's test-only GrowScript takes them. */
const QLORA_SCRIPT = {
  delayMs: 700,
  steps: [
    { calls: [{ tool: "concept_create", input: concept(NF4) }] },
    {
      calls: [
        {
          tool: "relationship_add",
          input: { from: "@0", type: "builtin:prerequisite", to: "=QLoRA" },
        },
      ],
    },
    { calls: [{ tool: "concept_create", input: concept(PAGED) }] },
    {
      calls: [
        {
          tool: "relationship_add",
          input: { from: "@1", type: "builtin:prerequisite", to: "=QLoRA" },
        },
        {
          tool: "relationship_add",
          input: {
            from: "=Weight quantization",
            type: "builtin:prerequisite",
            to: "=QLoRA",
          },
        },
      ],
    },
    { text: "Added NF4 and paged optimizers, and linked weight quantization." },
  ],
}

const SLOW_SCRIPT = {
  delayMs: 1_500,
  steps: Array.from({ length: 10 }, (_, i) => ({
    calls: [{ tool: "concept_create", input: concept(`Idea ${i + 1}`) }],
  })),
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

/**
 * Stubs the model: every `grow` job this page starts runs `script` (the
 * Worker honours it only with test credentials on), and the ask's estimate
 * (this account has no key in the BYOK e2e Worker).
 */
async function scriptAsks(page: Page, script: object) {
  await page.route("**/api/ai/estimate/ask", (route) =>
    route.fulfill({
      json: {
        usd: 0.12,
        model: "anthropic/claude-opus-5.5",
        sourceChars: 0,
        askCapUsd: 0.5,
        keySource: "reader",
      },
    })
  )
  await page.route("**/api/expeditions/*/jobs", async (route) => {
    const req = route.request()
    const body = req.method() === "POST" ? req.postDataJSON() : null
    if (body?.kind !== "grow") return route.continue()
    await route.continue({
      postData: JSON.stringify({ ...body, input: { ...body.input, script } }),
    })
  })
}

async function importCompute(page: Page) {
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  await page
    .getByRole("dialog", { name: /^Imported/ })
    .locator("[data-slot=toast-close]")
    .click()
  return new URL(page.url()).pathname.split("/")[2]!
}

const row = (page: Page, title: string) =>
  page.getByTestId("canvas-pane").locator("tr[data-concept]", {
    hasText: title,
  })

test("Grow: an ask streams dashed suggestions; accept all, then undo", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUp(page, "Ada")
  await scriptAsks(page, QLORA_SCRIPT)
  const exp = await importCompute(page)
  await openView(page, /Techniques/)

  // The Ask tab: the box, whose AI it uses and what an ask costs.
  await page.getByTestId("ask-button").click()
  const panel = page.getByTestId("side-panel")
  await expect(panel.getByTestId("panel-title")).toHaveText(
    "Ask about this Expedition"
  )
  await expect(panel.getByTestId("ask-cost")).toContainText(
    "Uses your API key · About $0.12 an ask, at most $0.50 (your cap)"
  )
  await panel.getByLabel("Ask about this Expedition").fill(ASK)
  await panel.getByTestId("ask-submit").click()

  // It streams: the first item arrives while the agent is still working.
  const ask = panel.getByTestId("ask")
  await expect(ask).toHaveCount(1)
  await expect(ask).toContainText(ASK)
  const items = ask.getByTestId("ask-item")
  await expect(items.first()).toContainText(NF4, { timeout: 20_000 })
  await expect(ask).toHaveAttribute("data-status", "running")
  await expect(ask.getByTestId("ask-status")).toContainText("so far")
  // …dashed on the canvas, and counted in the header.
  await expect(row(page, NF4)).toHaveAttribute("data-suggested", "true", {
    timeout: 15_000,
  })
  await screenshot(page, testInfo, "grow-streaming")

  await expect(ask).toHaveAttribute("data-status", "complete", {
    timeout: 30_000,
  })
  await expect(items).toHaveCount(5)
  await expect(ask.getByTestId("ask-status")).toHaveText("Suggested 5 changes")
  await expect(page.getByTestId("suggestions-button")).toHaveAccessibleName(
    "Suggestions · 5"
  )
  await expect(row(page, PAGED)).toHaveAttribute("data-suggested", "true")
  await screenshot(page, testInfo, "grow-done")
  // Nothing was written: the suggestions wait for review.
  const nf4Rows = () =>
    sql<{ deleted: boolean }>(
      "select deleted_at is not null as deleted from concepts where expedition_id = $1 and title = $2",
      [exp, NF4]
    )
  expect(await nf4Rows()).toEqual([])

  // Review them in Suggestions: grouped under the ask; Accept all is one Change.
  await ask.getByTestId("ask-review").click()
  await expect(panel.getByTestId("panel-eyebrow")).toHaveText("Suggestions")
  const group = panel.getByTestId("suggestion-group")
  await expect(group.getByTestId("suggestion-rationale")).toHaveText(ASK)
  // Two Concept packages, each with its Relationship to QLoRA, and the
  // Relationship between Concepts already here.
  await expect(group.getByTestId("suggestion")).toHaveCount(3)
  const packages = group.locator("[data-testid=suggestion][data-entry=package]")
  await expect(packages).toHaveCount(2)
  await expect(
    packages.first().getByTestId("suggestion-relationship")
  ).toContainText(`${NF4} is needed to understand QLoRA`)
  await screenshot(page, testInfo, "grow-suggestions")
  await group.getByRole("button", { name: "Accept all" }).click()
  const confirm = page.getByTestId("confirm-accept")
  await expect(confirm.getByTestId("confirm-all")).toHaveText(
    "2 new Concepts, with 2 Relationships to Concepts already here" +
      "1 other suggestion"
  )
  await confirm.getByRole("button", { name: "Accept 5" }).click()
  const accepted = page.getByRole("dialog", { name: "Accepted 5 suggestions" })
  await expect(accepted).toBeVisible()
  await expect.poll(nf4Rows).toEqual([{ deleted: false }])
  await expect(page.getByTestId("suggestions-button")).toHaveAccessibleName(
    "Suggestions"
  )

  // Undo: the Concepts go again, and the suggestions are pending once more.
  await accepted.getByRole("button", { name: "Undo" }).click()
  await expect.poll(nf4Rows).toEqual([{ deleted: true }])
  await expect(page.getByTestId("suggestions-button")).toHaveAccessibleName(
    "Suggestions · 5",
    { timeout: 15_000 }
  )
  expect(errors).toEqual([])
})

test("Grow: Stop keeps what streamed, and Activity says who asked", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUp(page, "Ada")
  await scriptAsks(page, SLOW_SCRIPT)
  const exp = await importCompute(page)
  await openView(page, /Techniques/)

  // A Concept action: "Add examples" on QLoRA opens the Ask tab with its ask.
  await page
    .getByTestId("canvas-pane")
    .getByRole("rowheader", { name: "QLoRA", exact: true })
    .click()
  const panel = page.getByTestId("side-panel")
  await expect(panel.getByTestId("panel-title")).toHaveText("QLoRA")
  const actions = panel.getByTestId("grow-actions")
  await expect(actions).toContainText("Add what's missing to understand this")
  await expect(actions).toContainText("Write the article")
  await expect(actions.getByTestId("grow-cost")).toContainText(
    "About $0.12 an ask, at most $0.50 (your cap)"
  )
  await actions.scrollIntoViewIfNeeded()
  await screenshot(page, testInfo, "grow-actions")
  await actions.getByTestId("grow-examples").click()
  const ask = panel.getByTestId("ask")
  await expect(ask).toContainText("Add examples of QLoRA")
  const items = ask.getByTestId("ask-item")
  await expect(items).toHaveCount(2, { timeout: 20_000 })

  // Stop: it stops, what streamed stays, and nothing more arrives.
  await ask.getByTestId("ask-stop").click()
  await expect(ask).toHaveAttribute("data-status", "cancelled")
  const kept = await items.count()
  expect(kept).toBeGreaterThanOrEqual(2)
  await expect(ask.getByTestId("ask-status")).toContainText(
    `Stopped · ${kept} changes kept`
  )
  await page.waitForTimeout(4_000)
  const rows = await sql<{ n: string }>(
    "select count(*) as n from proposal_items where expedition_id = $1",
    [exp]
  )
  expect(Number(rows[0]!.n)).toBe(kept)
  await expect(items).toHaveCount(kept)
  await screenshot(page, testInfo, "grow-stopped")

  // Activity: the ask, who asked, and that it stopped with its suggestions waiting.
  await panel.getByTestId("tab-activity").click()
  const entry = panel.getByTestId("activity-ask")
  await expect(entry).toHaveCount(1)
  await expect(entry).toContainText("Add examples of QLoRA")
  await expect(entry).toContainText("Stopped")
  await expect(entry).toContainText(`You · `)
  await expect(entry).toContainText(`${kept} waiting`)
  await screenshot(page, testInfo, "grow-activity")
  expect(errors).toEqual([])
})
