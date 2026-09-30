import { expect, test, type Route } from "@playwright/test"

import { needsDatabase, screenshot, signUp } from "./helpers.ts"

// WP-3.4: the create flow. New → Sources (paste a chat, upload a file, write
// a prompt, a goal chip, the estimate, remove a Source) → Choose Views (the
// skim's cards, Suggest more, Ask for a specific View, the Concept counter,
// the title) → Save draft → the Library's Drafts → reopen → Create (the build
// job starts on the saved Views and the Expedition opens). The skim is stubbed
// in the browser; the build's model calls fail on the fake key, which is fine:
// only the hand-off is under test here. Light and dark.
test.skip(needsDatabase(), "set E2E_DATABASE_URL to a migrated Postgres")

// A synthetic chat (never a real one).
const CHAT = [
  "You said:",
  "What is a sourdough starter, and why does my bread come out dense?",
  "ChatGPT said:",
  "A starter is a culture of wild yeast and lactic acid bacteria. Dense bread usually means the dough was under-fermented.",
  "You said:",
  "Back up: what is gluten?",
  "ChatGPT said:",
  "Gluten is the protein network, made of glutenins and gliadins, that traps the gas.",
].join("\n")

const NOTES = "# Bake day\n\n## Mix\n\nFlour, water, starter, salt.\n\n## Bulk\n\nFour to six hours at 24 °C.\n"

const view = (id: string, viewType: string, label: string, question: string, why: string, on: boolean) => ({
  id,
  viewType,
  label,
  question,
  why,
  on,
  confidence: "high",
})

const PROPOSED = {
  title: "Sourdough basics",
  summary: "How a sourdough loaf rises, and why it can come out dense.",
  views: [
    view("v-path", "learning-path", "Path to a good loaf", "What do I need to understand first?", "You kept asking “what is…” and “back up”", true),
    view("v-parts", "anatomy", "What's in a loaf", "What is a loaf made of?", "Starter, gluten and gas come up again and again", true),
    view("v-stages", "outline", "The stages", "What happens at each stage of a bake?", "The chat walks through them in order", true),
    view("v-dense", "cause-and-effect", "Why it's dense", "What makes a loaf dense, and what can I change?", "Your first question", false),
    view("v-flours", "comparison-table", "Flours", "How do the flours compare?", "Whole wheat and bread flour behave differently", false),
  ],
}
const MORE = { ...PROPOSED, views: [view("v-lineage", "lineage", "Where it came from", "Where did sourdough baking come from?", "A little history in the notes", false)] }
const ASKED = { ...PROPOSED, views: [view("v-bake-day", "timeline", "Bake day", "When does each step of a bake day happen?", "You asked for a timeline", true)] }

