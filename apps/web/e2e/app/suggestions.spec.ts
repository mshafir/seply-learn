import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import { makeOps, relKey, ulid, type OpBody } from "@seply/domain"
import pg from "pg"

import { needsDatabase, openView, screenshot, signUp } from "./helpers.ts"

// WP-4.3: Proposals and the Suggestions tab. Ada imports the compute fixture
// and an ask's Proposal is seeded (what WP-4.4's Grow will write): a new
// Concept, a Relationship from it to MLA, and a new MLA summary. The header
// counts them; the tab groups them under the ask, and the canvas draws them
// dashed. Accepting the Relationship includes its new Concept, shown before
// confirming, as one Change. Ada then rewrites MLA's summary herself, so
// the suggested one is stale and shows both versions; she dismisses it,
// and the toast's Undo brings it back. Undoing the accept from History
// makes both items pending again. Last, an MCP Proposal arriving (seeded:
// MCP itself is M5) shows a toast with Review.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)
const MLA = "Multi-head Latent Attention (MLA)"
const PAGED = "Paged KV cache"
const PREREQ = "builtin:prerequisite"
const ASK = "What would I need to understand MLA?"

async function sql<T>(query: string, params: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    return (await db.query(query, params)).rows as T[]
  } finally {
    await db.end()
  }
}

/** A Proposal with items, as an ask (or an agent) would write it. */
async function seedProposal(
  exp: string,
  author: string,
  p: { id: string; origin: "ai" | "mcp"; rationale: string },
  items: { id: string; ops: OpBody[]; base?: Record<string, unknown> }[]
) {
  await sql(
    "insert into proposals (expedition_id, id, author, origin, rationale) values ($1, $2, $3, $4, $5)",
    [exp, p.id, author, p.origin, p.rationale]
  )
  for (const [i, item] of items.entries())
    await sql(
      "insert into proposal_items (expedition_id, id, proposal_id, position, ops, base) values ($1, $2, $3, $4, $5, $6)",
      [
        exp,
        item.id,
        p.id,
        i + 1,
        JSON.stringify(item.ops),
        JSON.stringify(item.base ?? {}),
      ]
    )
}

/** The list is fetched again when the window regains focus. */
const refocus = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event("focus")))

const node = (page: Page, title: string) =>
  page.getByTestId("canvas-pane").locator(".react-flow__node", {
    hasText: title,
  })

