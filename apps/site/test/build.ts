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
/** The GitHub API's answer for the Releases, as the media build reads it. */
const RELEASES = testDir("releases") + "releases.json"

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
  // The media manifest picks up files and the embed URL; the desktop
  // buttons link to the files of a desktop Release.
  media: {
    MEDIA_DIR: SOME_MEDIA,
    SITE_EMBED_URL: "https://learn.seply.app/e/test/embed?view=v",
    SITE_RELEASES_FILE: RELEASES,
  },
}

const DOWNLOAD = "https://github.com/mshafir/seply-learn/releases/download"
const TAG = "https://github.com/mshafir/seply-learn/releases/tag"
const asset = (tag: string, name: string) => ({
  name,
  browser_download_url: `${DOWNLOAD}/${tag}/${name}`,
})
const release = (tag: string, prerelease: boolean, assets: string[]) => ({
  tag_name: tag,
  html_url: `${TAG}/${tag}`,
  draft: false,
  prerelease,
  assets: assets.map((name) => asset(tag, name)),
})

/**
 * Releases, newest first, as the API lists them: a desktop prerelease and the
 * server's Release come before the newest desktop one, which the site picks.
 */
export const RELEASES_FIXTURE = [
  release("desktop-v0.3.0-rc.1", true, [
    "Seply-Learn-0.3.0-rc.1-mac-universal.dmg",
  ]),
  release("v1.0.0", false, []),
  release("desktop-v0.2.0", false, [
    "Seply-Learn-0.2.0-mac-universal.dmg",
    "Seply-Learn-0.2.0-win-x64.exe",
    "Seply-Learn-0.2.0-win-arm64.exe",
    "Seply-Learn-0.2.0-linux-amd64.deb",
    "Seply-Learn-0.2.0-linux-arm64.deb",
    "Seply-Learn-0.2.0-linux-x86_64.AppImage",
  ]),
  release("desktop-v0.1.0", false, ["Seply-Learn-0.1.0-mac-universal.dmg"]),
]

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

  mkdirSync(testDir("releases"), { recursive: true })
  writeFileSync(RELEASES, JSON.stringify(RELEASES_FIXTURE))

  for (const [name, env] of Object.entries(builds)) {
    rmSync(outDir(name), { recursive: true, force: true })
    const clean = { ...process.env }
    for (const k of [
      "SITE_ENV",
      "CF_ANALYTICS_TOKEN",
      "MEDIA_DIR",
      "SITE_EMBED_URL",
      "SITE_RELEASES_FILE",
    ])
      delete clean[k]
    execFileSync("astro", ["build", "--outDir", outDir(name)], {
      cwd: root,
      // SITE_COUNTS=offline: the Examples' last known counts, no network.
      env: {
        ...clean,
        ...env,
        SITE_COUNTS: "offline",
        // No GitHub API: the desktop buttons' fallback, or the media build's file.
        SITE_RELEASES: "offline",
        ASTRO_TELEMETRY_DISABLED: "1",
      },
      stdio: "pipe",
    })
  }
}
