import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { contrastRatio, parseOklch } from "../lib/color"
import { KIND_HUES } from "../lib/kinds"

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8")

/** Reads the custom properties declared directly in one top-level block. */
function readBlock(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const start = css.search(new RegExp(`^${escaped}[^{]*\\{`, "m"))
  if (start < 0) throw new Error(`No ${selector} block in globals.css`)
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start))
  const tokens = new Map<string, string>()
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim())
  }
  return tokens
}

const light = readBlock(":root")
const dark = new Map([...light, ...readBlock(".dark")])
const themes = { light, dark }

function color(tokens: Map<string, string>, name: string) {
  let value = tokens.get(name)
  for (let i = 0; value?.startsWith("var(") && i < 5; i++) {
    value = tokens.get(value.slice(4, -1).trim())
  }
  if (!value) throw new Error(`Token ${name} is not defined`)
  return parseOklch(value)
}

const grounds = ["--background", "--card", "--popover"]

const text = [
  ["ink", "--foreground"],
  ["muted ink", "--muted-foreground"],
  ["accent", "--primary"],
  ["suggested-text", "--suggested-text"],
  ["success", "--success"],
] as const

const fills = [
  ["suggested", "--suggested"],
  ...KIND_HUES.map((hue) => [`kind ${hue}`, `--kind-${hue}`] as const),
] as const

describe.each(Object.entries(themes))("%s theme", (_, tokens) => {
  it.each(text)("%s reaches 4.5:1 on ground and surface", (_, token) => {
    for (const ground of grounds) {
      const ratio = contrastRatio(color(tokens, token), color(tokens, ground))
      expect(ratio, `${token} on ${ground}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(fills)("%s reaches 3:1 on ground and surface", (_, token) => {
    for (const ground of grounds) {
      const ratio = contrastRatio(color(tokens, token), color(tokens, ground))
      expect(ratio, `${token} on ${ground}`).toBeGreaterThanOrEqual(3)
    }
  })

  it("text on the accent reaches 4.5:1", () => {
    const ratio = contrastRatio(
      color(tokens, "--primary-foreground"),
      color(tokens, "--primary")
    )
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it("muted ink reaches 4.5:1 on the muted fill", () => {
    const ratio = contrastRatio(
      color(tokens, "--muted-foreground"),
      color(tokens, "--muted")
    )
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})

describe("palette", () => {
  it("defines all 12 Kind hues in both themes", () => {
    expect(KIND_HUES).toHaveLength(12)
    for (const hue of KIND_HUES) {
      expect(readBlock(":root").has(`--kind-${hue}`)).toBe(true)
      expect(readBlock(".dark").has(`--kind-${hue}`)).toBe(true)
    }
  })

  it("matches the spec's hex values (within rounding)", () => {
    // Spec 7.2 lowest-contrast figures, recomputed from our oklch values.
    const ink = contrastRatio(color(dark, "--foreground"), color(dark, "--card"))
    expect(ink).toBeCloseTo(13.1, 1)
    const suggested = contrastRatio(
      color(light, "--suggested"),
      color(light, "--background")
    )
    expect(suggested).toBeCloseTo(3.34, 1)
  })
})
