// The app's calls to the server's HTTP API (packages/server README), same
// origin under /api. Push and pull go through @seply/sync's fetchTransport.
// These types mirror the server's responses: the app may not import
// @seply/server (dependency rule).

import type { ProposalView, SegmentsDoc } from "@seply/domain"

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
  /** Shared with me and not opened yet: the New badge. */
  isNew: boolean
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
  "queued" | "running" | "paused" | "complete" | "failed" | "cancelled"

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
    await call<{ job: Job }>(`/jobs/${encodeURIComponent(jobId)}/${action}`, {
      method: "POST",
    })
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
export function uploadSource(
  expeditionId: string,
  file: File
): Promise<unknown> {
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

/** "Write the article" lengths, as the server prices them. */
export type ArticleLength = "short" | "standard" | "long"
export type ArticleEstimate = {
  lengths: Record<ArticleLength, { words: number; usd: number; model: string }>
  sourceChars: number
  /** The reader's per-ask spending cap. */
  askCapUsd: number
}

/** What each article length would cost on this Expedition's Sources. */
export async function estimateArticle(
  expeditionId: string
): Promise<ArticleEstimate> {
  return call<ArticleEstimate>("/ai/estimate/article", {
    method: "POST",
    body: JSON.stringify({ expeditionId }),
  })
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

// ─── Proposals (WP-4.3; the server's src/proposals.ts) ───────────────────
// Reader-facing copy calls them suggestions.

export type { ProposalItemView, ProposalView } from "@seply/domain"

/** The Proposals with pending items, oldest first (owners and editors; 403 otherwise). */
export async function listProposals(
  expeditionId: string
): Promise<ProposalView[]> {
  return (
    await call<{ proposals: ProposalView[] }>(
      `/expeditions/${encodeURIComponent(expeditionId)}/proposals`
    )
  ).proposals
}

/** What one review action did. */
export type ReviewResult = {
  /** The one Change the accepted items made; null when none were accepted. */
  changeId: string | null
  label: string | null
  headSeq: number
  /** Accepted, in the order applied. */
  accepted: string[]
  /** Dismissed: those asked, and every item that depended on them. */
  dismissed: string[]
  /** Dismissed because they depended on a dismissed one (a Concept's Relationships). */
  cascaded: string[]
}

/**
 * One review action: accept (one Change) and/or dismiss. A 409 `ApiError`
 * carries `stale`, `gone`, `reviewed` or `waiting` item ids in its body
 * (`waiting`: they need a suggested Concept that isn't accepted with them).
 */
export function reviewProposals(
  expeditionId: string,
  body: { accept?: string[]; dismiss?: string[]; overwrite?: boolean }
): Promise<ReviewResult> {
  return call(
    `/expeditions/${encodeURIComponent(expeditionId)}/proposals/review`,
    { method: "POST", body: JSON.stringify(body) }
  )
}

/** Makes reviewed items pending again: those an undone Change accepted, or dismissed ones. */
export async function reopenProposals(
  expeditionId: string,
  body: { changeId: string } | { itemIds: string[] }
): Promise<string[]> {
  return (
    await call<{ reopened: string[] }>(
      `/expeditions/${encodeURIComponent(expeditionId)}/proposals/reopen`,
      { method: "POST", body: JSON.stringify(body) }
    )
  ).reopened
}

// --- Grow (WP-4.4) ---------------------------------------------------------------

/** The Concept actions that are Grow asks (the server's `GROW_ACTIONS`). */
export type GrowAction = "missing" | "examples" | "related"

/** A `grow` job's input: words from the Ask box, or a Concept action. */
export type GrowInput = {
  ask?: string
  action?: GrowAction
  conceptId?: string
  viewId?: string
}

/** One ask, as Activity lists it (the server's `AskView`). */
export type AskView = {
  jobId: string
  kind: "grow" | "article"
  rationale: string
  author: { id: string; name: string; image: string | null }
  status: JobStatus
  step: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  items: { pending: number; accepted: number; dismissed: number }
}

/** Activity: the newest asks first (owners and editors). */
export async function listAsks(expeditionId: string): Promise<AskView[]> {
  return (
    await call<{ asks: AskView[] }>(
      `/expeditions/${encodeURIComponent(expeditionId)}/asks`
    )
  ).asks
}

/** What one Grow ask would cost here, and the reader's per-ask cap. */
export type AskEstimate = {
  usd: number
  model: string
  sourceChars: number
  askCapUsd: number
  /** Whose key pays: the reader's own, or this instance's. */
  keySource: "reader" | "instance"
}

export function estimateAsk(expeditionId: string): Promise<AskEstimate> {
  return call<AskEstimate>("/ai/estimate/ask", {
    method: "POST",
    body: JSON.stringify({ expeditionId }),
  })
}

/** One part of an ask's stream (an AI SDK UI message stream chunk). */
export type AskStreamPart =
  | { type: "start"; messageId: string }
  | { type: "data-proposal"; id: string; data: ProposalView }
  | {
      type: "data-ask"
      id: string
      data: Pick<Job, "status" | "step" | "error">
    }
  | { type: "finish" }

/**
 * Follows one ask (GET /expeditions/:id/asks/:jobId/stream): calls `onPart`
 * for each part until the ask ends (or pauses at its cap), the stream drops,
 * or `signal` aborts. Resolves when it stops; throws when it can't open.
 */
export async function streamAsk(
  expeditionId: string,
  jobId: string,
  onPart: (part: AskStreamPart) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(
    `/api/expeditions/${encodeURIComponent(expeditionId)}/asks/${encodeURIComponent(jobId)}/stream`,
    { credentials: "include", signal }
  )
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const events = buffer.split("\n\n")
      buffer = events.pop() ?? ""
      for (const part of parseSseEvents(events)) onPart(part)
    }
  } catch (e) {
    if (signal?.aborted) return
    throw e
  }
}

