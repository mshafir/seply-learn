// MCP OAuth in the app (spec §6.1, WP-5.4). Better Auth is the authorization
// server: when an MCP client (Claude Code, …) asks to connect, it sends the
// browser to /sign-in (signed out) or /consent with the authorization
// request as a signed query (`sig`, `exp`, …). These helpers read it.

/** Better Auth's signature parameters, which the authorize endpoint doesn't take. */
const SIGNATURE_PARAMS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"]

/** The signed authorization query on this page, or null when there is none. */
export function signedOAuthQuery(search: string): string | null {
  const params = new URLSearchParams(search)
  return params.has("sig") && params.has("client_id") ? params.toString() : null
}

/**
 * Where a signed-in reader goes to pick up an authorization request again:
 * the authorize endpoint with the original parameters, which then sends
 * them on to /consent.
 */
export function authorizeUrl(oauthQuery: string): string {
  const params = new URLSearchParams(oauthQuery)
  for (const p of SIGNATURE_PARAMS) params.delete(p)
  return `/api/auth/oauth2/authorize?${params}`
}
