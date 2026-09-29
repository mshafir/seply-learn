// Dev-only harness page for the WP-0.5 spike: `pnpm --filter @umbel/sync harness`.
import { defineConfig } from "vite"

export default defineConfig({ root: "harness", server: { port: 5199 } })
