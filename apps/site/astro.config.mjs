// The seply.app site: a static Astro build served by the seply-site Worker.
// See README.md for the routes and docs/ops/deploy.md for the deploys.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

import { unified } from "@astrojs/markdown-remark"
import react from "@astrojs/react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

import { isPreview } from "./src/lib/env.ts"
import { rehypeRepoDocs } from "./src/lib/rehype-repo-docs.ts"

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

/**
 * @astrojs/react always emits its client runtime (about 190 KB), even when no
 * page hydrates a component. Delete `_astro/client.*.js` when nothing in the
 * build refers to it, so it is never deployed. A page that does hydrate
 * React keeps it.
 */
function dropUnusedReactClient() {
  return {
    name: "seply-drop-unused-react-client",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const assets = new URL("_astro/", dir)
        const files = readdirSync(dir, {
          recursive: true,
          encoding: "utf8",
        }).filter((f) => /\.(html|js|css)$/.test(f))
        const text = files
          .map((f) => readFileSync(new URL(f, dir), "utf8"))
          .join("\n")
        for (const name of readdirSync(assets).filter((f) =>
          /^client\.[\w-]+\.js$/.test(f)
        )) {
          if (text.includes(name.replace(/\.js$/, ""))) continue
          rmSync(new URL(name, assets))
          console.log(`removed unused ${name}`)
        }
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
  integrations: [react(), headers(), dropUnusedReactClient()],
  vite: {
    plugins: [tailwindcss()],
    // Favicons and fonts as files, not data: URLs repeated in every page.
    build: { assetsInlineLimit: 0 },
  },
  build: {
    // Inline the one small stylesheet: no render-blocking request.
    inlineStylesheets: "auto",
  },
  markdown: {
    // Code blocks take the site's tokens (no Shiki theme colours).
    syntaxHighlight: false,
    // remark/rehype rather than the default Sätteri, for the rehype plugin.
    processor: unified({ rehypePlugins: [rehypeRepoDocs] }),
  },
  devToolbar: { enabled: false },
})
