// Checks the built site (test/build.ts builds it): routes, meta, the
// preview/production differences, the Open Graph card, the media manifest,
// the /self-host page and the JavaScript budget.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { EXAMPLES, GALLERY, SHOWCASE } from "../src/learn/content"
import { countOps, countsLabel } from "../src/learn/counts"
import { HEADLINE } from "../src/learn/copy"
import {
  DESKTOP_RELEASES_URL,
  desktopDownloads,
  type GithubRelease,
} from "../src/learn/desktop"
import { lightTokens } from "../src/lib/og"
import { IMAGE_SLOTS } from "../src/media"
import { outDir, RELEASES_FIXTURE } from "./build"

const read = (build: string, file: string) =>
  readFileSync(join(outDir(build), file), "utf8")
const prod = (file: string) => read("production", file)

describe("production build", () => {
  it("serves the home page with the headline, wordmark and Request access", () => {
    const html = prod("index.html")
    expect(html).toMatch(/<html lang="en" class="theme-system">/)
    expect(html).toMatch(
      /<h1[^>]*>\s*Turn questions into something you can read and come back to\.\s*<\/h1>/
    )
    expect(HEADLINE).toBe(
      "Turn questions into something you can read and come back to."
    )
    expect(html).toMatch(/aria-label="Seply Learn home"/)
    expect(html).toMatch(
      /<a href="https:\/\/learn\.seply\.app"[^>]*>Request access<\/a>/
    )
  })

  it("has every landing section, in the mockup's order", () => {
    const html = prod("index.html")
    const at = (needle: string) => {
      const i = html.indexOf(needle)
      expect(i, needle).toBeGreaterThan(-1)
      return i
    }
    const order = [
      at("Which e-bike gets me up the hills"),
      at('id="how"'),
      at('id="video"'),
      at('id="views"'),
      at('id="agents"'),
      at("Read and edit with other people"),
      at('id="examples"'),
      at('id="self-host"'),
      at('id="desktop"'),
      at("Coming soon."),
      at("Seply Learn is part of Seply"),
    ]
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it("links the examples and the gallery into learn.seply.app", () => {
    const html = prod("index.html")
    for (const id of Object.values(SHOWCASE))
      expect(html).toContain(`href="https://learn.seply.app/e/${id}"`)
    expect(EXAMPLES).toHaveLength(3)
    expect(GALLERY).toHaveLength(5)
  })

  it("links Explore from the header and the Examples", () => {
    const html = prod("index.html")
    const explore = 'href="https://learn.seply.app/explore"'
    // The header nav, its mobile menu, and under the Examples.
    expect(html.split(explore)).toHaveLength(4)
    expect(html).toMatch(
      /href="https:\/\/learn\.seply\.app\/explore"[^>]*>See all public Expeditions<\/a>/
    )
  })

  it("renders the gallery as an accessible tablist with the first panel showing", () => {
    const html = prod("index.html")
    expect(html).toContain('role="tablist" aria-label="View Types"')
    expect(html.match(/role="tab"/g)).toHaveLength(5)
    expect(html.match(/role="tabpanel"[^>]*>/g)).toHaveLength(5)
    expect(html.match(/role="tabpanel"[^>]*hidden[^>]*>/g)).toHaveLength(4)
    expect(html).toMatch(/aria-selected="true"[^>]*>\s*Learning path/)
  })

  it("points the self-host links at /self-host/", () => {
    const html = prod("index.html")
    expect(html).toMatch(/<a href="\/self-host\/"[^>]*>Self-host guide<\/a>/)
    expect(html).toMatch(/<a href="\/self-host\/"[^>]*>self-host<\/a>/)
  })

  it("shows a labelled placeholder for every media slot without a file", () => {
    const html = prod("index.html")
    for (const [id, slot] of Object.entries(IMAGE_SLOTS)) {
      expect(html, id).toContain(`data-media-placeholder="${id}"`)
      expect(html, id).toContain(slot.label)
    }
    expect(html).toContain('data-media-placeholder="explainer"')
    expect(html).toContain("HERO LOOP · 12 S · CUT FROM THE EXPLAINER")
    expect(html).toContain("LIVE EMBED: A PUBLIC VIEW, READ-ONLY")
    expect(html).not.toContain("<video")
    expect(html).not.toContain("<iframe")
  })

  it("ships under 60 KB of JavaScript, and no React", () => {
    const dir = outDir("production")
    for (const page of [
      "index.html",
      "self-host/index.html",
      "desktop/index.html",
      "404.html",
    ]) {
      const html = prod(page)
      const external = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(
        (m) => m[1]
      )
      const inline = [
        ...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g),
      ].map((m) => m[1])
      const bytes =
        external.reduce(
          (n, src) => n + readFileSync(join(dir, src)).length,
          0
        ) + inline.reduce((n, s) => n + Buffer.byteLength(s), 0)
      expect(bytes, page).toBeLessThan(60 * 1024)
    }
    const js = readdirSync(join(dir, "_astro")).filter((f) => f.endsWith(".js"))
    expect(js.filter((f) => f.startsWith("client."))).toEqual([])
  })

  it("has a canonical URL and Open Graph tags on seply.app", () => {
    const html = prod("index.html")
    expect(html).toContain('<link rel="canonical" href="https://seply.app/">')
    expect(html).toContain(
      '<meta property="og:image" content="https://seply.app/og.png">'
    )
    expect(html).toContain(
      '<meta property="og:url" content="https://seply.app/">'
    )
  })

  it("is indexable and has no analytics without a token", () => {
    const html = prod("index.html")
    expect(html).not.toContain("noindex")
    expect(html).not.toContain("cloudflareinsights")
    expect(prod("_headers")).not.toContain("noindex")
  })

  it("has a 404 page that is not indexed and has no canonical URL", () => {
    const html = prod("404.html")
    expect(html).toContain("There is no page at this address.")
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).not.toContain('rel="canonical"')
  })

  it("lists every page but the 404 in sitemap.xml, and robots.txt points at it", () => {
    const xml = prod("sitemap.xml")
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([
      "https://seply.app/",
      "https://seply.app/desktop/",
      "https://seply.app/self-host/",
    ])
    expect(prod("robots.txt")).toContain(
      "Sitemap: https://seply.app/sitemap.xml"
    )
  })

  it("draws a 1200 × 630 PNG Open Graph card", () => {
    const png = readFileSync(join(outDir("production"), "og.png"))
    expect(png.subarray(1, 4).toString()).toBe("PNG")
    // IHDR: width and height, big-endian, at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
  })
})

