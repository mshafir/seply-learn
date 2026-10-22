// The desktop app's download links (spec 9.2, §10.6). The desktop app has its
// own Releases (`desktop-v*` tags), and the repository's "latest" Release is
// the server's, so there is no stable "latest download" URL to link to. The
// site reads the newest desktop Release from the GitHub API at build time
// instead, and links each button to its file. The desktop release workflow
// redeploys the site when it publishes, so the links follow each release.
//
// Whenever that can't be read (offline, rate-limited, no desktop Release yet,
// or a file missing from it), a button links to the Releases page filtered to
// the desktop app, so the site always builds and every button goes somewhere
// useful.
//
// SITE_RELEASES=offline skips the network (the tests use it), and
// SITE_RELEASES_FILE=<path> reads the API's answer from a file instead.
// GITHUB_TOKEN, when set (CI), raises the API's rate limit.
import { readFileSync } from "node:fs"

import { GITHUB_URL } from "./content"

const REPO = "mshafir/seply-learn"

/** Every desktop Release, newest first: where a button goes when its file can't be found. */
export const DESKTOP_RELEASES_URL = `${GITHUB_URL}/releases?q=desktop-v&expanded=true`

/** The install steps (docs/desktop.md, rendered at /desktop/). */
export const DESKTOP_GUIDE_URL = "/desktop/"

type Asset = { name: string; browser_download_url: string }
export type GithubRelease = {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: Asset[]
}

export type Download = { label: string; file: string; href: string }

export type DesktopDownloads = {
  /** The version on the buttons, or null when no desktop Release was found. */
  version: string | null
  /** The Release's page, or the filtered Releases page. */
  releaseUrl: string
  /** The three main buttons. */
  main: { mac: Download; windows: Download; linux: Download }
  /** The other files (Arm, AppImage), as smaller links. */
  more: Download[]
}

/** The file for each download, by the names electron-builder.yml gives them. */
const FILES = {
  mac: {
    label: "macOS",
    file: ".dmg, Apple silicon and Intel",
    pattern: /-mac-universal\.dmg$/,
  },
  windows: {
    label: "Windows",
    file: ".exe, 64-bit",
    pattern: /-win-x64\.exe$/,
  },
  linux: {
    label: "Linux",
    file: ".deb, Ubuntu and Debian",
    pattern: /-linux-(amd64|x64)\.deb$/,
  },
  windowsArm: {
    label: "Windows on Arm",
    file: ".exe",
    pattern: /-win-arm64\.exe$/,
  },
  appImage: {
    label: "Linux AppImage",
    file: "x86-64",
    pattern: /-linux-(x86_64|x64)\.AppImage$/,
  },
  appImageArm: {
    label: "Linux AppImage",
    file: "Arm",
    pattern: /-linux-(arm64|aarch64)\.AppImage$/,
  },
  debArm: {
    label: "Linux .deb",
    file: "Arm",
    pattern: /-linux-(arm64|aarch64)\.deb$/,
  },
} as const

/** The newest published desktop Release, not a draft or a prerelease. */
export const newestDesktopRelease = (releases: GithubRelease[]) =>
  releases.find(
    (r) => r.tag_name.startsWith("desktop-v") && !r.draft && !r.prerelease
  )

/** The download links for a list of Releases as the API answers it (newest first). */
export function desktopDownloads(releases: GithubRelease[]): DesktopDownloads {
  const release = newestDesktopRelease(releases)
  const releaseUrl = release?.html_url ?? DESKTOP_RELEASES_URL
  const link = (key: keyof typeof FILES): Download => {
    const { label, file, pattern } = FILES[key]
    const asset = release?.assets.find((a) => pattern.test(a.name))
    return { label, file, href: asset?.browser_download_url ?? releaseUrl }
  }
  return {
    version: release ? release.tag_name.replace(/^desktop-v/, "") : null,
    releaseUrl,
    main: { mac: link("mac"), windows: link("windows"), linux: link("linux") },
    more: release
      ? (["windowsArm", "appImage", "appImageArm", "debArm"] as const)
          .map(link)
          .filter((d) => d.href !== releaseUrl)
      : [],
  }
}

async function fetchReleases(): Promise<GithubRelease[]> {
  if (process.env.SITE_RELEASES_FILE)
    return JSON.parse(readFileSync(process.env.SITE_RELEASES_FILE, "utf8"))
  if (process.env.SITE_RELEASES === "offline") return []
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=100`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    }
  )
  if (!res.ok) throw new Error(`GitHub releases: ${res.status}`)
  return (await res.json()) as GithubRelease[]
}

async function load(): Promise<DesktopDownloads> {
  try {
    const downloads = desktopDownloads(await fetchReleases())
    if (!downloads.version && process.env.SITE_RELEASES !== "offline")
      console.warn(
        "[site] no desktop Release yet; the buttons link to the Releases page"
      )
    return downloads
  } catch (err) {
    console.warn(
      `[site] desktop downloads: ${err instanceof Error ? err.message : err}; the buttons link to the Releases page`
    )
    return desktopDownloads([])
  }
}

/** Read once per build, whichever page asks first. */
export const DESKTOP = await load()
