// The seply-site Worker script. Workers static assets serve the whole site;
// only /media/* reaches this script (`assets.run_worker_first` in
// wrangler.jsonc), so the video can answer HTTP Range requests (range.ts).
// Every other path never runs it.
import { withRanges } from "./range.ts"

type Env = {
  /** The static assets (dist/), as configured in wrangler.jsonc. */
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Ask the assets for the whole file; the Range is answered here.
    const headers = new Headers(request.headers)
    headers.delete("Range")
    headers.delete("If-Range")
    // A HEAD asks for a GET too, so the answer can give the file's length.
    const method = request.method === "HEAD" ? "GET" : request.method
    const asset = await env.ASSETS.fetch(
      new Request(request.url, { method, headers, redirect: "manual" })
    )
    return withRanges(request, asset)
  },
}
