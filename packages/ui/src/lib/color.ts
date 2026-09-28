// Colour maths for checking token contrast (WCAG 2.x relative luminance).

export type Oklch = { l: number; c: number; h: number }
export type Rgb = [number, number, number]

/** Parses `oklch(L C H)` (L as 0–1 or a percentage). Alpha is not supported. */
export function parseOklch(value: string): Oklch {
  const match = value
    .trim()
    .match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!match) throw new Error(`Not an opaque oklch() colour: ${value}`)
  const l = Number(match[1]) / (match[2] ? 100 : 1)
  return { l, c: Number(match[3]), h: Number(match[4]) }
}

/** oklch → linear-light sRGB, clamped to the gamut. */
export function oklchToLinearRgb({ l: L, c: C, h: H }: Oklch): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearRgb(color)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const x = relativeLuminance(a)
  const y = relativeLuminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
