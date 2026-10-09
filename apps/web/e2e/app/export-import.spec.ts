import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-5.3: export and import (spec §1.9). The Library's Import button takes
// the compute fixture; a pasted chat is added as a Source; the Expedition
// menu's Export downloads our JSON with the Source files (a zip, the box
// ticked by default for the owner), which imports again through the same
// button with the same counts and the Source's file; and the Markdown folder
// downloads as a zip. The round trip and the folder's links are checked in
// depth by the server's and domain's unit tests.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const fixture = (rel: string) =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url))
const COMPUTE = fixture("packages/domain/fixtures/compute.json")
const PASTED_CHAT = readFileSync(
  fixture("packages/server/fixtures/sources/pasted-chat.txt"),
  "utf8"
)
const TITLE = "AI compute & model internals"

/** Imports a file through the Library's Import button; returns the toast. */
async function importThroughButton(page: Page, file: string) {
  await page.goto("/")
  const chooser = page.waitForEvent("filechooser")
  // The header's (a new reader's empty Library shows the same actions again).
  await page.getByRole("banner").getByRole("button", { name: "Import" }).click()
  await (await chooser).setFiles(file)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  return page.getByRole("dialog", { name: /^Imported/ })
}

/** Opens Export from the Expedition menu. */
async function openExport(page: Page) {
  await page.getByTestId("expedition-menu").click()
  await page.getByRole("menuitem", { name: "Export…" }).click()
  const dialog = page.getByTestId("export-dialog")
  await expect(dialog).toBeVisible()
  return dialog
}

test("import from the Library, export JSON with Sources and Markdown, import again", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1280, height: 860 })
  await signUp(page)

  // Import: the Library's button, through the file chooser.
  const imported = await importThroughButton(page, COMPUTE)
  await expect(imported).toContainText(
    "201 Concepts, 425 Relationships, 12 Views, 1 Source."
  )
  await expect(
    page.getByRole("banner").getByRole("heading", { name: TITLE })
  ).toBeVisible()
  const id = new URL(page.url()).pathname.split("/").pop()!

  // A Source with a stored file: a pasted chat.
  const added = await page.request.post(`/api/sources/${id}`, {
    data: { type: "paste", title: "A pasted chat", text: PASTED_CHAT },
  })
  expect(added.status()).toBe(201)

  // Export, JSON: Source files are included by default for the owner.
  let dialog = await openExport(page)
  await expect(dialog.getByRole("heading")).toHaveText(`Export ${TITLE}`)
  await expect(
    dialog.getByTestId("export-format-json").getByRole("radio")
  ).toBeChecked()
  await expect(dialog.getByTestId("export-sources")).toBeChecked()
  await screenshot(page, testInfo, "export-dialog")
  let download = page.waitForEvent("download")
  await dialog.getByTestId("export-download").click()
  const bundle = await download
  expect(bundle.suggestedFilename()).toBe(`${TITLE}.zip`)
  const bundlePath = testInfo.outputPath("bundle.zip")
  await bundle.saveAs(bundlePath)
  expect([...readFileSync(bundlePath).subarray(0, 4)]).toEqual([
    0x50, 0x4b, 0x03, 0x04,
  ])
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole("dialog", { name: `Exported ${TITLE}` })
  ).toContainText("with 1 Source file")

  // Without the box: our JSON alone.
  dialog = await openExport(page)
  await dialog.getByTestId("export-sources").click()
  await expect(dialog.getByTestId("export-sources")).not.toBeChecked()
  download = page.waitForEvent("download")
  await dialog.getByTestId("export-download").click()
  const json = await download
  expect(json.suggestedFilename()).toBe(`${TITLE}.json`)
  const jsonPath = testInfo.outputPath("expedition.json")
  await json.saveAs(jsonPath)
  const doc = JSON.parse(readFileSync(jsonPath, "utf8")) as {
    schemaVersion: number
    concepts: unknown[]
    sources: unknown[]
  }
  expect(doc.schemaVersion).toBe(1)
  expect(doc.concepts).toHaveLength(201)
  expect(doc.sources).toHaveLength(2)

  // The Markdown folder: a zip; no Source files box.
  dialog = await openExport(page)
  await dialog.getByTestId("export-format-markdown").click()
  await expect(dialog.getByTestId("export-sources")).toHaveCount(0)
  download = page.waitForEvent("download")
  await dialog.getByTestId("export-download").click()
  const markdown = await download
  expect(markdown.suggestedFilename()).toBe(`${TITLE} (Markdown).zip`)
  const markdownPath = testInfo.outputPath("markdown.zip")
  await markdown.saveAs(markdownPath)
  expect([...readFileSync(markdownPath).subarray(0, 4)]).toEqual([
    0x50, 0x4b, 0x03, 0x04,
  ])

  // The zip with Source files imports through the same button: same counts,
  // and the pasted chat's file came with it.
  const again = await importThroughButton(page, bundlePath)
  await expect(again).toContainText(
    "201 Concepts, 425 Relationships, 12 Views, 2 Sources (1 with its file)."
  )
  const copy = new URL(page.url()).pathname.split("/").pop()!
  expect(copy).not.toBe(id)
  const library = (await (
    await page.request.get("/api/expeditions")
  ).json()) as {
    expeditions: { id: string; counts: { concepts: number; views: number } }[]
  }
  expect(library.expeditions.find((e) => e.id === copy)?.counts).toEqual({
    concepts: 201,
    views: 12,
  })
  expect(errors).toEqual([])
})
