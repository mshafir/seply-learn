import { fileURLToPath } from "node:url"
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import { makeOps, ulid } from "@seply/domain"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-5.2: Visibility, public links, Fork and Trash (spec §1.4, §1.8, §3.9).
// Ada imports the compute fixture and shares it by link from the share
// dialog (the Sources warning first). Someone signed out opens the link and
// reads it live: Ada's rename reaches their tab, which stays read-only, and
// the server refuses their push. Made private again, their tab is kicked to
// "not found". Bob, signed in, forks it from the link: his copy has its own
// one-Change History and its own Sources. Ada moves the original to Trash
// (Bob's Fork is untouched) and restores it from the Library.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)

type Person = {
  context: BrowserContext
  page: Page
  /** Room frames this page received, by type. */
  heard: string[]
}

async function person(browser: Browser, name: string | null): Promise<Person> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
  })
  const page = await context.newPage()
  const heard: string[] = []
  page.on("websocket", (ws) => {
    if (!ws.url().endsWith("/live")) return
    ws.on("framereceived", (f) =>
      heard.push((JSON.parse(String(f.payload)) as { t: string }).t)
    )
  })
  if (name) await signUp(page, name)
  return { context, page, heard }
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

const renameButton = (page: Page) =>
  page.getByRole("button", { name: /^Rename the Expedition/ })
const heading = (page: Page) => page.getByRole("heading", { level: 1 })

test("an anonymous reader opens an unlisted link, sees a live edit, and can't write", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const ada = await person(browser, "Ada Lovelace")
  const anon = await person(browser, null)
  try {
    const exp = await importCompute(ada.page)
    const title = (await heading(ada.page).textContent())!.trim()

    // Private: a signed-out reader finds nothing.
    await anon.page.goto(`/e/${exp}`)
    await expect(anon.page.getByText("Expedition not found")).toBeVisible()

    // Ada shares it by link; the dialog warns about the Sources first.
    await ada.page.getByTestId("share-button").click()
    const dialog = ada.page.getByTestId("share-dialog")
    await expect(dialog.getByTestId("expedition-link")).toHaveCount(0)
    await dialog.getByTestId("visibility-select").click()
    await ada.page.getByRole("option", { name: "Anyone with the link" }).click()
    const confirm = dialog.getByTestId("confirm-visibility")
    await expect(confirm).toContainText(
      "Anyone who can view can also see the Sources."
    )
    await confirm.getByRole("button", { name: "Share the link" }).click()
    const link = dialog.getByTestId("expedition-link")
    await expect(link).toHaveValue(new RegExp(`/e/${exp}$`))
    await screenshot(ada.page, testInfo, "share-unlisted")
    const path = new URL(await link.inputValue()).pathname
    await ada.page.keyboard.press("Escape")

    // The link opens without signing in: the latest state, read-only.
    await anon.page.goto(path)
    await expect(heading(anon.page)).toHaveText(title)
    await expect(
      anon.page.getByRole("link", { name: "Sign in" }).first()
    ).toBeVisible()
    await expect(renameButton(anon.page)).toHaveCount(0)
    await expect(anon.page.getByTestId("share-button")).toHaveCount(0)
    await expect(anon.page.getByTestId("history-button")).toHaveCount(0)
    await expect(anon.page.getByTestId("suggestions-button")).toHaveCount(0)
    await expect.poll(() => anon.heard.includes("hello")).toBe(true)
    await screenshot(anon.page, testInfo, "anonymous-reader")

    // Ada renames it; the reader's tab follows live, with no reload.
    await anon.page.evaluate(() => {
      ;(window as unknown as { stillHere: boolean }).stillHere = true
    })
    await renameButton(ada.page).click()
    const renamed = `${title} (shared)`
    const input = ada.page.getByLabel("Expedition title")
    await input.fill(renamed)
    await input.press("Enter")
    await expect(heading(ada.page)).toHaveText(renamed)
    await expect(heading(anon.page)).toHaveText(renamed)
    expect(anon.heard).toContain("ops")
    expect(
      await anon.page.evaluate(
        () => (window as unknown as { stillHere?: boolean }).stillHere
      )
    ).toBe(true)

    // The server refuses their writes.
    const push = await anon.page.request.post("/api/push", {
      data: {
        expeditionId: exp,
        ops: makeOps(
          [
            {
              kind: "expedition.set",
              target: exp,
              path: "title",
              value: "Anonymous was here",
            },
          ],
          {
            expeditionId: exp,
            actor: "anonymous",
            changeId: ulid(Date.now()),
            nextOpId: () => ulid(Date.now()),
          }
        ),
      },
    })
    expect(push.status()).toBe(401)
    const share = await anon.page.request.patch(
      `/api/expeditions/${exp}/visibility`,
      { data: { visibility: "public" } }
    )
    expect(share.status()).toBe(401)
    await expect(heading(ada.page)).toHaveText(renamed)

    // Private again: the reader is kicked, and the link stops working.
    await ada.page.getByTestId("share-button").click()
    await dialog.getByTestId("visibility-select").click()
    await ada.page.getByRole("option", { name: "Private" }).click()
    await expect(dialog.getByTestId("expedition-link")).toHaveCount(0)
    await expect.poll(() => anon.heard.includes("kick")).toBe(true)
    await expect(anon.page.getByText("Expedition not found")).toBeVisible()
  } finally {
    await ada.context.close()
    await anon.context.close()
  }
})

