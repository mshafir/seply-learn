// Email + password sign-in for self-hosted instances (WP-6.1, spec §2.6),
// the sign-in options the sign-in screen reads, and the SMTP mail config.
import { describe, expect, it } from "vitest"
import { ConfigError, readConfig, type ServerEnv } from "./config.ts"
import { Jar, testApp, testDb } from "./test-harness.ts"

const ORIGIN = "https://learn.example.com"
/** A deployed (non-localhost) instance: test credentials never apply. */
const SELF_HOST: ServerEnv = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!!",
  AUTH_EMAIL_PASSWORD: "1",
}

const post = (
  app: ReturnType<typeof testApp>,
  path: string,
  body: unknown,
  jar?: Jar
) =>
  app.request(`${ORIGIN}/api/auth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(jar?.size && { cookie: jar.header() }),
    },
    body: JSON.stringify(body),
  })

const account = {
  email: "ada@example.com",
  password: "correct horse battery staple",
  name: "Ada",
}

describe("email + password sign-in", () => {
  it("signs up and signs in on a deployed instance with AUTH_EMAIL_PASSWORD=1", async () => {
    const app = testApp(SELF_HOST, await testDb())
    const jar = new Jar()
    const up = jar.take(await post(app, "sign-up/email", account))
    expect(up.status).toBe(200)
    const me = await app.request(`${ORIGIN}/api/me`, {
      headers: { cookie: jar.header() },
    })
    expect(await me.json()).toMatchObject({
      user: { email: account.email, name: "Ada" },
    })

    const again = new Jar()
    const wrong = await post(app, "sign-in/email", {
      email: account.email,
      password: "not it",
    })
    expect(wrong.status).toBe(401)
    const right = again.take(
      await post(app, "sign-in/email", {
        email: account.email,
        password: account.password,
      })
    )
    expect(right.status).toBe(200)
    expect(
      (
        await app.request(`${ORIGIN}/api/me`, {
          headers: { cookie: again.header() },
        })
      ).status
    ).toBe(200)
  })

  it("is off on a deployed instance without it (hosted: Google only)", async () => {
    const app = testApp(
      { ...SELF_HOST, AUTH_EMAIL_PASSWORD: undefined },
      await testDb()
    )
    const res = await post(app, "sign-up/email", account)
    expect(res.ok).toBe(false)
    const options = await app.request(`${ORIGIN}/api/sign-in-options`)
    expect(await options.json()).toEqual({
      google: true,
      emailPassword: false,
      signUp: false,
    })
  })

  it("keeps sign-up closed with AUTH_EMAIL_SIGNUP=0, while accounts still sign in", async () => {
    const db = await testDb()
    const open = testApp(SELF_HOST, db)
    expect((await post(open, "sign-up/email", account)).status).toBe(200)

    const closed = testApp({ ...SELF_HOST, AUTH_EMAIL_SIGNUP: "0" }, db)
    const res = await post(closed, "sign-up/email", {
      ...account,
      email: "ed@example.com",
    })
    expect(res.ok).toBe(false)
    const signIn = await post(closed, "sign-in/email", {
      email: account.email,
      password: account.password,
    })
    expect(signIn.status).toBe(200)
    expect(
      await (await closed.request(`${ORIGIN}/api/sign-in-options`)).json()
    ).toEqual({ google: false, emailPassword: true, signUp: false })
  })

  it("offers both when Google is configured too", async () => {
    const app = testApp(
      {
        ...SELF_HOST,
        GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "secret",
      },
      null
    )
    expect(
      await (await app.request(`${ORIGIN}/api/sign-in-options`)).json()
    ).toEqual({ google: true, emailPassword: true, signUp: true })
  })

  it("has no UI under test credentials alone (they're for API tests)", async () => {
    const app = testApp(
      {
        BETTER_AUTH_URL: "http://localhost:8787",
        BETTER_AUTH_SECRET: SELF_HOST.BETTER_AUTH_SECRET,
        AUTH_TEST_CREDENTIALS: "1",
      },
      null
    )
    expect(
      await (
        await app.request("http://localhost:8787/api/sign-in-options")
      ).json()
    ).toMatchObject({ google: true, emailPassword: false })
  })
})

describe("SMTP mail config", () => {
  const base: ServerEnv = {
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: SELF_HOST.BETTER_AUTH_SECRET,
  }

  it("is selected by SMTP_HOST, with STARTTLS on 587 by default", () => {
    expect(
      readConfig({
        ...base,
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "learn",
        SMTP_PASS: "pw",
        EMAIL_FROM: "Seply Learn <learn@example.com>",
      }).mail
    ).toEqual({
      kind: "smtp",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "learn",
        pass: "pw",
      },
      from: "Seply Learn <learn@example.com>",
    })
  })

  it("uses 465 with SMTP_SECURE=1, and takes an explicit port", () => {
    const env = { ...base, SMTP_HOST: "mail", EMAIL_FROM: "a@b.c" }
    expect(readConfig({ ...env, SMTP_SECURE: "1" }).mail).toMatchObject({
      smtp: { port: 465, secure: true },
    })
    expect(readConfig({ ...env, SMTP_PORT: "2525" }).mail).toMatchObject({
      smtp: { port: 2525, secure: false },
    })
  })

  it("refuses a missing sender, a bad port, or a password without a user", () => {
    const env = { ...base, SMTP_HOST: "mail" }
    expect(() => readConfig(env)).toThrow(ConfigError)
    expect(() => readConfig(env)).toThrow(/EMAIL_FROM/)
    expect(() =>
      readConfig({ ...env, EMAIL_FROM: "a@b.c", SMTP_PORT: "smtp" })
    ).toThrow(/SMTP_PORT/)
    expect(() =>
      readConfig({ ...env, EMAIL_FROM: "a@b.c", SMTP_PASS: "pw" })
    ).toThrow(/SMTP_USER/)
  })

  it("loses to Resend, and to test credentials (which only log)", () => {
    const env = { ...base, SMTP_HOST: "mail", EMAIL_FROM: "a@b.c" }
    expect(readConfig({ ...env, RESEND_API_KEY: "re_x" }).mail?.kind).toBe(
      "resend"
    )
    expect(
      readConfig({
        ...env,
        BETTER_AUTH_URL: "http://localhost:3000",
        AUTH_TEST_CREDENTIALS: "1",
      }).mail
    ).toEqual({ kind: "log" })
  })

  it("is none without SMTP_HOST or Resend", () => {
    expect(readConfig(base).mail).toBeNull()
  })
})
