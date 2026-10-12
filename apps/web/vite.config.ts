import { readFileSync } from "fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { VitePWA } from "vite-plugin-pwa"

/**
 * Emits sw/push-sw.js as /push-sw.js: the service worker's web push handlers,
 * imported by Workbox's generated worker (spec §2.5).
 */
const pushWorker = (): Plugin => ({
  name: "seply-push-sw",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "push-sw.js",
      source: readFileSync(path.resolve(__dirname, "sw/push-sw.js"), "utf8"),
    })
  },
})

/** The live embed's path (spec §9.3); the servers serve embed.html there. */
const EMBED_PATH = /^\/e\/[^/]+\/embed\/?(\?|$)/

/**
 * The live embed in `vite dev` and `vite preview`: /e/:id/embed gets
 * embed.html, as the Worker and the Node entry serve it (they also check the
 * Expedition is Public and set frame-ancestors; Vite does neither).
 */
const embedPage = (): Plugin => {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url && EMBED_PATH.test(req.url)) {
      const query = req.url.indexOf("?")
      req.url = `/embed.html${query < 0 ? "" : req.url.slice(query)}`
    }
    next()
  }
  return {
    name: "seply-embed-page",
    // After VitePWA's own post hook, which adds the registration.
    enforce: "post",
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
    // The embed never registers the app's service worker: it is framed by
    // other sites and has nothing to keep offline.
    transformIndexHtml: {
      order: "post",
      handler: (html, ctx) =>
        ctx.path.endsWith("/embed.html")
          ? html
              .replace(/<link rel="manifest"[^>]*>/g, "")
              .replace(/<script[^>]*registerSW\.js[^>]*><\/script>/g, "")
          : html,
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pushWorker(),
    // Installable PWA (spec §2.9). The service worker precaches the app
    // shell: the built HTML, JS, CSS, the self-hosted fonts and the brand
    // icons. It caches no API responses: Expeditions for offline reading
    // live in IndexedDB (src/lib/offline.ts). Client-side routes fall back
    // to index.html; /api never does.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["favicon.svg", "favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "Seply Learn",
        short_name: "Seply",
        description:
          "Build, curate and explore Expeditions: bodies of knowledge, read through Views.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // The light ground and accent tokens (packages/ui globals.css).
        background_color: "#F6F5F1",
        theme_color: "#3A45B5",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Only the Latin subsets of the fonts; other scripts load online.
        globIgnores: ["**/*-{cyrillic,cyrillic-ext,greek,vietnamese}-*.woff2"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        // The live embed is the server's to answer (Public only, its own
        // frame-ancestors): never the app shell from the cache.
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/mcp$/,
          /^\/\.well-known\//,
          /^\/e\/[^/]+\/embed\/?$/,
        ],
        cleanupOutdatedCaches: true,
        // Web push: show a job's notification, open its Expedition on click.
        importScripts: ["push-sw.js"],
      },
    }),
    // After VitePWA: takes the registration script out of embed.html.
    embedPage(),
  ],
  // The brand folder (favicon, PWA icons, wordmark) is served from the site
  // root, so swapping the brand means swapping that one folder.
  publicDir: path.resolve(__dirname, "../../packages/ui/brand"),
  // In dev, /api goes to the Worker (`wrangler dev` on 8787); see docs/ops/deploy.md.
  // So do MCP and its OAuth discovery documents (WP-5.4).
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/mcp": "http://localhost:8787",
      "/.well-known/oauth-": "http://localhost:8787",
    },
  },
  // Two pages: the app, and the live embed (src/embed/), which loads none of
  // the app's screens.
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        embed: path.resolve(__dirname, "embed.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
