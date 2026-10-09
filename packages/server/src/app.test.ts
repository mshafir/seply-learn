import { afterEach, describe, expect, it, vi } from "vitest"
import { readConfig, type ServerEnv } from "./config.ts"
import { Jar, testApp, testDb } from "./test-harness.ts"
import type { ExpeditionSummary } from "./expeditions.ts"

const SECRET = "test-secret-at-least-32-characters-long!!"
const LOCAL = "http://localhost:8787"

const localEnv: ServerEnv = {
  BETTER_AUTH_URL: LOCAL,
  BETTER_AUTH_SECRET: SECRET,
  AUTH_TEST_CREDENTIALS: "1",
  DB_BRANCH: "test",
}

async function signUp(
  app: ReturnType<typeof testApp>,
  jar: Jar,
  origin = LOCAL
) {
  return jar.take(
    await app.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: "ada@example.com",
        password: "correct horse battery staple",
        name: "Ada",
      }),
    })
  )
}

describe("/api/health", () => {
  it("reports an unconfigured database", async () => {
    const app = testApp({ DB_BRANCH: "b" }, null)
    const res = await app.request("/api/health")
    expect(await res.json()).toEqual({
      ok: true,
      db: "unconfigured",
      branch: "b",
    })
  })

  it("queries the database", async () => {
    const app = testApp({ DB_BRANCH: "b" }, await testDb())
    const res = await app.request("/api/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, branch: "b" })
  })
})

describe("/api/map-config", () => {
  it("is empty unless the runtime sets the basemap", async () => {
    const app = testApp(localEnv, null)
    const res = await app.request(`${LOCAL}/api/map-config`)
    expect(await res.json()).toEqual({ tiles: null, assets: null })
  })

  it("passes MAP_TILES_URL and MAP_ASSETS_URL through", async () => {
    const app = testApp(
      {
        ...localEnv,
        MAP_TILES_URL: " /tiles/basemap.pmtiles ",
        MAP_ASSETS_URL: "https://tiles.example.com/assets",
      },
      null
    )
    const res = await app.request(`${LOCAL}/api/map-config`)
    expect(await res.json()).toEqual({
      tiles: "/tiles/basemap.pmtiles",
      assets: "https://tiles.example.com/assets",
    })
  })
})

describe("Expeditions", () => {
  it("need a session", async () => {
    const app = testApp(localEnv, await testDb())
    expect((await app.request("/api/expeditions")).status).toBe(401)
    const post = await app.request("/api/expeditions", {
      method: "POST",
      body: "{}",
    })
    expect(post.status).toBe(401)
    expect((await app.request("/api/me")).status).toBe(401)
  })

  it("are created with the creator as owner, and listed as mine", async () => {
    const db = await testDb()
    const app = testApp(localEnv, db)
    const ada = new Jar()
    expect((await signUp(app, ada)).status).toBe(200)
    const auth = { cookie: ada.header(), origin: LOCAL }

    const me = await app.request("/api/me", { headers: auth })
    expect(await me.json()).toMatchObject({
      user: { email: "ada@example.com" },
    })

    const create = (title: string) =>
      app.request("/api/expeditions", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ title }),
      })
    const first = await create("Compute")
    expect(first.status).toBe(201)
    const created = (await first.json()) as ExpeditionSummary
    expect(created).toMatchObject({
      title: "Compute",
      visibility: "private",
      status: "draft",
      role: "owner",
    })
    await create("Second")

    const list = await app.request("/api/expeditions", { headers: auth })
    const { expeditions } = (await list.json()) as {
      expeditions: ExpeditionSummary[]
    }
    expect(expeditions.map((e) => e.title)).toEqual(["Second", "Compute"])
    expect(expeditions.every((e) => e.role === "owner")).toBe(true)

    // Someone else sees none of them.
    const bob = new Jar()
    await bob.take(
      await app.request(`${LOCAL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: LOCAL },
        body: JSON.stringify({
          email: "bob@example.com",
          password: "another long password",
          name: "Bob",
        }),
      })
    )
    const bobs = await app.request("/api/expeditions", {
      headers: { cookie: bob.header() },
    })
    expect(await bobs.json()).toEqual({ expeditions: [] })
  })

  it("reject a bad body", async () => {
    const app = testApp(localEnv, await testDb())
    const jar = new Jar()
    await signUp(app, jar)
    const res = await app.request("/api/expeditions", {
      method: "POST",
      headers: { cookie: jar.header(), "content-type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(201) }),
    })
    expect(res.status).toBe(400)
  })
})

describe("test credentials", () => {
  it("are off unless the flag is set", () => {
    expect(
      readConfig({ ...localEnv, AUTH_TEST_CREDENTIALS: undefined })
        .testCredentials
    ).toBe(false)
    expect(readConfig(localEnv).testCredentials).toBe(true)
  })

  it("are off on any non-local URL, even with the flag set", async () => {
    const env = {
      ...localEnv,
      BETTER_AUTH_URL: "https://seply-learn.example.workers.dev",
    }
    expect(readConfig(env).testCredentials).toBe(false)
    const app = testApp(env, await testDb())
    const res = await signUp(app, new Jar(), env.BETTER_AUTH_URL)
    expect(res.status).not.toBe(200)
  })
})

// The OAuth proxy round trip (docs/ops/deploy.md): a preview starts Google
// sign-in, Google calls back to production, production hands the encrypted
// profile back to the preview, and the preview creates the session.
describe("Google sign-in through the OAuth proxy", () => {
  const PROD = "https://seply-learn.example.workers.dev"
  const PREVIEW = "https://seply-pr-7.example.workers.dev"
  const shared: ServerEnv = {
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "client-secret",
    AUTH_PROXY_URL: PROD,
    AUTH_TRUSTED_ORIGINS: "https://seply-pr-*.example.workers.dev",
  }
  const prodEnv = { ...shared, BETTER_AUTH_URL: PROD }
  const previewEnv = { ...shared, BETTER_AUTH_URL: PREVIEW }

  afterEach(() => vi.unstubAllGlobals())

  function stubGoogleTokenEndpoint() {
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64url")
    const idToken = [
      b64({ alg: "none", typ: "JWT" }),
      b64({
        iss: "https://accounts.google.com",
        aud: shared.GOOGLE_CLIENT_ID,
        sub: "google-user-1",
        email: "ada@example.com",
        email_verified: true,
        name: "Ada",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
      "",
    ].join(".")
    const realFetch = globalThis.fetch
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.startsWith("https://oauth2.googleapis.com/token"))
          return Response.json({
            access_token: "access",
            id_token: idToken,
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid email profile",
          })
        return realFetch(input, init)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  async function startSignIn(
    app: ReturnType<typeof testApp>,
    jar: Jar,
    origin: string
  ) {
    const res = jar.take(
      await app.request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      })
    )
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    return new URL(url)
  }

  it("sends Google to production's callback, then signs in on the preview", async () => {
    const prodDb = await testDb()
    const previewDb = await testDb()
    const prod = testApp(prodEnv, prodDb)
    const preview = testApp(previewEnv, previewDb)
    const browser = new Jar() // preview cookies

    // 1. The preview starts sign-in: Google gets production's redirect URI.
    const google = await startSignIn(preview, browser, PREVIEW)
    expect(google.origin).toBe("https://accounts.google.com")
    expect(google.searchParams.get("redirect_uri")).toBe(
      `${PROD}/api/auth/callback/google`
    )
    const state = google.searchParams.get("state")!

    // 2. Google calls production back. Production exchanges the code and
    //    redirects to the preview with the encrypted profile.
    const fetchMock = stubGoogleTokenEndpoint()
    const callback = await prod.request(
      `${PROD}/api/auth/callback/google?code=the-code&state=${encodeURIComponent(state)}`
    )
    expect(callback.status).toBe(302)
    const toPreview = new URL(callback.headers.get("location")!)
    expect(toPreview.origin).toBe(PREVIEW)
    expect(toPreview.pathname).toBe("/api/auth/callback/google/oauth-proxy")
    expect(toPreview.searchParams.get("profile")).toBeTruthy()
    const tokenCall = fetchMock.mock.calls.find(([u]) =>
      String(u instanceof Request ? u.url : u).startsWith(
        "https://oauth2.googleapis.com/token"
      )
    )
    expect(tokenCall).toBeDefined()
    // Production must not create the user or a session.
    const prodUsers = await prodDb.query.users.findMany()
    expect(prodUsers).toEqual([])

    // 3. The preview decrypts the profile, creates the user and session.
    const done = browser.take(
      await preview.request(toPreview.toString(), {
        headers: { cookie: browser.header() },
      })
    )
    expect(done.status).toBe(302)
    expect(done.headers.get("location")).toBe("/")

    const me = await preview.request(`${PREVIEW}/api/me`, {
      headers: { cookie: browser.header() },
    })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({
      user: { email: "ada@example.com", name: "Ada" },
    })
    const accounts = await previewDb.query.accounts.findMany()
    expect(accounts).toMatchObject([
      { providerId: "google", accountId: "google-user-1" },
    ])
  })

  it("rejects a tampered profile", async () => {
    const preview = testApp(previewEnv, await testDb())
    const res = await preview.request(
      `${PREVIEW}/api/auth/callback/google/oauth-proxy?callbackURL=%2F&profile=not-encrypted`
    )
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toMatch(/error=invalid_profile/)
    const me = await preview.request(`${PREVIEW}/api/me`)
    expect(me.status).toBe(401)
  })

  it("does not proxy production's own sign-in", async () => {
    const prod = testApp(prodEnv, await testDb())
    const google = await startSignIn(prod, new Jar(), PROD)
    expect(google.searchParams.get("redirect_uri")).toBe(
      `${PROD}/api/auth/callback/google`
    )
  })

  it("uses the local callback when there is no proxy (local dev)", async () => {
    const env = {
      ...localEnv,
      GOOGLE_CLIENT_ID: shared.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: shared.GOOGLE_CLIENT_SECRET,
    }
    const app = testApp(env, await testDb())
    const google = await startSignIn(app, new Jar(), LOCAL)
    expect(google.searchParams.get("redirect_uri")).toBe(
      `${LOCAL}/api/auth/callback/google`
    )
  })
})