describe("/self-host", () => {
  const html = () => prod("self-host/index.html")

  it("renders docs/self-host.md with a table of contents", () => {
    expect(html()).toMatch(/Self-hosting Seply Learn<\/h1>/)
    expect(html()).toContain('aria-label="On this page"')
    for (const slug of ["quick-start", "ai-keys", "troubleshooting"]) {
      expect(html()).toContain(`id="${slug}"`)
      expect(html()).toContain(`href="#${slug}"`)
    }
    expect(html()).toContain(
      '<link rel="canonical" href="https://seply.app/self-host/">'
    )
  })

  it("turns relative links into GitHub links", () => {
    expect(html()).toContain(
      'href="https://github.com/mshafir/seply-learn/blob/main/docs/spec/v1/02-architecture.md#210-deployment"'
    )
    expect(html()).toContain(
      'href="https://github.com/mshafir/seply-learn/blob/main/.env.example"'
    )
    const hrefs = [...html().matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs.filter((h) => /^(\.|[\w-]+\/|[\w-]+\.md)/.test(h))).toEqual([])
  })

  it("marks every code block for a copy button and keyboard scrolling", () => {
    const pres = html().match(/<pre[^>]*>/g) ?? []
    expect(pres.length).toBeGreaterThan(3)
    for (const pre of pres) {
      expect(pre).toContain("data-copy=")
      expect(pre).toContain('tabindex="0"')
    }
  })
})

