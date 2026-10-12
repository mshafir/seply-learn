// HTTP byte ranges (RFC 9110 §14) for the site's media. Workers static assets
// answer every request with the whole file and no `Accept-Ranges`, and
// Chrome-family browsers then load and seek video unreliably. The Worker
// (index.ts) serves /media/* through `withRanges`.

/** How long browsers and Cloudflare's edge keep media (file names aren't hashed). */
export const MEDIA_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400"

export type ByteRange = { start: number; end: number }

/**
 * Reads a `Range` header against a file of `size` bytes:
 * - a satisfiable single range: `{ start, end }` (inclusive, clamped to the file);
 * - `"unsatisfiable"`: well formed but outside the file (answer 416);
 * - `null`: absent, malformed, not bytes, or several ranges (answer 200 with
 *   the whole file, which RFC 9110 allows for any Range it doesn't honour).
 */
export function parseRange(
  header: string | null,
  size: number
): ByteRange | "unsatisfiable" | null {
  if (!header) return null
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header)
  if (!m) return null
  const [, first, last] = m
  if (first === "" && last === "") return null
  if (first === "") {
    // A suffix: the last n bytes.
    const n = Number(last)
    if (n === 0 || size === 0) return "unsatisfiable"
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(first)
  if (last !== "" && Number(last) < start) return null
  if (start >= size) return "unsatisfiable"
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1)
  return { start, end }
}

/**
 * `If-Range` lets a ranged request through only while the file is unchanged:
 * a strong ETag that matches, or a date no older than Last-Modified.
 */
function ifRangeHolds(ifRange: string | null, response: Response): boolean {
  if (!ifRange) return true
  const value = ifRange.trim()
  if (value.startsWith('"') || value.startsWith("W/")) {
    const etag = response.headers.get("ETag")
    return !value.startsWith("W/") && etag !== null && etag === value
  }
  const lastModified = response.headers.get("Last-Modified")
  if (!lastModified) return false
  const since = Date.parse(value)
  return !Number.isNaN(since) && Date.parse(lastModified) <= since
}

/**
 * Turns a full asset response into the answer to `request`: a 206 with
 * `Content-Range` for a satisfiable Range, a 416 for an unsatisfiable one,
 * else the full response. Every answer for a found file says
 * `Accept-Ranges: bytes` and carries the media Cache-Control. Responses other
 * than 200 (404, 304, redirects) pass through untouched.
 */
export async function withRanges(
  request: Request,
  response: Response
): Promise<Response> {
  if (response.status !== 200) return response
  const headers = new Headers(response.headers)
  headers.set("Accept-Ranges", "bytes")
  headers.set("Cache-Control", MEDIA_CACHE_CONTROL)
  const head = request.method === "HEAD"
  const full = async () => {
    if (!head) return new Response(response.body, { status: 200, headers })
    // HEAD: the length a GET would send (index.ts fetches the asset with GET).
    headers.set(
      "Content-Length",
      String((await response.arrayBuffer()).byteLength)
    )
    return new Response(null, { status: 200, headers })
  }

  const rangeHeader = request.headers.get("Range")
  // Ranges count bytes of the stored file; leave anything encoded on the fly alone.
  if (
    !rangeHeader ||
    !["GET", "HEAD"].includes(request.method) ||
    headers.has("Content-Encoding") ||
    !ifRangeHolds(request.headers.get("If-Range"), response)
  )
    return full()

  const body = await response.arrayBuffer()
  const size = body.byteLength
  const range = parseRange(rangeHeader, size)
  if (range === null) {
    headers.set("Content-Length", String(size))
    return new Response(head ? null : body, { status: 200, headers })
  }
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`)
    headers.set("Content-Length", "0")
    return new Response(null, { status: 416, headers })
  }
  const length = range.end - range.start + 1
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
  headers.set("Content-Length", String(length))
  return new Response(head ? null : body.slice(range.start, range.end + 1), {
    status: 206,
    headers,
  })
}
