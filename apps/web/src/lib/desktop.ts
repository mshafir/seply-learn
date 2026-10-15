// The desktop app's bridge (spec §10.5). The shell exposes it as
// `window.seplyDesktop` on the server it was pointed at; in a browser it isn't
// there. Each member is feature-detected, so an older shell keeps working.

export type DesktopBridge = {
  version: number
  /** Opens this server's /desktop/sign-in in the system browser (WP-8.2). */
  signInWithBrowser?: () => Promise<void>
}

declare global {
  interface Window {
    seplyDesktop?: DesktopBridge
  }
}

export const desktopBridge = (): DesktopBridge | undefined =>
  window.seplyDesktop

/** A PKCE challenge: a SHA-256 in unpadded base64url. */
export const isChallenge = (text: string | null): text is string =>
  !!text && /^[A-Za-z0-9_-]{43}$/.test(text)

/** The link that hands a sign-in back to the app pointed at this server. */
export const authLink = (token: string, host = window.location.host) =>
  `seply://${host}/auth?token=${encodeURIComponent(token)}`
