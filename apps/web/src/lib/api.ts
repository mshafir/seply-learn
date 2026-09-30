// The app's calls to the server's HTTP API (packages/server README), same
// origin under /api. Push and pull go through @seply/sync's fetchTransport.
// These types mirror the server's responses: the app may not import
// @seply/server (dependency rule).

import type { SegmentsDoc } from "@seply/domain"

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

/** A Collaborator as a Library card shows them. */
export type CardCollaborator = {
  id: string
  name: string
  image: string | null
  role: Role
}

/** One Library card (the server's `LibraryCard`). */
export type LibraryCard = ExpeditionSummary & {
  tags: string[]
  /** Owner first, then editors, then viewers. */
  collaborators: CardCollaborator[]
  counts: { concepts: number; views: number }
  /** The best View's View Type, for the fixed thumbnail (null: no Views). */
  bestViewType: string | null
  /** When it last changed, ISO 8601. */
  updatedAt: string
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

/** Every Expedition I collaborate on, newest first, as Library cards. */
export async function listExpeditions(): Promise<LibraryCard[]> {
  return (await call<{ expeditions: LibraryCard[] }>("/expeditions"))
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

/** Global search results (the server's `SearchResults`), grouped. */
export type SearchResults = {
  expeditions: (Pick<
    ExpeditionSummary,
    "id" | "title" | "summary" | "visibility"
  > & { role: Role | null })[]
  concepts: {
    id: string
    expeditionId: string
    expeditionTitle: string
    title: string
    kind: string
    summary: string | null
  }[]
  tags: { tag: string; count: number }[]
}

/** Searches the Expeditions I collaborate on, plus public ones if asked. */
export function searchAll(
  q: string,
  includePublic: boolean,
  signal?: AbortSignal
): Promise<SearchResults> {
  const params = new URLSearchParams({ q, public: includePublic ? "1" : "0" })
  return call(`/search?${params}`, { signal })
}

/** A Source's own fields, as GET /api/sources/:expedition/:source returns them. */
export type SourceInfo = {
  id: string
  kind: "chat" | "file" | "prompt"
  title: string
  mime?: string
  size?: number
  addedBy: string
  addedAt: string
}

/** A Source and its segments (for the Source viewer). */
export function getSourceSegments(
  expeditionId: string,
  sourceId: string,
  signal?: AbortSignal
): Promise<{ source: SourceInfo; segments: SegmentsDoc }> {
  return call(
    `/sources/${encodeURIComponent(expeditionId)}/${encodeURIComponent(sourceId)}`,
    { signal }
  )
}

/** Where a Source's raw file downloads from. */
export const sourceFileHref = (expeditionId: string, sourceId: string) =>
  `/api/sources/${encodeURIComponent(expeditionId)}/${encodeURIComponent(sourceId)}/file`
