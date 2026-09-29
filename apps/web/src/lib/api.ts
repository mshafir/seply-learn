// The app's calls to the server's HTTP API (packages/server README), same
// origin under /api. Push and pull go through @umbel/sync's fetchTransport.
// These types mirror the server's responses: the app may not import
// @umbel/server (dependency rule).

export type User = { id: string; email: string; name: string }

export type Role = "owner" | "editor" | "viewer"

export type ExpeditionSummary = {
  id: string
  title: string
  summary: string
  visibility: "private" | "unlisted" | "public"
  status: "draft" | "building" | "ready"
  role: Role
}

export type ImportResult = {
  expedition: ExpeditionSummary
  counts: { concepts: number; relationships: number; views: number }
}

/** A non-2xx answer. `status` 0 means the request never reached the server. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: { error?: string; message?: string } = {}
  ) {
    super(message)
    this.name = "ApiError"
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    })
  } catch {
    throw new ApiError(0, "Can't reach the server.")
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new ApiError(
      res.status,
      body.message ?? body.error ?? `HTTP ${res.status}`,
      body
    )
  return body as T
}

/** The signed-in user, or null when signed out. */
export async function getMe(): Promise<User | null> {
  try {
    return (await call<{ user: User }>("/me")).user
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

export async function listExpeditions(): Promise<ExpeditionSummary[]> {
  return (await call<{ expeditions: ExpeditionSummary[] }>("/expeditions"))
    .expeditions
}

export function createExpedition(title: string): Promise<ExpeditionSummary> {
  return call("/expeditions", {
    method: "POST",
    body: JSON.stringify({ title }),
  })
}

/** One entry of Continue reading: an Expedition and where I left off. */
export type ContinueReadingItem = {
  expedition: Omit<ExpeditionSummary, "role">
  position: {
    viewId: string | null
    focusConceptId: string | null
    at: string
  }
}

/** My most recently read Expeditions (spec §3.2), newest first. */
export async function continueReading(
  limit = 3
): Promise<ContinueReadingItem[]> {
  return (
    await call<{ items: ContinueReadingItem[] }>(
      `/reader/recent?limit=${limit}`
    )
  ).items
}

/** Our JSON, as read from the file (the server validates it). */
export function importExpedition(fileText: string): Promise<ImportResult> {
  return call("/import", { method: "POST", body: fileText })
}

/** Starts Google sign-in (Better Auth): the browser leaves for Google. */
export async function signInWithGoogle(callbackPath = "/"): Promise<void> {
  const { url } = await call<{ url?: string }>("/auth/sign-in/social", {
    method: "POST",
    body: JSON.stringify({
      provider: "google",
      callbackURL: new URL(callbackPath, window.location.origin).href,
    }),
  })
  if (!url) throw new ApiError(500, "Sign-in didn't return a redirect.")
  window.location.assign(url)
}

export async function signOut(): Promise<void> {
  await call("/auth/sign-out", { method: "POST", body: "{}" })
}
