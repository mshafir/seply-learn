import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { serveRangeFile } from "./static.ts"

const dir = mkdtempSync(join(tmpdir(), "seply-tiles-"))
const file = join(dir, "basemap.pmtiles")
writeFileSync(file, "0123456789")

const app = new Hono()
app.on(["GET", "HEAD"], "/tiles/basemap.pmtiles", serveRangeFile(file))
app.on(["GET", "HEAD"], "/missing", serveRangeFile(join(dir, "nope")))

const get = (range?: string, method = "GET") =>
  app.request("/tiles/basemap.pmtiles", {
    method,
    headers: range ? { range } : {},
  })

describe("serveRangeFile (a PMTiles archive)", () => {
  it("serves the whole file without a Range", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("accept-ranges")).toBe("bytes")
    expect(res.headers.get("content-length")).toBe("10")
    expect(await res.text()).toBe("0123456789")
  })

  it("serves byte ranges as 206", async () => {
    const res = await get("bytes=2-5")
    expect(res.status).toBe(206)
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10")
    expect(res.headers.get("content-length")).toBe("4")
    expect(await res.text()).toBe("2345")
    expect(await (await get("bytes=7-")).text()).toBe("789")
    expect(await (await get("bytes=-3")).text()).toBe("789")
    // A range past the end is cut to the file.
    expect(await (await get("bytes=8-99")).text()).toBe("89")
  })

  it("answers HEAD without a body, 416 past the end, 404 without the file", async () => {
    const head = await get("bytes=0-3", "HEAD")
    expect(head.status).toBe(206)
    expect(head.headers.get("content-length")).toBe("4")
    expect(await head.text()).toBe("")
    const past = await get("bytes=10-")
    expect(past.status).toBe(416)
    expect(past.headers.get("content-range")).toBe("bytes */10")
    expect((await app.request("/missing")).status).toBe(404)
  })
})
