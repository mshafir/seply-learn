import { expect, test } from "@playwright/test"

// Signs in with a test account (email + password, enabled only on a localhost
// Worker with AUTH_TEST_CREDENTIALS=1), then creates and lists Expeditions.
// Needs E2E_DATABASE_URL (a migrated Postgres); see playwright.config.ts.
test.skip(
  !process.env.E2E_DATABASE_URL && !process.env.CI,
  "set E2E_DATABASE_URL to a migrated Postgres to run the API tests"
)

test("the Worker reaches its database", async ({ request }) => {
  const res = await request.get("/api/health")
  expect(res.ok()).toBe(true)
  expect(await res.json()).toMatchObject({ ok: true, branch: "e2e" })
})

test("sign in with a test account, create and list an Expedition", async ({
  page,
  baseURL,
}) => {
  const api = page.request
  const headers = { origin: baseURL! }
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const password = "e2e password, long enough"

  // Signed out: the Expedition API refuses.
  expect((await api.get("/api/expeditions")).status()).toBe(401)

  // Make the test account, sign out, then sign in with it.
  const signUp = await api.post("/api/auth/sign-up/email", {
    headers,
    data: { email, password, name: "E2E Tester" },
  })
  expect(signUp.ok()).toBe(true)
  expect(
    (await api.post("/api/auth/sign-out", { headers, data: {} })).ok()
  ).toBe(true)
  expect((await api.get("/api/me")).status()).toBe(401)

  const signIn = await api.post("/api/auth/sign-in/email", {
    headers,
    data: { email, password },
  })
  expect(signIn.ok()).toBe(true)
  const me = await api.get("/api/me")
  expect(await me.json()).toMatchObject({ user: { email } })

  // Create an Expedition: the creator is its owner.
  const title = `E2E Expedition ${Date.now()}`
  const created = await api.post("/api/expeditions", {
    headers,
    data: { title },
  })
  expect(created.status()).toBe(201)
  const expedition = await created.json()
  expect(expedition).toMatchObject({
    title,
    role: "owner",
    visibility: "private",
  })

  // List mine: it's there.
  const list = await api.get("/api/expeditions")
  expect(list.ok()).toBe(true)
  const { expeditions } = await list.json()
  expect(expeditions).toContainEqual(
    expect.objectContaining({ id: expedition.id, title, role: "owner" })
  )
})
