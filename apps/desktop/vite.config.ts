import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The shell page (the server picker and "Can't reach the server"): the only
// UI the app ships. It is loaded from disk, so every path is relative.
export default defineConfig({
  root: path.resolve(import.meta.dirname, "renderer"),
  base: "./",
  plugins: [react(), tailwindcss()],
  // The brand folder: the same icons the web app serves (spec §7.5).
  publicDir: path.resolve(import.meta.dirname, "../../packages/ui/brand"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/renderer"),
    emptyOutDir: true,
  },
})