test("Sources → Choose Views → Save draft, then reopen and Create", async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await signUp(page)
  // Bring-your-own-key mode: a (fake) key makes the estimate available; the
  // estimate never decrypts or uses it.
  const key = await page.request.put("/api/ai/keys/anthropic", {
    data: { apiKey: "sk-ant-e2e-not-a-real-key-create" },
  })
  expect(key.status()).toBe(200)

  const skims: { mode: string; goals: string[]; request?: string }[] = []
  await page.route("**/api/expeditions/*/skim", async (route: Route) => {
    const body = route.request().postDataJSON() as { mode: string; goals: string[]; request?: string }
    skims.push(body)
    const skim = body.mode === "more" ? MORE : body.mode === "ask" ? ASKED : PROPOSED
    // A short wait, so the progress shows.
    await new Promise((r) => setTimeout(r, 400))
    await route.fulfill({ json: { skim, run: { ms: 400, usd: 0.008, model: "stub" } } })
  })

  // New: a draft, in the create flow.
  await page.goto("/")
  await page.getByRole("button", { name: "New", exact: true }).click()
  await expect(page).toHaveURL(/\/new\/[0-9A-Z]{26}$/)
  const id = /\/new\/([0-9A-Z]{26})/.exec(page.url())![1]!
  await expect(page.getByRole("heading", { name: "What should this Expedition be about?" })).toBeVisible()
  await expect(page.getByRole("list", { name: "Steps" })).toContainText("Sources")
  const next = page.getByRole("button", { name: "Next: choose Views" })
  await expect(next).toBeDisabled()

  // An AI chat, pasted.
  await page.getByLabel("Just paste in an AI chat").fill(CHAT)
  await page.getByRole("button", { name: "Add this chat" }).click()
  const list = page.getByTestId("source-list")
  await expect(list).toContainText("Pasted chat · 4 turns")

  // A file, through the drop zone's browse input.
  await page.getByRole("tab", { name: "Files" }).click()
  await page.getByLabel("Browse files").setInputFiles({ name: "bake-day.md", mimeType: "text/markdown", buffer: Buffer.from(NOTES) })
  await expect(list).toContainText("Markdown · 2 sections")

  // A prompt, then removed again.
  await page.getByRole("tab", { name: "Just a prompt" }).click()
  await page.getByLabel("What do you want to understand?").fill("How do I bake a lighter loaf?")
  await page.getByRole("button", { name: "Add this prompt" }).click()
  await expect(list.getByRole("listitem")).toHaveCount(3)
  await page.getByRole("button", { name: /^Remove How do I bake/ }).click()
  await expect(list.getByRole("listitem")).toHaveCount(2)
  await expect(page.getByText("Sources in this Expedition · 2")).toBeVisible()

  // A goal chip, and the estimate before continuing.
  await page.getByRole("button", { name: "learn it" }).click()
  await expect(page.getByTestId("estimate")).toContainText(/Estimated cost to build: ~[\d.]+[kM]? tokens, about (\$\d+\.\d\d|under \$0\.01)/)
  await page.evaluate(() => window.scrollTo(0, 0))
  await screenshot(page, testInfo, "create-sources")

  // Next: the skim proposes Views.
  await next.click()
  await expect(page).toHaveURL(new RegExp(`/new/${id}/views$`))
  await expect(page.getByRole("heading", { name: "Here are the questions your Sources raise" })).toBeVisible()
  const cards = page.getByTestId("view-card")
  await expect(cards).toHaveCount(5)
  expect(skims[0]).toMatchObject({ mode: "propose", goals: ["learn"] })
  await expect(page.getByLabel("Title")).toHaveValue("Sourdough basics")
  await expect(page.getByTestId("concept-counter")).toHaveText("0 Concepts found across 2 Sources")
  // The 3 best are pre-selected; the first opens the Expedition.
  const create = page.getByRole("button", { name: /^Create Expedition with/ })
  await expect(create).toHaveText("Create Expedition with 3 Views")
  await expect(cards.first()).toContainText("Opens here")
  await expect(cards.first()).toContainText("Learning path")
  await expect(cards.first()).toContainText("You kept asking")

  // Pick and unpick.
  await page.getByRole("checkbox", { name: "What makes a loaf dense, and what can I change?" }).click()
  await page.getByRole("checkbox", { name: "What is a loaf made of?" }).click()
  await expect(create).toHaveText("Create Expedition with 3 Views")

  // Suggest more, and ask for a specific View.
  await page.getByRole("button", { name: "Suggest more" }).click()
  await expect(cards).toHaveCount(6)
  expect(skims[1]).toMatchObject({ mode: "more" })
  expect(JSON.stringify(skims[1])).toContain("What is a loaf made of?")
  await page.getByLabel("Ask for a specific View").fill("a timeline of a bake day")
  await page.getByRole("button", { name: "Propose it" }).click()
  await expect(cards).toHaveCount(7)
  expect(skims[2]).toMatchObject({ mode: "ask", request: "a timeline of a bake day" })
  await expect(create).toHaveText("Create Expedition with 4 Views")
  await page.getByLabel("Title").fill("Sourdough, from starter to oven")
  await page.evaluate(() => window.scrollTo(0, 0))
  await screenshot(page, testInfo, "create-views")

  // Save draft: back to the Library, under Drafts.
  await page.getByRole("button", { name: "Save draft" }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText("Draft saved")).toBeVisible()
  const drafts = page.getByRole("list", { name: "Drafts" })
  const card = drafts.getByTestId("expedition-card").filter({ hasText: "Sourdough, from starter to oven" })
  await expect(card).toContainText("0 Concepts · 4 Views")

  // Saved: the chosen Views, queued, best first; the title.
  const draft = (await (await page.request.get(`/api/expeditions/${id}/draft`)).json()) as {
    expedition: { title: string; status: string; bestViewId: string }
    views: { id: string; label: string; viewType: string; status: string }[]
    sources: unknown[]
  }
  expect(draft.expedition).toMatchObject({ title: "Sourdough, from starter to oven", status: "draft" })
  expect(draft.sources).toHaveLength(2)
  expect(draft.views.map((v) => [v.viewType, v.status])).toEqual([
    ["learning-path", "queued"],
    ["outline", "queued"],
    ["cause-and-effect", "queued"],
    ["timeline", "queued"],
  ])
  expect(draft.expedition.bestViewId).toBe(draft.views[0]!.id)

  // Reopen the draft: the create flow, with its saved Views (no new skim).
  await card.getByRole("link").click()
  await expect(page).toHaveURL(new RegExp(`/new/${id}$`))
  await expect(list.getByRole("listitem")).toHaveCount(2)
  await page.getByRole("button", { name: "Next: choose Views" }).click()
  await expect(cards).toHaveCount(7)
  await expect(create).toHaveText("Create Expedition with 4 Views")
  const skimsBefore = skims.length
  await page.reload()
  await expect(cards).toHaveCount(7)
  expect(skims.length).toBe(skimsBefore)

  // Create hands the saved draft to the build job and opens the Expedition.
  await create.click()
  await expect(page).toHaveURL(new RegExp(`/e/${id}$`))
  const after = (await (await page.request.get(`/api/expeditions/${id}/draft`)).json()) as {
    expedition: { status: string }
    views: { id: string }[]
  }
  expect(after.expedition.status).not.toBe("draft")
  // Saving again updated the same Views rather than adding more.
  expect(after.views.map((v) => v.id)).toEqual(draft.views.map((v) => v.id))
  const jobs = (await (await page.request.get(`/api/expeditions/${id}/jobs`)).json()) as {
    jobs: { kind: string; input: { viewIds: string[] } }[]
  }
  expect(jobs.jobs).toHaveLength(1)
  expect(jobs.jobs[0]!.kind).toBe("build")
  expect(new Set(jobs.jobs[0]!.input.viewIds)).toEqual(new Set(draft.views.map((v) => v.id)))
})
