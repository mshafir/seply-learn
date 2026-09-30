// Monotonic ULIDs: strictly increasing within one client, even inside one
// millisecond (the random part is incremented), so pending ops sort by id in
// the order they were made. The op engine relies on that when it reloads
// pending ops from IndexedDB.
import { ulid } from "@seply/domain"

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

function increment(rand: string): string {
  const chars = rand.split("")
  for (let i = chars.length - 1; i >= 0; i--) {
    const n = ALPHABET.indexOf(chars[i]!)
    if (n < 31) {
      chars[i] = ALPHABET[n + 1]!
      return chars.join("")
    }
    chars[i] = "0"
  }
  throw new Error("ulid: random part overflowed")
}

export function monotonicUlid(now: () => number = Date.now): () => string {
  let lastTime = -1
  let lastRand = ""
  return () => {
    const t = now()
    if (t > lastTime) {
      const id = ulid(t)
      lastTime = t
      lastRand = id.slice(10)
      return id
    }
    lastRand = increment(lastRand)
    return ulid(lastTime, lastRand)
  }
}
