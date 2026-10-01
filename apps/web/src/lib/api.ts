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
        ...(init.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
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

// --- AI settings (spec §3.10, §5.6; the server's /api/ai) --------------------

export type AiStage = "skim" | "curator" | "writer"
export type StageModels = Record<AiStage, string>
export type ByokProvider = "anthropic" | "openai" | "google" | "gateway"

/** A stored key as the browser sees it: never the key itself. */
export type AiKeySummary = {
  provider: ByokProvider
  last4: string
  createdAt: string
}

export type AiSettings = {
  provider: ByokProvider | null
  models: Partial<Record<ByokProvider, Partial<StageModels>>>
  askCapUsd: number
}

/** The server's `AiOverview`. */
export type AiOverview = {
  mode: "instance" | "byok"
  ready: boolean
  active: { provider: string; label: string; models: StageModels } | null
  keys: AiKeySummary[]
  providers: { id: ByokProvider; label: string; defaults: StageModels }[]
  settings: AiSettings
  defaultAskCapUsd: number
}

export type KeyTest =
  | { ok: true }
  | { ok: false; reason: "rejected" | "unreachable" | "error"; status?: number }

export function getAi(): Promise<AiOverview> {
  return call("/ai")
}

export async function saveAiKey(
  provider: ByokProvider,
  apiKey: string
): Promise<AiKeySummary> {
  return (
    await call<{ key: AiKeySummary }>(`/ai/keys/${provider}`, {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
    })
  ).key
}

export function testAiKey(provider: ByokProvider): Promise<KeyTest> {
  return call(`/ai/keys/${provider}/test`, { method: "POST" })
}

/** Deletes my key for a provider (already gone is fine). */
export async function deleteAiKey(provider: ByokProvider): Promise<void> {
  try {
    await call(`/ai/keys/${provider}`, { method: "DELETE" })
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
  }
}

export function updateAiSettings(
  patch: Partial<{
    provider: ByokProvider | null
    models: AiSettings["models"]
    askCapUsd: number | null
  }>
): Promise<AiOverview> {
  return call("/ai/settings", { method: "PATCH", body: JSON.stringify(patch) })
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

// --- Jobs (WP-3.2's API; packages/server README) ---------------------------

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "complete"
  | "failed"
  | "cancelled"

/** A job row (the server's `Job`). */
export type Job = {
  id: string
  expeditionId: string
  kind: string
  input: unknown
  startedBy: string
  status: JobStatus
  step: string | null
  progress: number
  error: string | null
  attempt: number
  capRaises: number
  createdAt: string
  updatedAt: string
}

/** An Expedition's 20 most recent jobs, newest first. */
export async function listJobs(expeditionId: string): Promise<Job[]> {
  return (
    await call<{ jobs: Job[] }>(
      `/expeditions/${encodeURIComponent(expeditionId)}/jobs`
    )
  ).jobs
}

export async function startJob(
  expeditionId: string,
  kind: string,
  input: unknown
): Promise<Job> {
  return (
    await call<{ job: Job }>(
      `/expeditions/${encodeURIComponent(expeditionId)}/jobs`,
      { method: "POST", body: JSON.stringify({ kind, input }) }
    )
  ).job
}

/** Cancel (or Stop, at the spending cap), Retry, or Continue past the cap. */
export async function jobAction(
  jobId: string,
  action: "cancel" | "retry" | "continue"
): Promise<Job> {
  return (
    await call<{ job: Job }>(
      `/jobs/${encodeURIComponent(jobId)}/${action}`,
      { method: "POST" }
    )
  ).job
}

// ─── The create flow (WP-3.4; the server's src/create.ts) ─────────────────

/** The goal chips on the Sources screen. */
export type Goal = "learn" | "decide" | "plan"

/** A Source on the create screens (the server's `DraftSource`). */
export type DraftSource = {
  id: string
  kind: "chat" | "file" | "prompt"
  title: string
  mime?: string
  size?: number
  addedAt: string
  /** Its text, when stored. */
  segments: {
    kind: "chat" | "document"
    format: string
    count: number
    chars: number
  } | null
}

/** A View of the draft (the server's `DraftView`): queued until built. */
export type DraftView = {
  id: string
  viewType: string
  label: string
  question: string | null
  status: "queued" | "building" | "ready" | "failed"
}

/** GET /api/expeditions/:id/draft. */
export type Draft = {
  expedition: {
    id: string
    title: string
    summary: string
    status: "draft" | "building" | "ready"
    role: Role
    bestViewId: string | null
  }
  sources: DraftSource[]
  views: DraftView[]
  counts: { concepts: number; sources: number }
}

export function getDraft(
  expeditionId: string,
  signal?: AbortSignal
): Promise<Draft> {
  return call(`/expeditions/${encodeURIComponent(expeditionId)}/draft`, {
    signal,
  })
}

/** Adds a pasted chat or a prompt as a Source. */
export function addTextSource(
  expeditionId: string,
  type: "paste" | "prompt",
  text: string
): Promise<unknown> {
  return call(`/sources/${encodeURIComponent(expeditionId)}`, {
    method: "POST",
    body: JSON.stringify({ type, text }),
  })
}

/** Uploads a file as a Source (25 MB cap: 413 above it; 400/415 unreadable). */
export function uploadSource(expeditionId: string, file: File): Promise<unknown> {
  const form = new FormData()
  form.set("file", file)
  return call(`/sources/${encodeURIComponent(expeditionId)}`, {
    method: "POST",
    body: form,
  })
}

export async function removeSource(
  expeditionId: string,
  sourceId: string
): Promise<void> {
  await call(
    `/sources/${encodeURIComponent(expeditionId)}/${encodeURIComponent(sourceId)}`,
    { method: "DELETE" }
  )
}

type TokenUsage = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** The server's `BuildEstimate`. */
export type BuildEstimate = {
  sourceTokens: number
  /** Over the source token cap: the reader picks which Sources to include. */
  overCap: boolean
  concepts: number
  views: number
  stages: Record<AiStage, { model: string; usage: TokenUsage; usd: number }>
  usd: number
  capUsd: number
}

export async function estimateBuild(
  sourceChars: number,
  views?: number
): Promise<BuildEstimate> {
  return (
    await call<{ estimate: BuildEstimate }>("/ai/estimate", {
      method: "POST",
      body: JSON.stringify({ sourceChars, ...(views ? { views } : {}) }),
    })
  ).estimate
}

/** A View the skim proposes (the server's `ProposedView`). */
export type ProposedView = {
  id: string
  viewType: string
  label: string
  question: string
  why: string
  on: boolean
  confidence: "high" | "medium"
}

export type SkimAnswer = {
  skim: { title: string; summary: string; views: ProposedView[] }
  run: { ms: number; usd: number; model: string }
}

type Existing = { viewType: string; question: string }

export type SkimAsk =
  | { mode: "propose"; goals: Goal[] }
  | { mode: "more"; goals: Goal[]; existing: Existing[]; takenIds: string[] }
  | {
      mode: "ask"
      goals: Goal[]
      request: string
      existing: Existing[]
      takenIds: string[]
    }

/** Runs the skim: propose Views, suggest more, or one the reader asked for. */
export function runSkim(
  expeditionId: string,
  ask: SkimAsk,
  signal?: AbortSignal
): Promise<SkimAnswer> {
  return call(`/expeditions/${encodeURIComponent(expeditionId)}/skim`, {
    method: "POST",
    body: JSON.stringify(ask),
    signal,
  })
}

export type PlanView = {
  /** A View already queued in the draft. */
  id?: string
  viewType: string
  label: string
  question: string
}

/** Saves the title and the chosen Views (queued), best first. */
export function savePlan(
  expeditionId: string,
  plan: { title: string; summary?: string; views: PlanView[] }
): Promise<Draft> {
  return call(`/expeditions/${encodeURIComponent(expeditionId)}/plan`, {
    method: "PUT",
    body: JSON.stringify(plan),
  })
}

/**
 * Starts building a saved draft: the hand-off to the build (WP-3.5b). Until
 * the build exists the server answers 501 (`build-unavailable`).
 */
export function startBuild(
  expeditionId: string,
  goals: Goal[]
): Promise<{ jobId: string }> {
  return call(`/expeditions/${encodeURIComponent(expeditionId)}/build`, {
    method: "POST",
    body: JSON.stringify({ goals }),
  })
}

/** One Change as History lists it (the server's `ChangeSummary`). */
export type ChangeSummary = {
  id: string
  author: { id: string; name: string; image: string | null }
  origin: "human" | "build" | "ai" | "mcp" | "import" | "restore" | "merge"
  label: string
  /** When it started, ISO 8601. */
  at: string
  /** Its first and last ops' serverSeq ("view as of" replays up to `lastSeq`). */
  firstSeq: number
  lastSeq: number
}

export type HistoryPage = {
  headSeq: number
  /** Newest first. */
  changes: ChangeSummary[]
  /** Older Changes remain: pass the last one's `firstSeq` as `before`. */
  more: boolean
}

/** An Expedition's Changes, newest first (owners and editors; 403 otherwise). */
export function getHistory(
  expeditionId: string,
  before?: number
): Promise<HistoryPage> {
  const q = new URLSearchParams({ expedition: expeditionId })
  if (before !== undefined) q.set("before", String(before))
  return call<HistoryPage>(`/history?${q}`)
}