test("a Fork has a fresh history and its own Sources; Trash and restore", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const ada = await person(browser, "Ada Lovelace")
  const bob = await person(browser, "Bob Kahn")
  try {
    const exp = await importCompute(ada.page)
    const title = (await heading(ada.page).textContent())!.trim()
    const added = await ada.page.request.post(`/api/sources/${exp}`, {
      data: {
        type: "paste",
        text: "User: what is MLA?\nAssistant: Multi-head latent attention.",
        title: "A chat about MLA",
      },
    })
    expect(added.status()).toBe(201)
    const unlisted = await ada.page.request.patch(
      `/api/expeditions/${exp}/visibility`,
      { data: { visibility: "unlisted" } }
    )
    expect(unlisted.status()).toBe(200)

    // Bob opens the link signed in: he reads it, and can Fork.
    await bob.page.goto(`/e/${exp}`)
    await expect(heading(bob.page)).toHaveText(title)
    await expect(renameButton(bob.page)).toHaveCount(0)
    await bob.page.getByTestId("share-button").click()
    const bobDialog = bob.page.getByTestId("share-dialog")
    await expect(bobDialog.getByTestId("visibility-label")).toHaveText(
      "Anyone with the link"
    )
    await expect(bobDialog.getByTestId("visibility-select")).toHaveCount(0)
    await expect(bobDialog.getByTestId("trash-button")).toHaveCount(0)
    await bobDialog.getByTestId("fork-button").click()
    await expect(bob.page).not.toHaveURL(new RegExp(`/e/${exp}`))
    await expect(bob.page).toHaveURL(/\/e\/[^/]+$/)
    const fork = new URL(bob.page.url()).pathname.split("/")[2]!
    await expect(heading(bob.page)).toHaveText(title)
    // His own: he edits it, and its History has one Change.
    await expect(renameButton(bob.page)).toBeVisible()
    await bob.page.getByTestId("history-button").click()
    const changes = bob.page.getByTestId("change")
    await expect(changes).toHaveCount(1)
    await expect(changes.first().getByTestId("change-label")).toHaveText(
      `Forked from “${title}”`
    )
    await screenshot(bob.page, testInfo, "fork-history")

    // With its own Sources: the chat's text, under the Fork.
    const draft = (await (
      await bob.page.request.get(`/api/expeditions/${fork}/draft`)
    ).json()) as { sources: { id: string; title: string }[] }
    const source = draft.sources.find((s) => s.title === "A chat about MLA")
    expect(source).toBeTruthy()
    const read = await bob.page.request.get(
      `/api/sources/${fork}/${source!.id}`
    )
    expect(read.status()).toBe(200)
    expect(await read.text()).toContain("Multi-head latent attention.")

    // Ada moves the original to Trash; Bob's Fork stays.
    await ada.page.getByTestId("share-button").click()
    const dialog = ada.page.getByTestId("share-dialog")
    await dialog.getByTestId("trash-button").click()
    await dialog
      .getByTestId("confirm-trash")
      .getByRole("button", { name: "Move to Trash" })
      .click()
    await expect(ada.page).toHaveURL(/\/$/)
    const trash = ada.page.getByTestId("trash-card")
    await expect(trash).toHaveCount(1)
    await expect(trash).toContainText(title)
    await expect(trash).toContainText("Deleted for good on")
    await screenshot(ada.page, testInfo, "library-trash")
    expect(
      (await bob.page.request.get(`/api/pull?expedition=${exp}`)).status()
    ).toBe(404)
    expect(
      (await bob.page.request.get(`/api/pull?expedition=${fork}`)).status()
    ).toBe(200)

    // And restores it.
    await trash.getByRole("button", { name: "Restore" }).click()
    await expect(trash).toHaveCount(0)
    await expect(
      ada.page
        .getByRole("list", { name: "Your Expeditions" })
        .getByTestId("expedition-card")
        .filter({ hasText: title })
    ).toHaveCount(1)
    expect(
      (await bob.page.request.get(`/api/pull?expedition=${exp}`)).status()
    ).toBe(200)
  } finally {
    await ada.context.close()
    await bob.context.close()
  }
})
