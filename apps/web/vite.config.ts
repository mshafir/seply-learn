import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // The brand folder (favicon, PWA icons, wordmark) is served from the site
  // root, so swapping the brand means swapping that one folder.
  publicDir: path.resolve(__dirname, "../../packages/ui/brand"),
  // In dev, /api goes to the Worker (`wrangler dev` on 8787); see docs/ops/deploy.md.
  server: { proxy: { "/api": "http://localhost:8787" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