test("suggestions: accept with dependencies, stale, dismiss, undo; MCP toast", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUp(page, "Ada")
  const me = (await (await page.request.get("/api/me")).json()).user.id

  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  await page
    .getByRole("dialog", { name: /^Imported/ })
    .locator("[data-slot=toast-close]")
    .click()
  const exp = new URL(page.url()).pathname.split("/")[2]!
  const [mla] = await sql<{ id: string; summary: string }>(
    "select id, summary from concepts where expedition_id = $1 and title = $2",
    [exp, MLA]
  )
  const paged = ulid(Date.now())
  const summaryKey = JSON.stringify(["concept", mla!.id, "summary"])
  await seedProposal(exp, me, { id: "p-ask", origin: "ai", rationale: ASK }, [
    {
      id: "c-paged",
      ops: [
        {
          kind: "concept.create",
          target: paged,
          value: {
            title: PAGED,
            kind: "builtin:idea",
            summary: "Keys and values in fixed-size blocks",
          },
        },
      ],
    },
    {
      id: "r-paged",
      ops: [
        {
          kind: "relationship.add",
          target: relKey(paged, PREREQ, mla!.id),
          value: {},
        },
      ],
    },
    {
      id: "e-mla",
      ops: [
        {
          kind: "concept.set",
          target: mla!.id,
          path: "summary",
          value: "Compresses keys and values into a small latent",
        },
      ],
      base: { [summaryKey]: mla!.summary },
    },
  ])

  await openView(page, /Learning path/)
  await refocus(page)
  const button = page.getByTestId("suggestions-button")
  await expect(button).toHaveAccessibleName("Suggestions · 3")

  // The tab: grouped by ask, with who asked; the canvas draws them dashed.
  await button.click()
  const panel = page.getByTestId("side-panel")
  await expect(panel.getByTestId("panel-eyebrow")).toHaveText("Suggestions")
  await expect(panel.getByTestId("panel-title")).toHaveText("3 suggestions")
  const group = panel.getByTestId("suggestion-group")
  await expect(group).toHaveCount(1)
  await expect(group.getByTestId("suggestion-rationale")).toHaveText(ASK)
  await expect(group).toContainText("Your ask")
  const item = (id: string) =>
    panel.locator(`[data-testid=suggestion][data-item-id="${id}"]`)
  await expect(item("c-paged")).toContainText(`New Concept${PAGED}`)
  await expect(item("r-paged")).toContainText(
    `${PAGED} is needed to understand ${MLA}`
  )
  await expect(
    node(page, MLA).locator("[data-concept]").first()
  ).toHaveAttribute("data-suggested", "true", {
    timeout: 15_000,
  })
  await screenshot(page, testInfo, "suggestions-tab")

  // Accept the Relationship: its new Concept comes too, shown first.
  await item("r-paged").getByRole("button", { name: "Accept" }).click()
  const confirm = page.getByTestId("confirm-accept")
  await expect(confirm.getByTestId("confirm-added")).toContainText(PAGED)
  await screenshot(page, testInfo, "suggestions-dependencies")
  await confirm.getByRole("button", { name: "Accept 2" }).click()
  await expect(
    page.getByRole("dialog", { name: "Accepted 2 suggestions" })
  ).toBeVisible()
  const pagedRow = () =>
    sql<{ deleted: boolean }>(
      "select deleted_at is not null as deleted from concepts where expedition_id = $1 and id = $2",
      [exp, paged]
    )
  await expect.poll(pagedRow).toEqual([{ deleted: false }])
  await expect(button).toHaveAccessibleName("Suggestions · 1")
  await expect(panel.getByTestId("suggestion")).toHaveCount(1)

  // Ada rewrites the summary herself: the suggestion is stale, both versions.
  const changeId = ulid(Date.now())
  const res = await page.request.post("/api/push", {
    data: {
      expeditionId: exp,
      ops: makeOps(
        [
          {
            kind: "concept.set",
            target: mla!.id,
            path: "summary",
            value: "Ada's own summary",
          },
        ],
        {
          expeditionId: exp,
          actor: me,
          changeId,
          nextOpId: () => ulid(Date.now()),
        }
      ),
      changes: [{ id: changeId, label: "Rewrote the MLA summary" }],
    },
  })
  expect(res.status()).toBe(200)
  await expect(item("e-mla")).toHaveAttribute("data-stale", "changed", {
    timeout: 15_000,
  })
  await expect(item("e-mla")).toContainText("Changed since suggested")
  await expect(item("e-mla").getByTestId("stale-now")).toContainText(
    "Ada's own summary"
  )
  await expect(item("e-mla").getByTestId("stale-suggested")).toHaveText(
    "Compresses keys and values into a small latent"
  )
  await screenshot(page, testInfo, "suggestions-stale")

  // Dismiss it: recorded, nothing changes; the toast's Undo brings it back.
  await item("e-mla").getByRole("button", { name: "Dismiss" }).click()
  const dismissed = page.getByRole("dialog", { name: "Dismissed 1 suggestion" })
  await expect(dismissed).toBeVisible()
  await expect(panel).toContainText("Nothing to review")
  await expect(button).toHaveAccessibleName("Suggestions")
  await expect
    .poll(() =>
      sql<{ status: string }>(
        "select status from proposal_items where expedition_id = $1 and id = 'e-mla'",
        [exp]
      )
    )
    .toEqual([{ status: "dismissed" }])
  await dismissed.getByRole("button", { name: "Undo" }).click()
  await expect(item("e-mla")).toBeVisible()
  await expect(button).toHaveAccessibleName("Suggestions · 1")

  // Undo the accept from History: one Change; its items are pending again.
  await page.getByTestId("history-button").click()
  const accepted = panel
    .getByTestId("change")
    .filter({ hasText: "Accepted 2 suggestions" })
  await expect(accepted).toHaveCount(1)
  await accepted.getByRole("button", { name: "Undo" }).click()
  await expect(
    page.getByRole("dialog", { name: "Undid “Accepted 2 suggestions”" })
  ).toBeVisible()
  await expect.poll(pagedRow).toEqual([{ deleted: true }])
  await expect(button).toHaveAccessibleName("Suggestions · 3")

  // An MCP agent's Proposal arrives: a toast, and Review opens the tab.
  await panel.getByRole("button", { name: "Close" }).click()
  await seedProposal(
    exp,
    me,
    { id: "p-mcp", origin: "mcp", rationale: "From a coding session" },
    [
      {
        id: "m-1",
        ops: [
          {
            kind: "concept.create",
            target: ulid(Date.now()),
            value: { title: "FlashAttention", kind: "builtin:idea" },
          },
        ],
      },
    ]
  )
  await refocus(page)
  const mcp = page.getByRole("dialog", {
    name: "Your agent (via MCP) suggested 1 Concept",
  })
  await expect(mcp).toContainText("From a coding session")
  await screenshot(page, testInfo, "suggestions-mcp-toast")
  await mcp.getByRole("button", { name: "Review" }).click()
  await expect(panel.getByTestId("suggestion-group")).toHaveCount(2)
  await expect(
    panel.locator('[data-proposal-id="p-mcp"]').getByTestId("suggestion-title")
  ).toHaveText("FlashAttention")
  await expect(button).toHaveAccessibleName("Suggestions · 4")

  expect(errors).toEqual([])
})
