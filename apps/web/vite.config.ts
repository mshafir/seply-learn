import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
