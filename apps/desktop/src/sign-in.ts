// Sign-in through the system browser (spec §10.3). The app makes a random
// verifier and sends only its SHA-256 (the challenge) to the browser. The
// link that comes back carries a one-time token, and the server gives a
// session only for the token together with the verifier. So a link that
// didn't start here, or one somebody else's browser made, signs nobody in.
import { createHash, randomBytes } from "node:crypto"

/** How long the app waits for the browser to come back. */
export const SIGN_IN_WINDOW_MS = 10 * 60_000

export type PendingSignIn = {
  server: string
  verifier: string
  expires: number
}

export const challengeOf = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url")

/** Starts a sign-in for a server: what to keep, and the page to open. */
export function startSignIn(
  server: string,
  now = Date.now()
): { pending: PendingSignIn; url: string } {
  const verifier = randomBytes(32).toString("base64url")
  return {
    pending: { server, verifier, expires: now + SIGN_IN_WINDOW_MS },
    url: `${server}/desktop/sign-in?challenge=${challengeOf(verifier)}`,
  }
}

/**
 * The page that finishes a sign-in in the window, or null when the app isn't
 * waiting for one on this server. The token and verifier go in the fragment,
 * so they never reach the server's logs.
 */
export function completeUrl(
  pending: PendingSignIn | null,
  server: string,
  token: string,
  now = Date.now()
): string | null {
  if (!pending || pending.server !== server || pending.expires < now)
    return null
  const params = new URLSearchParams({ token, verifier: pending.verifier })
  return `${server}/desktop/complete#${params}`
}