/** The parts in complete SSE events (`data: <json>` lines; `[DONE]` is skipped). */
export function parseSseEvents(events: readonly string[]): AskStreamPart[] {
  const out: AskStreamPart[] = []
  for (const event of events) {
    const data = event
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n")
    if (!data || data === "[DONE]") continue
    try {
      out.push(JSON.parse(data) as AskStreamPart)
    } catch {
      // Not ours: skip it.
    }
  }
  return out
}

// --- Sharing (WP-5.1; the server's sharing.ts) -------------------------------

export type InviteRole = "editor" | "viewer"

/** A Collaborator as the share dialog lists them. */
export type SharingPerson = {
  id: string
  name: string
  email: string
  image: string | null
  role: Role
}

export type PendingInvite = {
  id: string
  email: string
  role: InviteRole
  invitedBy: { id: string; name: string }
  createdAt: string
}

export type Sharing = {
  role: Role | null
  visibility: "private" | "unlisted" | "public"
  may: {
    invite: boolean
    changeRole: boolean
    removeCollaborator: boolean
    transferOwnership: boolean
    changeVisibility: boolean
    fork: boolean
    trashExpedition: boolean
  }
  collaborators: SharingPerson[]
  invites: PendingInvite[]
}

export type InviteCreated = {
  invite: PendingInvite
  link: string
  emailed: boolean
  added: boolean
}

export type InviteInfo = {
  expedition: { id: string; title: string }
  role: InviteRole
  invitedBy: string
  email: string
  status: "pending" | "accepted" | "yours"
}

const expPath = (id: string) => `/expeditions/${encodeURIComponent(id)}`

/** Who has access to an Expedition, and what I may change. */
export function getSharing(expeditionId: string): Promise<Sharing> {
  return call<Sharing>(`${expPath(expeditionId)}/sharing`)
}

export function invite(
  expeditionId: string,
  email: string,
  role: InviteRole
): Promise<InviteCreated> {
  return call<InviteCreated>(`${expPath(expeditionId)}/invites`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  })
}

export async function revokeInvite(
  expeditionId: string,
  inviteId: string
): Promise<void> {
  await call(
    `${expPath(expeditionId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: "DELETE" }
  )
}

export async function changeRole(
  expeditionId: string,
  userId: string,
  role: InviteRole
): Promise<void> {
  await call(
    `${expPath(expeditionId)}/collaborators/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) }
  )
}

/** Removes a Collaborator (the owner), or leaves (yourself). */
export async function removeCollaborator(
  expeditionId: string,
  userId: string
): Promise<void> {
  await call(
    `${expPath(expeditionId)}/collaborators/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  )
}

export async function transferOwnership(
  expeditionId: string,
  userId: string
): Promise<void> {
  await call(`${expPath(expeditionId)}/transfer`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  })
}

/** I opened it: clears its New badge in the Library. */
export async function markSeen(expeditionId: string): Promise<void> {
  await call(`${expPath(expeditionId)}/seen`, { method: "POST" })
}

// --- Visibility, Fork and Trash (WP-5.2; the server's sharing.ts, fork.ts, trash.ts)

export type Visibility = Sharing["visibility"]

/** Private, unlisted or public (the owner). */
export async function setVisibility(
  expeditionId: string,
  visibility: Visibility
): Promise<void> {
  await call(`${expPath(expeditionId)}/visibility`, {
    method: "PATCH",
    body: JSON.stringify({ visibility }),
  })
}

export type ForkResult = {
  expedition: ExpeditionSummary
  forkedFrom: { exp: string; seq: number }
}

/** My own copy: of the current state, or as of a Change (`asOf`, its id). */
export function forkExpedition(
  expeditionId: string,
  asOf?: string
): Promise<ForkResult> {
  return call<ForkResult>(`${expPath(expeditionId)}/fork`, {
    method: "POST",
    body: JSON.stringify(asOf ? { asOf } : {}),
  })
}

/** An Expedition of mine in Trash, with when it will be purged. */
export type TrashedCard = LibraryCard & {
  deletedAt: string
  purgeAfter: string
}

/** Deletes to Trash (the owner); purged after 30 days. */
export async function trashExpedition(expeditionId: string): Promise<void> {
  await call(expPath(expeditionId), { method: "DELETE" })
}

export async function listTrash(): Promise<TrashedCard[]> {
  return (await call<{ expeditions: TrashedCard[] }>("/expeditions/trash"))
    .expeditions
}

export function restoreExpedition(
  expeditionId: string
): Promise<ExpeditionSummary> {
  return call(`${expPath(expeditionId)}/restore`, { method: "POST" })
}

export function getInvite(token: string): Promise<InviteInfo> {
  return call<InviteInfo>(`/invites/${encodeURIComponent(token)}`)
}

export function acceptInvite(
  token: string
): Promise<{ expeditionId: string; role: Role }> {
  return call(`/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
  })
}
