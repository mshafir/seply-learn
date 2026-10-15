// Where sign-in goes back to: the `next` parameter, kept to this origin.

/**
 * `raw` when it is a path on this origin (with its query and hash, e.g.
 * `/e/<id>?fork=1`), else "/". `//host` and `/\host` would lead off-site.
 */
export function sameOriginPath(raw: string): string {
  if (!/^\/(?![/\\])/.test(raw)) return "/"
  try {
    const base = "https://app.invalid"
    const url = new URL(raw, base)
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/"
  } catch {
    return "/"
  }
}
