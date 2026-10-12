import { expect, test } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-5.5: Connect an agent (/connect). A reader picks their agent, sees its
// install commands with this server's address, and a first prompt. With a
// token (an agent that can't sign in), the sign-in step ticks itself when the
// agent makes its first call. From an Expedition, the prompt is about it.
// Light and dark.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

test("the steps for each agent, with this server's address", async ({
  page,
  baseURL,
}, testInfo) => {
  await signUp(page)
  // In from the empty Library.
  await page.goto("/")
  await page.getByTestId("connect-link").click()
  await expect(page).toHaveURL(/\/connect$/)
  const connect = page.getByTestId("connect")
  await expect(
    connect.getByRole("heading", { name: "Connect an agent" })
  ).toBeVisible()

  // Claude Code, on a server that isn't the hosted one: the plugin, the
  // address to give it, and the command without it.
  const install = page.getByTestId("connect-step-2")
  await expect(install).toContainText("Add Seply Learn to Claude Code")
  await expect(
    install.getByLabel("install the plugin", { exact: true })
  ).toHaveValue("claude plugin install seply-learn@seply")
  await expect(
    install.getByLabel("server address for the plugin", { exact: true })
  ).toHaveValue(baseURL!)
  await expect(
    install.getByLabel("add without the plugin", { exact: true })
  ).toHaveValue(`claude mcp add --transport http seply-learn ${baseURL}/mcp`)
  await expect(page.getByTestId("connect-status")).toContainText(
    "Waiting for your agent"
  )
  await screenshot(page, testInfo, "connect-claude-code")

  await connect.getByRole("tab", { name: "Codex" }).click()
  await expect(
    install.getByLabel("add the server", { exact: true })
  ).toHaveValue(`codex mcp add seply-learn --url ${baseURL}/mcp`)
  await expect(page.getByTestId("connect-step-3")).toContainText(
    "codex mcp login seply-learn"
  )

  await connect.getByRole("tab", { name: "Cursor" }).click()
  await expect(
    install.getByRole("link", { name: "Add to Cursor" })
  ).toHaveAttribute(
    "href",
    /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=seply-learn&config=/
  )

  // The choice is remembered.
  await page.reload()
  await expect(connect.getByRole("tab", { name: "Cursor" })).toHaveAttribute(
    "aria-selected",
    "true"
  )

  // With no Expedition in hand, the prompts create one.
  const prompts = page.getByTestId("connect-step-4")
  await expect(
    prompts.getByLabel("prompt", { exact: true }).first()
  ).toHaveValue("Make a Seply Learn Expedition from this conversation.")
})

test("a token's first call ticks the sign-in step", async ({
  page,
}, testInfo) => {
  await signUp(page)
  await page.goto("/connect")
  const connect = page.getByTestId("connect")
  await connect.getByRole("tab", { name: "Other" }).click()
  await connect.getByRole("button", { name: "Create a token" }).click()
  const header = await page
    .getByTestId("connect-token")
    .getByLabel("header", { exact: true })
    .inputValue()
  expect(header).toMatch(/^Authorization: Bearer sl_/)
  await expect(page.getByTestId("connect-status")).toContainText(
    "Waiting for your agent"
  )

  // The agent's first call.
  const res = await page.request.post("/mcp", {
    headers: {
      authorization: header.replace("Authorization: ", ""),
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_expeditions", arguments: {} },
    },
  })
  expect(res.status()).toBe(200)

  await expect(page.getByTestId("connect-status")).toContainText(
    "Connected: My agent",
    { timeout: 15_000 }
  )
  await expect(page.getByTestId("connect-step-3")).toHaveAttribute(
    "data-done",
    "true"
  )
  await screenshot(page, testInfo, "connect-connected")
})

test("from an Expedition, the prompt is about it", async ({ page }) => {
  await signUp(page)
  const made = await page.request.post("/api/expeditions", {
    data: { title: 'The "KV" cache' },
  })
  expect(made.ok()).toBe(true)
  const { id } = (await made.json()) as { id: string }

  await page.goto(`/connect?e=${id}`)
  const prompts = page.getByTestId("connect-step-4")
  await expect(prompts.getByLabel("prompt", { exact: true })).toHaveValue(
    "Read my Seply Learn Expedition “The 'KV' cache” and suggest what's missing."
  )
  await expect(prompts).toContainText("Suggestions")
  await expect(
    prompts.getByRole("link", { name: "Back to the Expedition" })
  ).toHaveAttribute("href", `/e/${id}`)

  // An Expedition the reader can't see: the create prompts, no error.
  await page.goto("/connect?e=01JZZZZZZZZZZZZZZZZZZZZZZZ")
  await expect(
    prompts.getByLabel("prompt", { exact: true }).first()
  ).toHaveValue("Make a Seply Learn Expedition from this conversation.")
})

test("the page still works when the server can't say what it is", async ({
  page,
  baseURL,
}) => {
  await signUp(page)
  await page.route("**/api/instance", (route) => route.abort())
  await page.goto("/connect")
  // The steps that work on any server.
  await expect(
    page
      .getByTestId("connect-step-2")
      .getByLabel("add without the plugin", { exact: true })
  ).toHaveValue(`claude mcp add --transport http seply-learn ${baseURL}/mcp`)
})

test("signed out, it asks to sign in first", async ({ page }) => {
  await page.goto("/connect")
  await expect(page).toHaveURL(/\/sign-in/)
})
