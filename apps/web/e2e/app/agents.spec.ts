import { expect, test, type APIRequestContext } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-5.4: Settings → Connected agents, and an agent at work. A reader makes
// an API token in Settings (its key shown once); an agent uses it on /mcp to
// create an Expedition from a chat (a first build: no model on the server)
// and to suggest a Concept, which shows up in the Suggestions tab as "Your
// agent (via MCP)". Deleting the token locks the agent out. Light and dark.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

/** One stateless MCP tools/call with a Bearer token; the tool's text, or the HTTP status. */
async function mcp(
  request: APIRequestContext,
  key: string,
  name: string,
  args: unknown
): Promise<{ status: number; text: string; isError: boolean }> {
  const res = await request.post("/mcp", {
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
  })
  if (res.status() !== 200)
    return { status: res.status(), text: "", isError: true }
  const raw = await res.text()
  const json = raw.trimStart().startsWith("{")
    ? raw
    : /^data: (.*)$/m.exec(raw)![1]!
  const result = (
    JSON.parse(json) as {
      result: { content: { text: string }[]; isError?: boolean }
    }
  ).result
  return {
    status: 200,
    text: result.content.map((c) => c.text).join("\n"),
    isError: !!result.isError,
  }
}

const BUILD = {
  title: "KV caching",
  summary: "Why language models keep a KV cache.",
  sources: [
    {
      ref: "new:chat",
      title: "A chat about KV caches",
      kind: "chat",
      segments: [
        { id: "t1", speaker: "user", text: "Why do LLMs use a KV cache?" },
        {
          id: "t2",
          speaker: "assistant",
          text: "Each new token attends to all earlier ones; the cache keeps their keys and values so they aren't recomputed.",
        },
      ],
    },
  ],
  concepts: [
    {
      ref: "new:hub",
      title: "KV cache",
      kind: "builtin:topic",
      tags: ["topic"],
      summary: "Reusing attention work.",
    },
    {
      ref: "new:reuse",
      title: "Keys and values are reused",
      kind: "builtin:claim",
      summary: "Earlier tokens' keys and values aren't recomputed.",
      prov: [{ source: "new:chat", segment: "t2" }],
    },
  ],
  relationships: [
    { from: "new:reuse", type: "builtin:part-of", to: "new:hub" },
  ],
  views: [
    {
      viewType: "outline",
      label: "Outline",
      settings: { relationshipTypes: ["builtin:part-of"], rootTag: "topic" },
    },
  ],
}

test("make an API token, let an agent build and suggest, then revoke it", async ({
  page,
}, testInfo) => {
  await signUp(page)
  await page.goto("/settings")
  const agents = page.getByTestId("connected-agents")
  await expect(
    agents.getByLabel("server address", { exact: true })
  ).toHaveValue(/\/mcp$/)

  // A token, named, with every scope, for every Expedition.
  const form = page.getByTestId("new-api-token")
  await form.getByLabel("Name").fill("E2E agent")
  await form.getByRole("button", { name: "Create token" }).click()
  const shown = page.getByTestId("api-token-key")
  await expect(shown).toBeVisible()
  const key = await shown.getByLabel("token", { exact: true }).inputValue()
  expect(key).toMatch(/^sl_/)
  await expect(agents.getByTestId("api-token")).toContainText("E2E agent")
  await screenshot(page, testInfo, "settings-connected-agents")
  // Shown once: a reload lists the token, never its key.
  await page.reload()
  await expect(agents.getByTestId("api-token")).toContainText("E2E agent")
  await expect(page.getByTestId("api-token-key")).toHaveCount(0)

  // The agent: create_expedition, then propose_changes.
  const made = await mcp(page.request, key, "create_expedition", BUILD)
  expect(made.isError, made.text).toBe(false)
  const exp = /\(`([0-9A-Z]{26})`\)/.exec(made.text)![1]!
  const hub = /new:hub → `([0-9A-Z]{26})`/.exec(made.text)![1]!
  const proposed = await mcp(page.request, key, "propose_changes", {
    expedition: exp,
    rationale: "Paged attention cuts the cache's memory waste.",
    items: [
      {
        tool: "concept_create",
        ref: "new:paged",
        input: {
          title: "Paged attention",
          kind: "builtin:idea",
          summary: "Stores the KV cache in fixed-size blocks.",
          overview:
            "Paged attention keeps the KV cache in fixed-size blocks, so long contexts waste less memory.",
          prov: [],
        },
      },
      {
        tool: "relationship_add",
        input: { from: "new:paged", type: "builtin:part-of", to: hub },
      },
    ],
  })
  expect(proposed.isError, proposed.text).toBe(false)

  // The reader sees it in Suggestions, from their agent.
  await page.goto(`/e/${exp}`)
  const button = page.getByTestId("suggestions-button")
  await expect(button).toHaveAccessibleName("Suggestions · 2")
  await button.click()
  const panel = page.getByTestId("side-panel")
  const group = panel.getByTestId("suggestion-group")
  await expect(group).toContainText("Your agent (via MCP)")
  await expect(group.getByTestId("suggestion-rationale")).toHaveText(
    "Paged attention cuts the cache's memory waste."
  )
  await expect(panel.getByTestId("suggestion").first()).toContainText("Paged attention")
  await screenshot(page, testInfo, "agent-suggestions")

  // Revoked: the agent is out at once.
  await page.goto("/settings")
  await agents
    .getByTestId("api-token")
    .getByRole("button", { name: "Delete" })
    .click()
  await expect(agents.getByTestId("api-token")).toHaveCount(0)
  expect((await mcp(page.request, key, "list_expeditions", {})).status).toBe(
    401
  )
})

test("the consent screen has nothing to approve without an agent's request", async ({
  page,
}) => {
  await signUp(page)
  await page.goto("/consent")
  await expect(page.getByTestId("consent")).toContainText("Nothing to approve")
})
