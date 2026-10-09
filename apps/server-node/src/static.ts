// The SPA (apps/web/dist), as the Worker's static assets serve it: files as
// they are, and index.html for every other path (client-side routes). Only
// GET and HEAD; the API, /mcp and /.well-known/* never get here.
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import type { MiddlewareHandler } from "hono"

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".pmtiles": "application/octet-stream",
}

async function fileAt(root: string, pathname: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const path = resolve(root, `.${decoded}`)
  if (path !== root && !path.startsWith(root + sep)) return null
  try {
    const s = await stat(path)
    return s.isFile() ? { path, size: s.size } : null
  } catch {
    return null
  }
}

export function serveSpa(dist: string): MiddlewareHandler {
  const root = resolve(dist)
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next()
    const pathname = new URL(c.req.url).pathname
    const found = await fileAt(root, pathname)
    const file = found ?? (await fileAt(root, "/index.html"))
    if (!file) return next()
    const ext = extname(file.path)
    const headers: Record<string, string> = {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-length": String(file.size),
      // Hashed build output never changes; everything else is revalidated
      // (index.html, the service worker, the manifest).
      "cache-control":
        found && pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
    }
    if (c.req.method === "HEAD") return new Response(null, { headers })
    const body = Readable.toWeb(createReadStream(file.path)) as ReadableStream
    return new Response(body, { headers })
  }
}
