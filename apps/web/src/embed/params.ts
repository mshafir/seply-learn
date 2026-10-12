// The live embed's address (spec §9.3): /e/:id/embed?view=<viewId>&theme=light|dark.

export type EmbedTheme = "light" | "dark" | "system"

export type EmbedParams = {
  expeditionId: string
  /** The View to show; unset: the Expedition's first View. */
  viewId: string | null
  theme: EmbedTheme
}

const EMBED_PATH = /^\/e\/([^/]+)\/embed\/?$/

/** The embed's parameters, or null when the path isn't an embed's. */
export function embedParams(url: URL): EmbedParams | null {
  const match = EMBED_PATH.exec(url.pathname)
  if (!match) return null
  let expeditionId: string
  try {
    expeditionId = decodeURIComponent(match[1]!)
  } catch {
    return null
  }
  const theme = url.searchParams.get("theme")
  return {
    expeditionId,
    viewId: url.searchParams.get("view") || null,
    theme: theme === "light" || theme === "dark" ? theme : "system",
  }
}

/** The full Expedition in the app, on the same View. */
export function appHref(
  origin: string,
  expeditionId: string,
  viewId: string | null
): string {
  const path = `/e/${encodeURIComponent(expeditionId)}`
  return new URL(
    viewId ? `${path}/${encodeURIComponent(viewId)}` : path,
    origin
  ).toString()
}
