// Bundles the Node entry into one ES module for the Docker image (WP-6.2):
// dist/main.mjs, with every dependency inside, so the image needs no
// node_modules and no TypeScript. Paths the sources find through
// import.meta.url don't survive bundling; the image sets them instead:
// WEB_DIST (the SPA) and MIGRATIONS_DIR (@seply/server's drizzle/).
//
//   pnpm --filter @seply/server-node bundle
import { build } from "esbuild"

const result = await build({
  entryPoints: [new URL("../src/main.ts", import.meta.url).pathname],
  outfile: new URL("../dist/main.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "linked",
  metafile: true,
  logLevel: "warning",
  // CommonJS dependencies call require() for Node's built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
})
const bytes = Object.values(result.metafile.outputs).find(
  (o) => o.entryPoint
)?.bytes
console.log(`bundle: dist/main.mjs, ${((bytes ?? 0) / 1e6).toFixed(1)} MB`)