describe("desktop downloads", () => {
  const releasesPage = DESKTOP_RELEASES_URL.replaceAll("&", "&amp;")
  const download = (tag: string, file: string) =>
    `https://github.com/mshafir/seply-learn/releases/download/${tag}/${file}`

  it("has a Desktop app section with a button per system and the install steps link", () => {
    const html = prod("index.html")
    expect(html).toContain('id="desktop"')
    expect(html).toContain("in a window of its own")
    for (const os of ["macOS", "Windows", "Linux"])
      expect(html).toMatch(
        new RegExp(
          `data-download="${os}"[^>]*>\\s*<span>Download for ${os}</span>`
        )
      )
    expect(html).toMatch(/<a href="\/desktop\/"[^>]*>install steps<\/a>/)
  })

  it("links every button to the desktop releases before there is a Release", () => {
    for (const page of ["index.html", "desktop/index.html"]) {
      const html = prod(page)
      expect(html, page).toContain('data-version="none"')
      const buttons = [
        ...html.matchAll(/<a href="([^"]+)"[^>]*data-download=/g),
      ]
      expect(
        buttons.map((m) => m[1]),
        page
      ).toEqual([releasesPage, releasesPage, releasesPage])
    }
  })

  it("links each button to its file in the newest desktop Release", () => {
    const html = read("media", "index.html")
    expect(html).toContain('data-version="0.2.0"')
    const buttons = [
      ...html.matchAll(/<a href="([^"]+)"[^>]*data-download="([^"]+)"/g),
    ]
    expect(buttons.map((m) => [m[2], m[1]])).toEqual([
      [
        "macOS",
        download("desktop-v0.2.0", "Seply-Learn-0.2.0-mac-universal.dmg"),
      ],
      ["Windows", download("desktop-v0.2.0", "Seply-Learn-0.2.0-win-x64.exe")],
      [
        "Linux",
        download("desktop-v0.2.0", "Seply-Learn-0.2.0-linux-amd64.deb"),
      ],
    ])
    expect(html).toContain(
      download("desktop-v0.2.0", "Seply-Learn-0.2.0-win-arm64.exe")
    )
    expect(html).toContain(
      download("desktop-v0.2.0", "Seply-Learn-0.2.0-linux-x86_64.AppImage")
    )
    expect(html).toContain("Version 0.2.0.")
  })

  it("picks the newest desktop Release, skipping the server's, prereleases and drafts", () => {
    const releases = RELEASES_FIXTURE as GithubRelease[]
    const d = desktopDownloads(releases)
    expect(d.version).toBe("0.2.0")
    expect(d.releaseUrl).toBe(
      "https://github.com/mshafir/seply-learn/releases/tag/desktop-v0.2.0"
    )
    // A file the Release doesn't have: that button opens the Release.
    expect(d.more.map((m) => `${m.label} (${m.file})`)).toEqual([
      "Windows on Arm (.exe)",
      "Linux AppImage (x86-64)",
      "Linux .deb (Arm)",
    ])
    const draft = { ...releases[2], draft: true }
    expect(desktopDownloads([draft, releases[3]]).version).toBe("0.1.0")
    const onlyOne = desktopDownloads([releases[3]])
    expect(onlyOne.main.windows.href).toBe(releases[3].html_url)
    expect(onlyOne.more).toEqual([])
  })

  it("falls back to the desktop releases with no Release at all", () => {
    const d = desktopDownloads([])
    expect(d.version).toBeNull()
    expect(Object.values(d.main).map((m) => m.href)).toEqual([
      DESKTOP_RELEASES_URL,
      DESKTOP_RELEASES_URL,
      DESKTOP_RELEASES_URL,
    ])
  })
})

describe("/desktop", () => {
  const html = () => prod("desktop/index.html")

  it("renders docs/desktop.md under the download buttons", () => {
    expect(html()).toMatch(/The Seply Learn desktop app<\/h1>/)
    expect(html().indexOf("data-desktop-downloads")).toBeLessThan(
      html().indexOf("<h1")
    )
    for (const slug of ["macos", "windows", "linux", "choosing-a-server"])
      expect(html()).toContain(`href="#${slug}"`)
    expect(html()).toContain("More info")
    expect(html()).toContain("xattr -dr com.apple.quarantine")
    expect(html()).toContain(
      '<link rel="canonical" href="https://seply.app/desktop/">'
    )
  })

  it("links the self-host guide on the site, not on GitHub", () => {
    expect(html()).toContain('href="/self-host/"')
    expect(prod("self-host/index.html")).toContain('href="/desktop/"')
  })

  it("is linked from the footer", () => {
    expect(prod("index.html")).toMatch(
      /<a href="\/desktop\/"[^>]*>Desktop app<\/a>/
    )
  })
})

describe("media manifest", () => {
  const html = () => read("media", "index.html")

  it("uses a screenshot when its file is there, the dark one under prefers-color-scheme", () => {
    expect(html()).not.toContain('data-media-placeholder="view-learning-path"')
    expect(html()).toContain(
      '<source srcset="/media/shots/01-learning-path-dark.webp" type="image/webp" media="(prefers-color-scheme: dark)">'
    )
    expect(html()).toContain(
      '<source srcset="/media/shots/01-learning-path-light.avif" type="image/avif">'
    )
    expect(html()).toMatch(
      /<img src="\/media\/shots\/01-learning-path-light\.webp" alt="[^"]+"/
    )
  })

  it("takes a shot's alt text from the capture manifest when it has one", () => {
    expect(html()).toMatch(
      /<img src="\/media\/shots\/01-learning-path-light\.webp" alt="A fallback Learning path"/
    )
    expect(html()).toMatch(
      /<img src="\/media\/shots\/14-outline-light\.webp" alt="The Outline View of AI compute and model internals"/
    )
  })

  it("falls back to the light screenshot in dark mode when there is no dark one", () => {
    expect(html()).toContain(
      '<source srcset="/media/shots/14-outline-light.webp" type="image/webp" media="(prefers-color-scheme: dark)">'
    )
  })

  it("plays the explainer with captions and a poster once its files are there", () => {
    expect(html()).not.toContain('data-media-placeholder="explainer"')
    expect(html()).toContain(
      '<source src="/media/video/explainer.webm" type="video/webm">'
    )
    expect(html()).toContain(
      '<track kind="captions" srclang="en" label="English" src="/media/video/explainer.vtt">'
    )
    expect(html()).toContain('poster="/media/video/explainer-poster.webp"')
  })

  it("shows the whole hero loop at 16:9, over its poster, in place of the sketch", () => {
    const video = html().match(/<video[^>]*data-hero-loop[^>]*>/)?.[0] ?? ""
    expect(video).toContain("aspect-video")
    expect(video).toContain("object-contain")
    expect(video).not.toContain("object-cover")
    expect(video).toContain('poster="/media/video/hero-loop-poster.webp"')
    expect(video).not.toContain("autoplay")
    expect(html()).toMatch(
      /<img src="\/media\/video\/hero-loop-poster\.webp" alt="" aria-hidden="true"/
    )
    expect(html()).toContain(
      '<source src="/media/video/hero-loop.webm" type="video/webm"'
    )
    expect(html()).not.toContain("HERO LOOP · 12 S · CUT FROM THE EXPLAINER")
  })

  it("embeds the live View when SITE_EMBED_URL is set", () => {
    expect(html()).toMatch(
      /<iframe src="https:\/\/learn\.seply\.app\/e\/test\/embed\?view=v"[^>]*loading="lazy"/
    )
  })

  it("keeps placeholders for the slots still without files", () => {
    expect(html()).toContain('data-media-placeholder="view-map"')
  })
})

