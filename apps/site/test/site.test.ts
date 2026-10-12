// Checks the built site (test/build.ts builds it): routes, meta, the
// preview/production differences, the Open Graph card and no JavaScript.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { HEADLINE } from "../src/learn/copy"
import { lightTokens } from "../src/lib/og"
import { outDir } from "./build"

const read = (build: string, file: string) =>
  readFileSync(join(outDir(build), file), "utf8")
const prod = (file: string) => read("production", file)

describe("production build", () => {
  it("serves the home page with the headline, wordmark and Request access", () => {
    const html = prod("index.html")
    expect(html).toMatch(/<html lang="en" class="theme-system">/)
    expect(html).toContain(`>${HEADLINE}</h1>`)
    expect(html).toMatch(/aria-label="Seply Learn, home"/)
    expect(html).toMatch(
      /<a href="https:\/\/learn\.seply\.app"[^>]*>Request access<\/a>/
    )
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

  it("ships no JavaScript in its pages", () => {
    for (const page of ["index.html", "404.html"])
      expect(prod(page)).not.toContain("<script")
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
    for (const page of ["index.html", "404.html"]) {
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
