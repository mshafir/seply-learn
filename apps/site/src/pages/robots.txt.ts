// robots.txt: crawl everything and find the sitemap. Previews stay out of
// search results through noindex (meta tag and header), not a Disallow:
// a crawler that can't fetch a page never sees its noindex.
import type { APIRoute } from "astro"

import { SITE_URL } from "../lib/env"

export const GET: APIRoute = () =>
  new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", SITE_URL).href}\n`,
    { headers: { "content-type": "text/plain; charset=utf-8" } }
  )
