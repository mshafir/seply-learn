import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

// WP-6.2's "done when", short of a paid model call, on a running compose
// instance (playwright.compose.config.ts; scripts/compose-smoke.sh):
//
// 1. The app is healthy and the sign-in screen offers email + password.
// 2. "Create an account" signs a new reader in, through the UI.
// 3. The Library's Import takes the compute fixture.
// 4. A draft gets a pasted chat and a PDF (stored in the blob store: the
//    volume, or the bucket with the s3 profile), one View, and Create: the
//    build starts (202), and its job gets as far as the model call. The
//    smoke's instance key is fake or points at nothing, so the job fails
//    there, with the model's error, not before.
//
// SMOKE_MODEL_ERROR (a regex) is what that failure must say.
//
// With MAP_TILES_FILE set on the instance, a second test opens the trip
// fixture's Map View and checks it reads the extract from this origin.

const fixture = (rel: string) =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url))
const COMPUTE = fixture("packages/domain/fixtures/compute.json")
const PDF = fixture("packages/server/fixtures/sources/sample.pdf")
const TRIP = fixture("packages/domain/fixtures/trip.json")

const CHAT = [
  "You said:",
  "What is a sourdough starter, and why does my bread come out dense?",
  "ChatGPT said:",
  "A starter is a culture of wild yeast and lactic acid bacteria. Dense bread usually means the dough was under-fermented.",
].join("\n")

/** Imports a file through the Library's Import button; returns the toast. */
async function importFile(page: Page, file: string) {
  await page.goto("/")
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("banner").getByRole("button", { name: "Import" }).click()
  await (await chooser).setFiles(file)
  await expect(page).toHaveURL(/\/e\/[^/]+$/)
  return page.getByRole("dialog", { name: /^Imported/ })
}

test("sign up, import a fixture, start a build that reaches the model", async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))

  // 1. Healthy, with email + password sign-in and open sign-up.
  const health = await page.request.get("/api/health")
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true })
  expect(await (await page.request.get("/api/sign-in-options")).json()).toEqual(
    expect.objectContaining({ emailPassword: true, signUp: true })
  )

  // 2. Create an account from the sign-in screen.
  const email = `smoke-${Date.now()}@example.com`
  await page.goto("/")
  await expect(page).toHaveURL(/\/sign-in$/)
  await page.getByRole("button", { name: "Create an account" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Smoke Reader")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page
    .getByLabel("Password", { exact: true })
    .fill("smoke test password, long enough")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
  expect((await (await page.request.get("/api/me")).json()).user).toMatchObject(
    { email }
  )

  // 3. Import the compute fixture through the Library.
  await expect(await importFile(page, COMPUTE)).toContainText(
    "201 Concepts, 425 Relationships, 12 Views, 1 Source."
  )

  // 4. A draft with two Sources and one View, then Create.
  const created = await page.request.post("/api/expeditions", {
    data: { title: "Sourdough" },
  })
  expect(created.status()).toBe(201)
  const id = ((await created.json()) as { id: string }).id
  const pasted = await page.request.post(`/api/sources/${id}`, {
    data: { type: "paste", title: "A pasted chat", text: CHAT },
  })
  expect(pasted.status()).toBe(201)
  const uploaded = await page.request.post(`/api/sources/${id}`, {
    multipart: {
      file: {
        name: "sample.pdf",
        mimeType: "application/pdf",
        buffer: readFileSync(PDF),
      },
    },
  })
  expect(uploaded.status(), await uploaded.text()).toBe(201)
  // The stored file reads back.
  const source = ((await uploaded.json()) as { source: { id: string } }).source
  const file = await page.request.get(`/api/sources/${id}/${source.id}/file`)
  expect(file.status()).toBe(200)
  expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-")

  const plan = await page.request.put(`/api/expeditions/${id}/plan`, {
    data: {
      title: "Sourdough",
      views: [
        {
          viewType: "outline",
          label: "The stages",
          question: "What happens at each stage of a bake?",
        },
      ],
    },
  })
  expect(plan.status(), await plan.text()).toBe(200)
  const build = await page.request.post(`/api/expeditions/${id}/build`, {
    data: {},
  })
  expect(build.status(), await build.text()).toBe(202)
  const { jobId } = (await build.json()) as { jobId: string }

  // The job runs until the model call fails (a fake key, or no server).
  let job: { status: string; error: string | null; step: string | null } = {
    status: "queued",
    error: null,
    step: null,
  }
  await expect
    .poll(
      async () => {
        job = (await (await page.request.get(`/api/jobs/${jobId}`)).json()).job
        return job.status
      },
      { timeout: 150_000, intervals: [1000] }
    )
    .toBe("failed")
  console.log(`build job: ${job.status} at "${job.step}": ${job.error}`)
  expect(job.error).not.toMatch(/no AI (key|configured)/i)
  expect(job.error).toMatch(
    new RegExp(process.env.SMOKE_MODEL_ERROR ?? ".", "i")
  )
  expect(errors).toEqual([])
})

test("the Map View reads the instance's own PMTiles extract", async ({
  page,
}) => {
  const map = await (await page.request.get("/api/map-config")).json()
  test.skip(!map.tiles, "no MAP_TILES_FILE or MAP_TILES_URL on this instance")
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    data: {
      email: `smoke-map-${Date.now()}@example.com`,
      password: "smoke test password, long enough",
      name: "Map Reader",
    },
  })
  expect(signUp.status()).toBe(200)
  const ranges: number[] = []
  page.on("response", (res) => {
    if (res.url().endsWith(map.tiles)) ranges.push(res.status())
  })
  await expect(await importFile(page, TRIP)).toBeVisible()
  await page.keyboard.press("Escape")
  await page
    .getByTestId("views-bar")
    .getByTestId("view-tab")
    .filter({ hasText: "The route" })
    .click()
  await expect.poll(() => ranges.length, { timeout: 20_000 }).toBeGreaterThan(0)
  expect(ranges.every((s) => s === 206)).toBe(true)
  await expect(page.getByText("Protomaps")).toBeVisible()
  await expect(page.getByText("Detailed map unavailable")).toHaveCount(0)
})
