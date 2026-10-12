// The desktop app's sign-in through the browser (spec §10.3, WP-8.2): a
// handoff token is single-use, short-lived, bound to the app's verifier, and
// gives the app a session of its own.
import { afterEach, describe, expect, it, vi } from "vitest"
import { HANDOFF_TTL_MS, sha256Url } from "./desktop-handoff.ts"
import {
  Jar,
  signUp,
  TEST_ENV,
  TEST_ORIGIN,
  testApp,
  testDb,
  type TestUser,
} from "./test-harness.ts"

type App = ReturnType<typeof testApp>

const VERIFIER = "a-verifier-the-app-made-and-kept-to-itself"

const post = (app: App, path: string, body: unknown, headers = {}) =>
  app.request(`${TEST_ORIGIN}/api/auth/desktop/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: TEST_ORIGIN,
      ...headers,
    },
    body: JSON.stringify(body),
  })

/** The browser's part: a token for the app's challenge. */
async function handoff(app: App, user: TestUser, verifier = VERIFIER) {
  const res = await post(
    app,
    "handoff",
    { challenge: await sha256Url(verifier) },
    user.headers
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as { token: string }).token
}

/** Who a cookie is signed in as; null when nobody. */
async function me(app: App, cookie: string) {
  const res = await app.request("/api/me", { headers: { cookie } })
  if (res.status === 401) return null
  return ((await res.json()) as { user: { id: string } }).user
}

afterEach(() => vi.useRealTimers())

describe("desktop sign-in handoff", () => {
  it("signs the app in as the browser's user, with its own session", async () => {
    const app = testApp(TEST_ENV, await testDb())
    const ada = await signUp(app, "ada")
    const token = await handoff(app, ada)

    const jar = new Jar()
    const res = jar.take(
      await post(app, "session", { token, verifier: VERIFIER })
    )
    expect(res.status).toBe(200)
    expect(await me(app, jar.header())).toMatchObject({ id: ada.id })
    // A session of its own: not the browser's cookie.
    expect(jar.header()).not.toBe(ada.headers.cookie)

    // Signing the app out leaves the browser signed in.
    const out = await app.request(`${TEST_ORIGIN}/api/auth/sign-out`, {
      method: "POST",
      headers: { origin: TEST_ORIGIN, cookie: jar.header() },
    })
    expect(out.status).toBe(200)
    expect(await me(app, jar.header())).toBeNull()
    expect(await me(app, ada.headers.cookie!)).toMatchObject({ id: ada.id })
  })

  it("needs a signed-in browser and a real challenge to start", async () => {
    const app = testApp(TEST_ENV, await testDb())
    const ada = await signUp(app, "ada")
    const challenge = await sha256Url(VERIFIER)
    expect((await post(app, "handoff", { challenge })).status).toBe(401)
    for (const bad of ["", "short", `${challenge}=`, `${challenge}x`, 42])
      expect(
        (await post(app, "handoff", { challenge: bad }, ada.headers)).status,
        String(bad)
      ).toBe(400)
  })

  it("refuses a token the second time", async () => {
    const app = testApp(TEST_ENV, await testDb())
    const token = await handoff(app, await signUp(app, "ada"))
    const body = { token, verifier: VERIFIER }
    expect((await post(app, "session", body)).status).toBe(200)
    const again = await post(app, "session", body)
    expect(again.status).toBe(400)
    expect(again.headers.getSetCookie()).toEqual([])
  })

  it("refuses the wrong verifier, and the token is spent", async () => {
    const app = testApp(TEST_ENV, await testDb())
    const token = await handoff(app, await signUp(app, "ada"))
    const wrong = await post(app, "session", { token, verifier: "not it" })
    expect(wrong.status).toBe(400)
    expect(wrong.headers.getSetCookie()).toEqual([])
    // One try: the right verifier doesn't work afterwards either.
    expect(
      (await post(app, "session", { token, verifier: VERIFIER })).status
    ).toBe(400)
  })

  it("refuses a token made for another app's challenge", async () => {
    const app = testApp(TEST_ENV, await testDb())
    // Somebody else's browser made this one, for their own verifier.
    const theirs = await handoff(app, await signUp(app, "mallory"), "theirs")
    const res = await post(app, "session", {
      token: theirs,
      verifier: VERIFIER,
    })
    expect(res.status).toBe(400)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it("refuses an expired token and one that was never made", async () => {
    const app = testApp(TEST_ENV, await testDb())
    const ada = await signUp(app, "ada")
    expect(
      (await post(app, "session", { token: "made-up", verifier: VERIFIER }))
        .status
    ).toBe(400)

    const token = await handoff(app, ada)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + HANDOFF_TTL_MS + 1000)
    const late = await post(app, "session", { token, verifier: VERIFIER })
    expect(late.status).toBe(400)
    expect(late.headers.getSetCookie()).toEqual([])
  })
})
