// The 1200 × 630 Open Graph card, drawn at build time (spec 9.2): the
// wordmark (glyph included) and the headline on the light brand tokens.
//
// fontkit sets the text as outlines, with the brand's font settings
// (Newsreader Medium at optical size 72, as in the wordmark), and resvg
// rasterises the SVG, so the card needs no system fonts. Colours come from
// @seply/ui's tokens.css, fonts from the Fontsource packages the app uses, and
// the wordmark is the brand file.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

import { Resvg } from "@resvg/resvg-js"
import { oklchToLinearRgb, parseOklch } from "@seply/ui/lib/color"
import * as fontkit from "fontkit"

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

const require = createRequire(import.meta.url)
const readPackageFile = (id: string) =>
  readFileSync(require.resolve(id), "utf8")
const tokensCss = readPackageFile("@seply/ui/tokens.css")
const wordmarkSvg = readPackageFile("@seply/ui/brand/wordmark.svg")

/** The light palette (`:root`) from tokens.css, as sRGB hex for the renderer. */
export function lightTokens(css: string = tokensCss): Record<string, string> {
  const start = css.search(/^:root[^{]*\{/m)
  if (start < 0) throw new Error("tokens.css has no :root block")
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start))
  const out: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(
    /(--[\w-]+)\s*:\s*(oklch\([^)]*\))/g
  ))
    out[name] = toHex(value)
  return out
}

function toHex(oklch: string): string {
  const encode = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  return (
    "#" +
    oklchToLinearRgb(parseOklch(oklch))
      .map((x) =>
        Math.round(encode(x) * 255)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  )
}

// Loaded at run time, not bundled: its Emscripten build breaks when Vite bundles it.
const { decompress } = require("wawoff2") as {
  decompress(woff2: Uint8Array): Promise<Uint8Array>
}

/**
 * One instance of a variable font. Fontsource ships WOFF2, and fontkit can't
 * apply variations to WOFF2, so it is decompressed to TTF first.
 */
async function loadFont(
  file: string,
  variation: Record<string, number>
): Promise<fontkit.Font> {
  // Copied at once: the result is a view into wawoff2's Wasm heap, which the next call reuses.
  const ttf = Buffer.from(await decompress(readFileSync(require.resolve(file))))
  const font = fontkit.create(ttf) as fontkit.Font
  return font.getVariation(variation)
}

type TextBox = {
  x: number
  y: number
  size: number
  lineHeight: number
  maxWidth: number
}

/** Text as SVG path data, wrapped greedily at `maxWidth`; `y` is the top of the first line. */
function setText(font: fontkit.Font, text: string, box: TextBox): string {
  const scale = box.size / font.unitsPerEm
  const width = (s: string) => font.layout(s).advanceWidth * scale
  const lines: string[] = []
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1)
    if (last !== undefined && width(`${last} ${word}`) <= box.maxWidth)
      lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  let d = ""
  lines.forEach((line, i) => {
    const run = font.layout(line)
    const baseline = box.y + box.size + i * box.size * box.lineHeight
    let penX = box.x
    run.glyphs.forEach((glyph, g) => {
      const pos = run.positions[g]
      // Font units are y-up: scale, flip, then move to the pen on the baseline.
      const [a, b, c, dd, e, f] = [
        scale,
        0,
        0,
        -scale,
        penX + pos.xOffset * scale,
        baseline - pos.yOffset * scale,
      ]
      d += glyph.path.transform(a, b, c, dd, e, f).toSVG()
      penX += pos.xAdvance * scale
    })
  })
  return d
}

/** The brand wordmark, nested at (x, y), with its light/dark styles replaced by token colours. */
function wordmark(
  t: Record<string, string>,
  x: number,
  y: number,
  height: number
): string {
  const style = `<style>.tile{fill:${t["--calyx"]}}.leaf{fill:${t["--sprout"]}}.ink{fill:${t["--foreground"]}}.muted{fill:${t["--muted-foreground"]}}</style>`
  // The file is 291 × 64.
  const width = Math.round((291 / 64) * height)
  return wordmarkSvg
    .replace(/<style>[\s\S]*?<\/style>/, style)
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(
      ' width="291" height="64"',
      ` x="${x}" y="${y}" width="${width}" height="${height}"`
    )
}

/** The card as SVG, with every piece of text as outlines. */
export async function ogCardSvg(headline: string): Promise<string> {
  const t = lightTokens()
  const newsreader = await loadFont(
    "@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2",
    { wght: 500, opsz: 72 }
  )
  const plexSans = await loadFont(
    "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2",
    { wght: 400 }
  )

  const pad = 80
  const title = setText(newsreader, headline, {
    x: pad,
    y: 212,
    size: 76,
    lineHeight: 1.12,
    maxWidth: OG_WIDTH - 2 * pad,
  })
  const footer = setText(plexSans, "seply.app", {
    x: pad,
    y: OG_HEIGHT - pad - 28,
    size: 28,
    lineHeight: 1,
    maxWidth: OG_WIDTH,
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${t["--background"]}"/>
  <rect y="${OG_HEIGHT - 16}" width="${OG_WIDTH}" height="16" fill="${t["--calyx"]}"/>
  ${wordmark(t, pad, pad, 72)}
  <path fill="${t["--foreground"]}" d="${title}"/>
  <path fill="${t["--muted-foreground"]}" d="${footer}"/>
</svg>`
}

/** The card as PNG. */
export async function renderOgCard(headline: string): Promise<Buffer> {
  return new Resvg(await ogCardSvg(headline), {
    fitTo: { mode: "original" },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng()
}
