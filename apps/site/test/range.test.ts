// The site Worker's Range handling (worker/range.ts, worker/index.ts).
import { describe, expect, it } from "vitest"

import worker from "../worker/index.ts"
import { MEDIA_CACHE_CONTROL, parseRange, withRanges } from "../worker/range.ts"

const SIZE = 1000
const bytes = new Uint8Array(SIZE).map((_, i) => i % 256)
const ETAG = '"abc123"'
const asset = (status = 200) =>
  new Response(status === 200 ? bytes : "missing", {
    status,
    headers: {
      "Content-Type": "video/mp4",
      ETag: ETAG,
      "Last-Modified": "Mon, 12 Oct 2026 10:00:00 GMT",
      "X-Content-Type-Options": "nosniff",
    },
  })
const get = (headers: Record<string, string> = {}, method = "GET") =>
  new Request("https://seply.app/media/video/explainer.mp4", {
    method,
    headers,
  })

describe("parseRange", () => {
  it.each([
    ["bytes=0-99", { start: 0, end: 99 }],
    ["bytes=0-0", { start: 0, end: 0 }],
    ["bytes=500-", { start: 500, end: 999 }],
    ["bytes=-100", { start: 900, end: 999 }],
    ["bytes=-5000", { start: 0, end: 999 }],
    ["bytes=900-5000", { start: 900, end: 999 }],
    ["BYTES = 1 - 2", { start: 1, end: 2 }],
  ])("%s", (header, expected) => {
    expect(parseRange(header, SIZE)).toEqual(expected)
  })

  it.each(["bytes=1000-", "bytes=1000-1001", "bytes=-0"])(
    "%s is unsatisfiable",
    (header) => {
      expect(parseRange(header, SIZE)).toBe("unsatisfiable")
    }
  )

  it.each([
    null,
    "",
    "bytes=",
    "bytes=-",
    "bytes=5-1",
    "items=0-1",
    "bytes=0-1,5-9",
    "bytes=a-b",
  ])("%s is ignored", (header) => {
    expect(parseRange(header, SIZE)).toBeNull()
  })

  it("finds nothing to serve in an empty file", () => {
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable")
    expect(parseRange("bytes=-1", 0)).toBe("unsatisfiable")
  })
})

