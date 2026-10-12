// Fetches Electron's binary the first time a desktop script needs it. The
// workspace install skips Electron's own install script (pnpm-workspace.yaml),
// so the server image and the other packages' CI never download it.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const dir = path.dirname(require.resolve("electron/package.json"))

if (!existsSync(path.join(dir, "path.txt"))) {
  console.log("Fetching Electron (once)…")
  const run = spawnSync(process.execPath, [path.join(dir, "install.js")], {
    stdio: "inherit",
  })
  process.exit(run.status ?? 1)
}
