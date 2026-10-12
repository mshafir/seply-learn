// Where the window may go (spec §10.5). A server's code runs in it, so the
// shell decides: the chosen server's own pages stay in the window, other web
// links open in the system browser, and everything else is refused.

export type Navigation = "allow" | "external" | "deny"

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** Whether a page is on the chosen server: the bridge is for these only. */
export function onServer(url: string, server: string): boolean {
  const u = parse(url)
  return !!u && u.origin === server
}

/** What to do with a navigation the server's page asked for. */
export function navigation(url: string, server: string): Navigation {
  const u = parse(url)
  if (!u) return "deny"
  if (u.origin === server) return "allow"
  if (
    u.protocol === "https:" ||
    u.protocol === "http:" ||
    u.protocol === "mailto:"
  )
    return "external"
  return "deny"
}

/** Permissions a server's page may have; the rest are refused. */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  "notifications",
  "clipboard-sanitized-write",
])
