// sitemap.xml: every page under src/pages except the 404, at its canonical URL.
import type { APIRoute } from "astro"

import { SITE_URL } from "../lib/env"

const pages = Object.keys(import.meta.glob("./**/*.astro"))
  .map((file) =>
    file
      .replace(/^\.\//, "/")
      .replace(/\.astro$/, "")
      .replace(/(^|\/)index$/, "$1")
  )
  .filter((path) => path !== "/404" && !path.includes("["))
  .map((path) => (path === "/" || path.endsWith("/") ? path : `${path}/`))
  .sort()

export const GET: APIRoute = () => {
  const urls = pages
    .map((path) => `  <url><loc>${new URL(path, SITE_URL).href}</loc></url>`)
    .join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  })
}
