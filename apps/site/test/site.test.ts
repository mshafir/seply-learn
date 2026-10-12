// Checks the built site (test/build.ts builds it): routes, meta, the
// preview/production differences, the Open Graph card, the media manifest,
// the /self-host page and the JavaScript budget.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { EXAMPLES, GALLERY, SHOWCASE } from "../src/learn/content"
import { HEADLINE } from "../src/learn/copy"
import { lightTokens } from "../src/lib/og"
import { IMAGE_SLOTS } from "../src/media"
import { outDir } from "./build"

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
    for (const page of ["index.html", "self-host/index.html", "404.html"]) {
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
