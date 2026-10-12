// The live embed's route (spec §9.3; WP-7.5): only Public Expeditions render
// there, whoever asks, and only that route carries the embed's
// frame-ancestors.
import { describe, expect, it } from "vitest"
import { readConfig, type ServerEnv } from "./config.ts"
import {
  signUp,
  TEST_ENV,
  testApp,
  testDb,
  type TestUser,
} from "./test-harness.ts"

const PAGE = "<!doctype html><title>Embed</title>"

async function setup(env: ServerEnv = TEST_ENV, withPage = true) {
  const db = await testDb()
  const pages: string[] = []
  const app = testApp(env, db, undefined, {
    ...(withPage && {
      embedPage: async (_env, req) => {
        pages.push(new URL(req.url).pathname)
        return new Response(PAGE, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            etag: '"static"',
          },
        })
      },
    }),
  })
  const ada = await signUp(app, "ada")
  const created = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id } = (await created.json()) as { id: string }
  const setVisibility = async (visibility: string) => {
    const res = await app.request(`/api/expeditions/${id}/visibility`, {
      method: "PATCH",
      headers: ada.headers,
      body: JSON.stringify({ visibility }),
    })
    expect(res.status).toBe(200)
  }
  const embed = (who: TestUser | null, path = `/e/${id}/embed`) =>
    app.request(path, { headers: who?.headers ?? {} })
  return { app, ada, id, pages, setVisibility, embed }
}

const CSP = "frame-ancestors https://seply.app"

describe("GET /e/:id/embed", () => {
  it("serves the embed page for a Public Expedition, framable only by seply.app", async () => {
    const s = await setup()
    await s.setVisibility("public")
    const res = await s.embed(null, `/e/${s.id}/embed?view=v1&theme=dark`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(PAGE)
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(res.headers.get("content-security-policy")).toBe(CSP)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    // The static file's validators don't apply to a database answer.
    expect(res.headers.get("etag")).toBeNull()
    expect(s.pages).toEqual([`/e/${s.id}/embed`])
    // Signed in or not, the same page.
    expect((await s.embed(s.ada)).status).toBe(200)
  })

  it("is a 404 for private and unlisted Expeditions, even for their owner", async () => {
    const s = await setup()
    for (const visibility of ["private", "unlisted"]) {
      if (visibility !== "private") await s.setVisibility(visibility)
      for (const who of [null, s.ada]) {
        const res = await s.embed(who)
        expect(
          res.status,
          `${visibility}, ${who ? "owner" : "anonymous"}`
        ).toBe(404)
        expect(await res.text()).toBe("Not found")
        // Refusals carry the framing policy too.
        expect(res.headers.get("content-security-policy")).toBe(CSP)
        expect(res.headers.get("cache-control")).toBe("no-store")
      }
    }
    // The page was never read for them.
    expect(s.pages).toEqual([])
    // Unlisted still opens in the app itself (its own read path is unchanged).
    expect(
      (await s.app.request(`/api/pull?expedition=${s.id}&since=0`)).status
    ).toBe(200)
  })

  it("is a 404 once a Public Expedition goes private again, is in Trash, or never existed", async () => {
    const s = await setup()
    await s.setVisibility("public")
    expect((await s.embed(null)).status).toBe(200)
    await s.setVisibility("private")
    expect((await s.embed(null)).status).toBe(404)
    await s.setVisibility("public")
    const trashed = await s.app.request(`/api/expeditions/${s.id}`, {
      method: "DELETE",
      headers: s.ada.headers,
    })
    expect(trashed.status).toBe(200)
    expect((await s.embed(null)).status).toBe(404)
    expect((await s.embed(null, "/e/no-such-expedition/embed")).status).toBe(
      404
    )
  })

  it("is a 404 without a web build", async () => {
    const s = await setup(TEST_ENV, false)
    await s.setVisibility("public")
    const res = await s.embed(null)
    expect(res.status).toBe(404)
    expect(res.headers.get("content-security-policy")).toBe(CSP)
  })

  it("takes its frame-ancestors from EMBED_FRAME_ANCESTORS", async () => {
    const s = await setup({
      ...TEST_ENV,
      EMBED_FRAME_ANCESTORS:
        "https://seply.app, https://*.example.workers.dev http://localhost:4321",
    })
    await s.setVisibility("public")
    expect((await s.embed(null)).headers.get("content-security-policy")).toBe(
      "frame-ancestors https://seply.app https://*.example.workers.dev http://localhost:4321"
    )
  })

  it("leaves every other route's framing policy alone", async () => {
    const s = await setup()
    await s.setVisibility("public")
    for (const path of [
      "/api/health",
      `/api/pull?expedition=${s.id}&since=0`,
      "/.well-known/oauth-authorization-server",
      `/e/${s.id}`,
      `/e/${s.id}/embed/extra`,
    ]) {
      const res = await s.app.request(path)
      expect(res.headers.get("content-security-policy"), path).toBeNull()
    }
  })
})

describe("EMBED_FRAME_ANCESTORS", () => {
  const ancestors = (value?: string) =>
    readConfig({ ...TEST_ENV, EMBED_FRAME_ANCESTORS: value })
      .embedFrameAncestors

  it("defaults to https://seply.app", () => {
    expect(ancestors()).toEqual(["https://seply.app"])
    expect(ancestors(" ")).toEqual(["https://seply.app"])
  })

  it("takes origins, wildcard subdomains, ports and 'self'", () => {
    expect(
      ancestors(
        "'self' https://seply.app,https://*.a.workers.dev http://localhost:*"
      )
    ).toEqual([
      "'self'",
      "https://seply.app",
      "https://*.a.workers.dev",
      "http://localhost:*",
    ])
    expect(ancestors("'none'")).toEqual(["'none'"])
  })

  it("refuses anything that isn't an origin", () => {
    for (const bad of [
      "seply.app",
      "https://seply.app/path",
      "https://seply.app; script-src *",
      "https://seply-pr-*.a.workers.dev",
      "*",
      "javascript:alert(1)",
      "'none' https://seply.app",
    ])
      expect(() => ancestors(bad), bad).toThrow(/EMBED_FRAME_ANCESTORS/)
  })
})
