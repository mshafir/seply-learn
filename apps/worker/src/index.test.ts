import { describe, expect, it } from "vitest"
import { app } from "./index"

describe("/api/health", () => {
  it("reports an unconfigured database when there is no Hyperdrive binding", async () => {
    const res = await app.request("/api/health", {}, { DB_BRANCH: "test" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      db: "unconfigured",
      branch: "test",
    })
  })

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/nope", {}, {})
    expect(res.status).toBe(404)
  })
})