describe("analytics", () => {
  it("adds the Cloudflare Web Analytics beacon in production when CF_ANALYTICS_TOKEN is set", () => {
    const html = read("production_analytics", "index.html")
    expect(html).toContain(
      'src="https://static.cloudflareinsights.com/beacon.min.js"'
    )
    expect(html).toContain(
      `data-cf-beacon="{&quot;token&quot;:&quot;test-token&quot;}"`
    )
  })
})

describe("preview build", () => {
  it("says noindex in every page and in a header, and leaves out the beacon", () => {
    for (const page of ["index.html", "404.html", "self-host/index.html"]) {
      const html = read("preview", page)
      expect(html).toContain('<meta name="robots" content="noindex">')
      expect(html).not.toContain("cloudflareinsights")
    }
    expect(read("preview", "_headers")).toMatch(
      /^\/\*\n(  .+\n)*  X-Robots-Tag: noindex\n/
    )
  })

  it("keeps canonical URLs on seply.app", () => {
    expect(read("preview", "index.html")).toContain(
      '<link rel="canonical" href="https://seply.app/">'
    )
  })
})

describe("tokens", () => {
  it("converts the light palette to the spec's hex values for the card", () => {
    const t = lightTokens()
    expect(t["--background"]).toBe("#f6f5f1")
    expect(t["--foreground"]).toBe("#1d1c1a")
    expect(t["--calyx"]).toBe("#2d5c3f")
  })

  it("keeps hex colours out of the pages and components", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url))
    const files = readdirSync(src, {
      recursive: true,
      encoding: "utf8",
    }).filter((f) => f.endsWith(".astro"))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const text = readFileSync(join(src, file), "utf8")
      expect(text, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })

  it("builds the stylesheet with the dark palette under prefers-color-scheme", () => {
    const dir = join(outDir("production"), "_astro")
    expect(existsSync(dir)).toBe(true)
    const css = readdirSync(dir)
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n")
    expect(css).toMatch(
      /@media \(prefers-color-scheme:\s*dark\)\s*\{\s*\.dark,\s*\.theme-system\s*\{\s*--background:/
    )
  })
})

describe("Examples counts", () => {
  it("counts live Concepts and Views from an op log", () => {
    const op = (serverSeq: number, kind: string, target: string) => ({
      serverSeq,
      kind,
      target,
    })
    expect(
      countOps([
        op(1, "expedition.set", "e"),
        op(2, "concept.create", "a"),
        op(3, "concept.create", "b"),
        op(4, "concept.set", "a"),
        op(5, "concept.tag.add", "b"),
        op(6, "view.create", "v"),
        op(7, "concept.delete", "b"),
        op(8, "relationship.add", "a|t|b"),
      ])
    ).toEqual({ concepts: 1, views: 1 })
    expect(countsLabel({ concepts: 1, views: 2 })).toBe("1 CONCEPT · 2 VIEWS")
  })

  it("shows the last known counts when the API isn't read (SITE_COUNTS=offline)", () => {
    const html = prod("index.html")
    for (const label of [
      "206 CONCEPTS · 12 VIEWS",
      "59 CONCEPTS · 4 VIEWS",
      "39 CONCEPTS · 2 VIEWS",
    ])
      expect(html).toContain(label)
    expect(EXAMPLES.map((e) => e.counts)).toEqual([
      "206 CONCEPTS · 12 VIEWS",
      "59 CONCEPTS · 4 VIEWS",
      "39 CONCEPTS · 2 VIEWS",
    ])
  })
})
