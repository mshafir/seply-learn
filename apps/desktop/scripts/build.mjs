// Bundles the main process and the two preload scripts to dist/ as CommonJS:
// a sandboxed preload can't be an ES module. The shell page (renderer/) is
// built by Vite.
import { build } from "esbuild"

await build({
  entryPoints: {
    main: "src/main.ts",
    preload: "src/preload.ts",
    "shell-preload": "src/shell-preload.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
})
