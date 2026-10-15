// seply:// links (spec §10.4, §10.5). They come from outside the app, so each
// one is checked before anything happens: the host must be the chosen server,
// and only known shapes are handled. This work package handles sign-in
// (`seply://<host>/auth?token=…`); opening pages comes with WP-8.3.

export const SCHEME = "seply"

export type DeepLink =
  | { kind: "auth"; token: string }
  /** For another server than the chosen one. */
  | { kind: "other-server"; host: string }
  | { kind: "invalid" }

/** A handoff token as the server makes them: short and URL-safe. */
const TOKEN = /^[A-Za-z0-9_-]{16,200}$/

export function parseDeepLink(link: string, server: string): DeepLink {
  let url: URL
  let chosen: URL
  try {
    url = new URL(link)
    chosen = new URL(server)
  } catch {
    return { kind: "invalid" }
  }
  if (url.protocol !== `${SCHEME}:` || !url.host) return { kind: "invalid" }
  if (url.username || url.password) return { kind: "invalid" }
  // A seply:// host keeps the case it was typed in; a server's never has any.
  const host = url.host.toLowerCase()
  if (host !== chosen.host) return { kind: "other-server", host }
  if (url.pathname === "/auth") {
    const token = url.searchParams.get("token") ?? ""
    return TOKEN.test(token) ? { kind: "auth", token } : { kind: "invalid" }
  }
  return { kind: "invalid" }
}

/** The seply:// link among a process's arguments, if it was started by one. */
export const linkInArgs = (argv: readonly string[]): string | undefined =>
  argv.find((a) => a.startsWith(`${SCHEME}://`))
