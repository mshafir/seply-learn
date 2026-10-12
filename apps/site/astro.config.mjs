// The seply.app site: a static Astro build served by the seply-site Worker.
// See README.md for the routes and docs/ops/deploy.md for the deploys.
import { writeFileSync } from "node:fs"

import react from "@astrojs/react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

import { isPreview } from "./src/lib/env.ts"

/**
 * Response headers for every asset, written to dist/_headers (Workers static
 * assets read it). Previews also send `X-Robots-Tag: noindex`.
 */
function headers() {
  return {
    name: "seply-headers",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const lines = [
          "/*",
          "  X-Content-Type-Options: nosniff",
          "  Referrer-Policy: strict-origin-when-cross-origin",
        ]
        if (isPreview) lines.push("  X-Robots-Tag: noindex")
        writeFileSync(new URL("_headers", dir), lines.join("\n") + "\n")
        console.log(`wrote _headers (${isPreview ? "preview" : "production"})`)
      },
    },
  }
}

export default defineConfig({
  site: "https://seply.app",
  output: "static",
  // /self-host/ and /self-host both work on Workers (auto-trailing-slash);
  // canonical URLs use the directory form Astro builds.
  trailingSlash: "ignore",
  // React renders @seply/ui's brand components at build time only: no page
  // uses a client: directive, so no React reaches the browser.
  integrations: [react(), headers()],
  vite: {
    plugins: [tailwindcss()],
    // Favicons and fonts as files, not data: URLs repeated in every page.
    build: { assetsInlineLimit: 0 },
  },
  build: {
    // Inline the one small stylesheet: no render-blocking request.
    inlineStylesheets: "auto",
  },
  devToolbar: { enabled: false },
})
