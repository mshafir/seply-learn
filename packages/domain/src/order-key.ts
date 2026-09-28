// Fractional index keys (article sections, the Views rail). Keys compare as
// plain strings; a new key can always be made between two others.

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`)
  if (b) {
    let n = 0
    while ((a[n] ?? "0") === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]
  if (b && b.length > 1) return b.slice(0, 1)
  return DIGITS[da] + midpoint(a.slice(1), null)
}

/** A key strictly between `a` and `b` (null means the start or the end). */
export function keyBetween(a: string | null, b: string | null): string {
  for (const k of [a, b]) {
    if (
      k !== null &&
      (k === "" || k.endsWith("0") || [...k].some((c) => !DIGITS.includes(c)))
    ) {
      throw new Error(`keyBetween: invalid key "${k}"`)
    }
  }
  return midpoint(a ?? "", b)
}

/** `n` increasing keys after `after` (default: from the start). */
export function keysAfter(after: string | null, n: number): string[] {
  const out: string[] = []
  let prev = after
  for (let i = 0; i < n; i++) out.push((prev = keyBetween(prev, null)))
  return out
}
