// ULIDs: 48-bit millisecond time + 80 random bits, Crockford base32.
// Op ids are ULIDs, so an op's time is read from its id (tombstone times
// come from here, which keeps `apply` pure).

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Builds a ULID from a time and 16 random base32 chars (or 80 random bits). */
export function ulid(timeMs: number, random?: string): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > 2 ** 48 - 1) {
    throw new Error(`ulid: bad time ${timeMs}`)
  }
  let time = ""
  let t = timeMs
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  let rand = random
  if (rand === undefined) {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    rand = Array.from(bytes, (b) => ALPHABET[b % 32]).join("")
  }
  const id = time + rand
  if (!ULID_RE.test(id)) throw new Error(`ulid: bad random part "${rand}"`)
  return id
}

/** The millisecond time encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!ULID_RE.test(id)) throw new Error(`not a ULID: ${id}`)
  let t = 0
  for (let i = 0; i < 10; i++) t = t * 32 + ALPHABET.indexOf(id[i])
  return t
}

/** Deterministic, strictly increasing ULIDs: for tests, fixtures and converters. */
export function ulidSequence(startMs: number, stepMs = 1): () => string {
  let n = 0
  return () => {
    const i = n++
    let rand = ""
    let r = i
    for (let k = 0; k < 16; k++) {
      rand = ALPHABET[r % 32] + rand
      r = Math.floor(r / 32)
    }
    return ulid(startMs + i * stepMs, rand)
  }
}
