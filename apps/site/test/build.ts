// Vitest global setup: builds the site three ways, as CI would, into
// node_modules/.site-test/<name> for the tests in this folder to read.
import { execFileSync } from "node:child_process"
import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
export const outDir = (name: string) =>
  fileURLToPath(new URL(`../node_modules/.site-test/${name}/`, import.meta.url))

const builds: Record<string, Record<string, string>> = {
  // Local and CI checks: no analytics token.
  production: {},
  production_analytics: { CF_ANALYTICS_TOKEN: "test-token" },
  // A PR preview never gets the beacon, even with the token set.
  preview: { SITE_ENV: "preview", CF_ANALYTICS_TOKEN: "test-token" },
}

export default function setup() {
  for (const [name, env] of Object.entries(builds)) {
    rmSync(outDir(name), { recursive: true, force: true })
    const clean = { ...process.env }
    delete clean.SITE_ENV
    delete clean.CF_ANALYTICS_TOKEN
    execFileSync("astro", ["build", "--outDir", outDir(name)], {
      cwd: root,
      env: { ...clean, ...env, ASTRO_TELEMETRY_DISABLED: "1" },
      stdio: "pipe",
    })
  }
}