describe("withRanges", () => {
  it("answers a range with 206 and the bytes", async () => {
    const res = await withRanges(get({ Range: "bytes=10-19" }), asset())
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Range")).toBe("bytes 10-19/1000")
    expect(res.headers.get("Content-Length")).toBe("10")
    expect(res.headers.get("Accept-Ranges")).toBe("bytes")
    expect(res.headers.get("Content-Type")).toBe("video/mp4")
    expect(res.headers.get("ETag")).toBe(ETAG)
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Cache-Control")).toBe(MEDIA_CACHE_CONTROL)
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ])
  })

  it("answers an open range to the end of the file", async () => {
    const res = await withRanges(get({ Range: "bytes=990-" }), asset())
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Range")).toBe("bytes 990-999/1000")
    expect((await res.arrayBuffer()).byteLength).toBe(10)
  })

  it("answers a suffix range", async () => {
    const res = await withRanges(get({ Range: "bytes=-4" }), asset())
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Range")).toBe("bytes 996-999/1000")
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      996 % 256,
      997 % 256,
      998 % 256,
      999 % 256,
    ])
  })

  it("answers a range past the end with 416", async () => {
    const res = await withRanges(get({ Range: "bytes=1000-" }), asset())
    expect(res.status).toBe(416)
    expect(res.headers.get("Content-Range")).toBe("bytes */1000")
    expect(res.headers.get("Accept-Ranges")).toBe("bytes")
    expect(await res.text()).toBe("")
  })

  it("serves the whole file, saying ranges work, without a Range", async () => {
    const res = await withRanges(get(), asset())
    expect(res.status).toBe(200)
    expect(res.headers.get("Accept-Ranges")).toBe("bytes")
    expect(res.headers.get("Cache-Control")).toBe(MEDIA_CACHE_CONTROL)
    expect(res.headers.get("Content-Range")).toBeNull()
    expect((await res.arrayBuffer()).byteLength).toBe(SIZE)
  })

  it("serves the whole file for several ranges or a malformed one", async () => {
    for (const range of ["bytes=0-1,4-5", "bytes=9-1", "pages=1-2"]) {
      const res = await withRanges(get({ Range: range }), asset())
      expect(res.status).toBe(200)
      expect((await res.arrayBuffer()).byteLength).toBe(SIZE)
    }
  })

  it("honours If-Range only while the file is unchanged", async () => {
    const same = await withRanges(
      get({ Range: "bytes=0-9", "If-Range": ETAG }),
      asset()
    )
    expect(same.status).toBe(206)
    const changed = await withRanges(
      get({ Range: "bytes=0-9", "If-Range": '"other"' }),
      asset()
    )
    expect(changed.status).toBe(200)
    const weak = await withRanges(
      get({ Range: "bytes=0-9", "If-Range": `W/${ETAG}` }),
      asset()
    )
    expect(weak.status).toBe(200)
    const date = await withRanges(
      get({ Range: "bytes=0-9", "If-Range": "Tue, 13 Oct 2026 10:00:00 GMT" }),
      asset()
    )
    expect(date.status).toBe(206)
    const older = await withRanges(
      get({ Range: "bytes=0-9", "If-Range": "Sun, 11 Oct 2026 10:00:00 GMT" }),
      asset()
    )
    expect(older.status).toBe(200)
  })

  it("answers HEAD with the headers and no body", async () => {
    const res = await withRanges(get({ Range: "bytes=0-99" }, "HEAD"), asset())
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Range")).toBe("bytes 0-99/1000")
    expect(res.headers.get("Content-Length")).toBe("100")
    expect(res.body).toBeNull()
  })

  it("answers HEAD without a Range with the file's length", async () => {
    const res = await withRanges(get({}, "HEAD"), asset())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Length")).toBe(String(SIZE))
    expect(res.headers.get("Accept-Ranges")).toBe("bytes")
    expect(res.body).toBeNull()
  })

  it("passes a missing file through", async () => {
    const res = await withRanges(get({ Range: "bytes=0-9" }), asset(404))
    expect(res.status).toBe(404)
    expect(res.headers.get("Accept-Ranges")).toBeNull()
    expect(await res.text()).toBe("missing")
  })

  it("leaves an encoded response whole", async () => {
    const encoded = new Response(bytes, {
      headers: { "Content-Encoding": "gzip" },
    })
    const res = await withRanges(get({ Range: "bytes=0-9" }), encoded)
    expect(res.status).toBe(200)
  })
})

describe("the Worker", () => {
  it("asks the assets for the whole file and answers the Range itself", async () => {
    let seen: Request | undefined
    const env = {
      ASSETS: {
        fetch: (req: Request) => {
          seen = req
          return Promise.resolve(asset())
        },
      },
    }
    const res = await worker.fetch(
      get({ Range: "bytes=0-9", "If-Range": ETAG, "If-None-Match": '"x"' }),
      env
    )
    expect(seen?.headers.get("Range")).toBeNull()
    expect(seen?.headers.get("If-Range")).toBeNull()
    expect(seen?.headers.get("If-None-Match")).toBe('"x"')
    expect(seen?.url).toBe("https://seply.app/media/video/explainer.mp4")
    expect(seen?.method).toBe("GET")
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Range")).toBe("bytes 0-9/1000")
  })

  it("fetches the file with GET for a HEAD", async () => {
    let seen: Request | undefined
    const env = {
      ASSETS: {
        fetch: (req: Request) => {
          seen = req
          return Promise.resolve(asset())
        },
      },
    }
    const res = await worker.fetch(get({}, "HEAD"), env)
    expect(seen?.method).toBe("GET")
    expect(res.headers.get("Content-Length")).toBe(String(SIZE))
    expect(res.body).toBeNull()
  })
})
