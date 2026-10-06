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

// WP-5.1: Collaborators, invites and permissions (spec §1.8, §3.9). Ada
// imports the compute fixture and invites Bob (who has an account) as an
// editor from the share dialog. Bob finds it under "Shared with you" with a
// New badge, opens it and can rename it. Ada makes him a viewer while his tab
// is open: the room kicks him, his tab reopens read-only, and his push is
// refused. Then Ada invites an email with no account yet; Cy signs up under
// another address and accepts through the copied link.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

const COMPUTE = fileURLToPath(
  new URL("../../../../packages/domain/fixtures/compute.json", import.meta.url)
)

type Person = {
  context: BrowserContext
  page: Page
  email: string
  /** Room frames this page received, by type. */
  heard: string[]
}

async function person(browser: Browser, name: string): Promise<Person> {
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
  const { email } = await signUp(page, name)
  return { context, page, email, heard }
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

test("invite a second account, find it under Shared with you, and a viewer can't edit", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const ada = await person(browser, "Ada Lovelace")
  const bob = await person(browser, "Bob Kahn")
  let cy: Person | null = null
  try {
    const exp = await importCompute(ada.page)
    const title = (await ada.page
      .getByRole("heading", { level: 1 })
      .textContent())!.trim()

    // Ada invites Bob as an editor.
    await ada.page.getByTestId("share-button").click()
    const dialog = ada.page.getByTestId("share-dialog")
    await expect(dialog).toContainText(
      "Anyone who can view can also see the Sources."
    )
    await dialog.getByLabel("Invite by email").fill(bob.email)
    await dialog.getByRole("combobox", { name: "Invite as" }).click()
    await ada.page.getByRole("option", { name: "Editor" }).click()
    await dialog.getByRole("button", { name: "Invite", exact: true }).click()
    await expect(dialog.getByTestId("invite-sent")).toContainText(
      "can open it now from Shared with you"
    )
    const people = dialog.getByTestId("share-person")
    await expect(people).toHaveCount(2)
    await expect(people.nth(1)).toContainText("Bob Kahn")
    await screenshot(ada.page, testInfo, "share-dialog")

    // Bob finds it under Shared with you, New.
    await bob.page.goto("/")
    const shared = bob.page.getByRole("list", { name: "Shared with you" })
    const card = shared.getByTestId("expedition-card")
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(title)
    await expect(card.getByTestId("card-new")).toBeVisible()
    await expect(card).toContainText("Editor")
    await screenshot(bob.page, testInfo, "shared-with-you")

    // He opens it and may edit.
    await card.getByRole("link", { name: title }).click()
    await expect(bob.page).toHaveURL(new RegExp(`/e/${exp}`))
    await expect(renameButton(bob.page)).toBeVisible()
    // The room is open: the kick has somewhere to land.
    await expect.poll(() => bob.heard.includes("hello")).toBe(true)

    // Ada makes him a viewer while his tab is open.
    await dialog.getByRole("combobox", { name: "Role of Bob Kahn" }).click()
    await ada.page.getByRole("option", { name: "Viewer" }).click()
    await expect(people.nth(1)).toHaveAttribute("data-role", "viewer")

    // His tab is kicked and reopens read-only, with no reload.
    await expect.poll(() => bob.heard.includes("kick")).toBe(true)
    await expect(
      bob.page.getByText("The owner made you a viewer")
    ).toBeVisible()
    await expect(renameButton(bob.page)).toHaveCount(0)
    await expect(bob.page.getByRole("heading", { level: 1 })).toHaveText(title)
    // And the server refuses his edits.
    const me = await (await bob.page.request.get("/api/me")).json()
    const push = await bob.page.request.post("/api/push", {
      data: {
        expeditionId: exp,
        ops: makeOps(
          [
            {
              kind: "expedition.set",
              target: exp,
              path: "title",
              value: "Bob was here",
            },
          ],
          {
            expeditionId: exp,
            actor: me.user.id as string,
            changeId: ulid(Date.now()),
            nextOpId: () => ulid(Date.now()),
          }
        ),
      },
    })
    expect(push.status()).toBe(403)
    // A viewer may look at who has access, but not invite.
    await bob.page.getByTestId("share-button").click()
    const bobDialog = bob.page.getByTestId("share-dialog")
    await expect(bobDialog.getByTestId("share-person")).toHaveCount(2)
    await expect(bobDialog.getByLabel("Invite by email")).toHaveCount(0)
    await bob.page.keyboard.press("Escape")

    // Opened, it isn't New any more.
    await bob.page.goto("/")
    await expect(
      shared.getByTestId("expedition-card").getByTestId("card-new")
    ).toHaveCount(0)
    await expect(shared.getByTestId("expedition-card")).toContainText("Viewer")

    // An invite to an email with no account: the link lets Cy in once.
    const cyInvited = `e2e-cy-${Date.now()}@example.com`
    await dialog.getByLabel("Invite by email").fill(cyInvited)
    await dialog.getByRole("button", { name: "Invite", exact: true }).click()
    await expect(dialog.getByTestId("invite-sent")).toContainText(
      `Send ${cyInvited} this link`
    )
    const link = await dialog.getByTestId("invite-link").inputValue()
    await expect(dialog.getByTestId("share-invites")).toContainText(cyInvited)

    cy = await person(browser, "Cy Twombly")
    await cy.page.goto(new URL(link).pathname)
    const inviteCard = cy.page.getByTestId("invite-card")
    await expect(inviteCard).toContainText(title)
    await expect(inviteCard).toContainText(
      "Ada Lovelace invited you as an editor"
    )
    await screenshot(cy.page, testInfo, "invite")
    await inviteCard.getByRole("button", { name: "Accept and open" }).click()
    await expect(cy.page).toHaveURL(new RegExp(`/e/${exp}`))
    await expect(renameButton(cy.page)).toBeVisible()
  } finally {
    await ada.context.close()
    await bob.context.close()
    await cy?.context.close()
  }
})
