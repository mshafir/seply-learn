// Vitest global setup: builds the site four ways, as CI would, into
// node_modules/.site-test/<name> for the tests in this folder to read.
import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const testDir = (name: string) =>
  fileURLToPath(new URL(`../node_modules/.site-test/${name}/`, import.meta.url))
export const outDir = (name: string) => testDir(name)

/** No media at all: every slot shows its placeholder. */
const NO_MEDIA = testDir("media-none")
/** A few media files (empty: the build only checks they exist). */
const SOME_MEDIA = testDir("media-some")

const builds: Record<string, Record<string, string>> = {
  // Local and CI checks: no analytics token.
  production: { MEDIA_DIR: NO_MEDIA },
  production_analytics: {
    MEDIA_DIR: NO_MEDIA,
    CF_ANALYTICS_TOKEN: "test-token",
  },
  // A PR preview never gets the beacon, even with the token set.
  preview: {
    MEDIA_DIR: NO_MEDIA,
    SITE_ENV: "preview",
    CF_ANALYTICS_TOKEN: "test-token",
  },
  // The media manifest picks up files and the embed URL.
  media: {
    MEDIA_DIR: SOME_MEDIA,
    SITE_EMBED_URL: "https://learn.seply.app/e/test/embed?view=v",
  },
}

export default function setup() {
  rmSync(NO_MEDIA, { recursive: true, force: true })
  mkdirSync(NO_MEDIA, { recursive: true })
  rmSync(SOME_MEDIA, { recursive: true, force: true })
  mkdirSync(`${SOME_MEDIA}shots`, { recursive: true })
  mkdirSync(`${SOME_MEDIA}video`, { recursive: true })
  for (const f of [
    "shots/01-learning-path-light.webp",
    "shots/01-learning-path-light.avif",
    "shots/01-learning-path-dark.webp",
    "shots/14-outline-light.webp",
    "video/explainer.mp4",
    "video/explainer.webm",
    "video/explainer.vtt",
    "video/explainer-poster.webp",
    "video/hero-loop.mp4",
    "video/hero-loop.webm",
    "video/hero-loop-poster.webp",
  ])
    writeFileSync(SOME_MEDIA + f, "")
  // The capture's manifest: a shot taken from a fallback View has its own alt.
  writeFileSync(
    `${SOME_MEDIA}shots/manifest.json`,
    JSON.stringify({
      shots: {
        "01-learning-path": { from: "test", alt: "A fallback Learning path" },
      },
    })
  )

  for (const [name, env] of Object.entries(builds)) {
    rmSync(outDir(name), { recursive: true, force: true })
    const clean = { ...process.env }
    for (const k of [
      "SITE_ENV",
      "CF_ANALYTICS_TOKEN",
      "MEDIA_DIR",
      "SITE_EMBED_URL",
    ])
      delete clean[k]
    execFileSync("astro", ["build", "--outDir", outDir(name)], {
      cwd: root,
      // SITE_COUNTS=offline: the Examples' last known counts, no network.
      env: {
        ...clean,
        ...env,
        SITE_COUNTS: "offline",
        ASTRO_TELEMETRY_DISABLED: "1",
      },
      stdio: "pipe",
    })
  }
}
