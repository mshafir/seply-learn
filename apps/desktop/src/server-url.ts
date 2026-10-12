// Which server the app talks to (spec §10.2): reducing what a person types to
// an origin, the https rule, and checking that a Seply Learn server answers
// there. Pure, apart from the fetch it is handed.

/** The hosted instance: the server the app opens until another is chosen. */
export const DEFAULT_SERVER = "https://learn.seply.app"

/** The bridge version this shell provides (spec §10.5). */
export const BRIDGE_VERSION = 1

export type ParsedServer =
  | {
      ok: true
      /** `scheme://host[:port]`, nothing else. */
      origin: string
      /** False for plain http, which only a local address may use. */
      encrypted: boolean
    }
  | { ok: false; reason: "empty" | "invalid" | "insecure" }

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  // Carrier-grade NAT, which tailnets use.
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
]

/**
 * Whether a host is this machine or on a private network: the only places
 * plain http is allowed, so a home self-host isn't blocked.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host.endsWith(".local")) return true
  if (host === "::1") return true
  // Unique local and link-local IPv6.
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host))
    return true
  return (
    /^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_V4.some((r) => r.test(host))
  )
}

/**
 * A typed address as a server origin. Without a scheme it is https, or http
 * for a local address. Paths, queries and credentials are dropped.
 */
export function parseServer(input: string): ParsedServer {
  const text = input.trim()
  if (!text) return { ok: false, reason: "empty" }
  let url: URL
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) url = new URL(text)
    else {
      // The host decides the scheme, so parse once to find it.
      const guess = new URL(`https://${text}`)
      url = isLocalHost(guess.hostname) ? new URL(`http://${text}`) : guess
    }
  } catch {
    return { ok: false, reason: "invalid" }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, reason: "invalid" }
  if (!url.hostname) return { ok: false, reason: "invalid" }
  const encrypted = url.protocol === "https:"
  if (!encrypted && !isLocalHost(url.hostname))
    return { ok: false, reason: "insecure" }
  return { ok: true, origin: url.origin, encrypted }
}

/** Whether a body is what a Seply Learn server answers on `/api/instance`. */
export function isSeplyInstance(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { product?: unknown }).product === "seply-learn"
  )
}

export type ServerCheck =
  | { ok: true; origin: string; encrypted: boolean }
  | {
      ok: false
      reason: "empty" | "invalid" | "insecure" | "unreachable" | "not-seply"
    }

/**
 * Parses an address and asks the server there what it is. Only a Seply Learn
 * server passes.
 */
export async function checkServer(
  input: string,
  fetcher: (url: string, init: { signal: AbortSignal }) => Promise<Response>,
  timeoutMs = 8000
): Promise<ServerCheck> {
  const parsed = parseServer(input)
  if (!parsed.ok) return parsed
  let body: unknown
  try {
    const res = await fetcher(`${parsed.origin}/api/instance`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, reason: "not-seply" }
    body = await res.json()
  } catch (e) {
    // An answer that isn't JSON came from something else; anything else
    // means nothing answered.
    return {
      ok: false,
      reason: e instanceof SyntaxError ? "not-seply" : "unreachable",
    }
  }
  if (!isSeplyInstance(body)) return { ok: false, reason: "not-seply" }
  return { ok: true, origin: parsed.origin, encrypted: parsed.encrypted }
}
