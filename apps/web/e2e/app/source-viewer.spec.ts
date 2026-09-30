import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import { makeOps, ulid } from "@seply/domain"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-3.1: a provenance link opens the right turn in the Source viewer.
// Import the compute fixture, add a synthetic pasted chat as a Source
// (POST /api/sources, speaker detection), point GQA's overview at its turn 5
// through /api/push, then open GQA: the badge reads "From the chat, turn 5",
// and clicking it opens the viewer with turn 5 cited and in view. Closing
// returns to the panel. A link opened in a new tab (?source=&segment=) lands
// in the viewer too; an uploaded PDF reads as pages. Light and dark.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const fixture = (path: string) =>
  fileURLToPath(new URL(`../../../../${path}`, import.meta.url))
const COMPUTE = fixture("packages/domain/fixtures/compute.json")
const CHAT = readFileSync(
  fixture("packages/server/fixtures/sources/pasted-chat.txt"),
  "utf8"
)
const PDF = readFileSync(fixture("packages/server/fixtures/sources/sample.pdf"))
const GQA = "Grouped-Query Attention (GQA)"

type Op = { kind: string; target: string; value?: { title?: string } }

/** The id of a Concept, by title, from the Expedition's op log. */
async function conceptId(page: Page, expeditionId: string, title: string) {
  const res = await page.request.get(
    `/api/pull?expedition=${expeditionId}&limit=1000`
  )
  const { ops } = (await res.json()) as { ops: Op[] }
  const op = ops.find(
    (o) => o.kind === "concept.create" && o.value?.title === title
  )
  expect(op, `${title} is in the log`).toBeTruthy()
  return op!.target
}

test("a provenance link opens the cited turn in the Source viewer", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1440, height: 900 })

  await signUp(page)
  const me = (await (await page.request.get("/api/me")).json()) as {
    user: { id: string }
  }
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(COMPUTE)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  const expeditionId = new URL(page.url()).pathname.split("/")[2]!

  // A pasted chat: speaker detection makes six turns.
  const added = await page.request.post(`/api/sources/${expeditionId}`, {
    data: { type: "paste", text: CHAT },
  })
  expect(added.status()).toBe(201)
  const { source, segments } = (await added.json()) as {
    source: { id: string; kind: string; title: string }
    segments: { format: string; count: number }
  }
  expect(source.kind).toBe("chat")
  expect(segments).toMatchObject({ format: "chat-paste", count: 6 })

  // A PDF upload reads as pages.
  const pdf = await page.request.post(`/api/sources/${expeditionId}`, {
    multipart: {
      file: { name: "volcanoes.pdf", mimeType: "application/pdf", buffer: PDF },
    },
  })
  expect(pdf.status()).toBe(201)
  const pdfSource = ((await pdf.json()) as { source: { id: string } }).source

  // GQA's overview now cites turn 5 of the chat.
  const gqa = await conceptId(page, expeditionId, GQA)
  const changeId = ulid(Date.now())
  const ops = makeOps(
    [
      {
        kind: "concept.set",
        target: gqa,
        path: "overviewProv",
        value: [{ source: source.id, segment: "t5" }],
      },
    ],
    {
      expeditionId,
      actor: me.user.id,
      changeId,
      nextOpId: () => ulid(Date.now()),
    }
  )
  const push = await page.request.post("/api/push", {
    data: {
      expeditionId,
      ops,
      changes: [{ id: changeId, label: "Cited the chat" }],
    },
  })
  expect(push.status()).toBe(200)

  await page.reload()
  await page
    .getByTestId("views-rail")
    .getByRole("button", { name: /Techniques/ })
    .click()
  await page
    .getByTestId("canvas-pane")
    .getByRole("rowheader", { name: GQA })
    .click()
  const panel = page.getByTestId("side-panel")
  await expect(panel.getByTestId("panel-title")).toHaveText(GQA)

  const badge = panel.getByTestId("provenance").first()
  await expect(badge).toHaveText("From the chat, turn 5")
  await expect(badge).toHaveAttribute("data-segment", "t5")
  await badge.click()

  const viewer = page.getByTestId("source-viewer")
  await expect(viewer).toBeVisible()
  await expect(
    viewer.getByRole("heading", { name: source.title })
  ).toBeVisible()
  await expect(viewer.getByTestId("source-summary")).toHaveText(
    "Pasted chat · 6 turns"
  )
  await expect(viewer.getByTestId("source-cited")).toHaveText("Cited: Turn 5")
  const turns = viewer.getByTestId("segment")
  await expect(turns).toHaveCount(6)
  const cited = viewer.locator("[data-cited]")
  await expect(cited).toHaveCount(1)
  await expect(cited).toHaveAttribute("data-segment", "t5")
  await expect(cited).toHaveAttribute("data-speaker", "user")
  await expect(cited).toContainText("You")
  await expect(cited).toContainText("Turn 5")
  await expect(cited).toContainText("Why does uniqueness matter?")
  await expect(cited).toBeInViewport()
  await expect(turns.nth(5)).toContainText("fundamental theorem of arithmetic")
  await expect(turns.nth(5)).toHaveAttribute("data-speaker", "assistant")
  await screenshot(page, testInfo, "source-viewer-chat")

  // Closing returns to the panel, as it was.
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)
  await expect(panel.getByTestId("panel-title")).toHaveText(GQA)

  // A link opened in a new tab lands in the viewer: here the PDF's page 2.
  await page.goto(`/e/${expeditionId}?source=${pdfSource.id}&segment=p2`)
  await expect(viewer).toBeVisible()
  await expect(viewer.getByTestId("source-summary")).toHaveText("PDF · 3 pages")
  await expect(viewer.locator("[data-cited]")).toHaveAttribute(
    "data-segment",
    "p2"
  )
  await expect(viewer.locator("[data-cited]")).toContainText("Shield volcanoes")
  await expect(
    viewer.getByRole("link", { name: "Download the file" })
  ).toHaveAttribute("href", `/api/sources/${expeditionId}/${pdfSource.id}/file`)
  await screenshot(page, testInfo, "source-viewer-pdf")

  expect(errors).toEqual([])
})
