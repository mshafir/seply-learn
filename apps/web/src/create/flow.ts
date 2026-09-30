// The create flow's pure parts (spec §3.3, §3.4): labels for Sources and the
// estimate, the proposals on Choose Views (from the skim, and Views saved in
// a draft), what gets saved, and the skim cache that survives a reload.
import type {
  BuildEstimate,
  Draft,
  DraftSource,
  Goal,
  PlanView,
  ProposedView,
} from "@/lib/api.ts"

export const GOAL_CHIPS: { id: Goal; label: string }[] = [
  { id: "learn", label: "learn it" },
  { id: "decide", label: "decide" },
  { id: "plan", label: "plan" },
]

/** What the Sources screen accepts (spec §3.3). */
export const SOURCE_ACCEPT =
  ".json,.zip,.pdf,.docx,.md,.markdown,.txt,.html,.htm,application/json,application/zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,text/html"

const EXPORT_NAMES: Record<string, string> = {
  "chatgpt-export": "ChatGPT export",
  "claude-export": "Claude export",
  "gemini-export": "Gemini export",
  "chat-paste": "Pasted chat",
  pdf: "PDF",
  docx: "Word document",
  markdown: "Markdown",
  text: "Text",
  html: "Web page",
  prompt: "Prompt",
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`

/** "Pasted chat · 6 turns", "PDF · 3 pages", "Markdown · 12 sections". */
export function sourceMeta(s: DraftSource): string {
  const seg = s.segments
  if (!seg) return s.kind === "prompt" ? "Prompt" : "No text stored"
  const what = EXPORT_NAMES[seg.format] ?? seg.format
  if (s.kind === "prompt") return "Prompt · background knowledge"
  const count =
    seg.kind === "chat"
      ? plural(seg.count, "turn")
      : seg.format === "pdf"
        ? plural(seg.count, "page")
        : plural(seg.count, "section")
  return `${what} · ${count}`
}

/** A Source's kind as its badge says it. */
export function sourceKindLabel(s: DraftSource): string {
  if (s.kind === "prompt") return "Prompt"
  return s.segments?.kind === "chat" ? "Chat" : "File"
}

/** Characters of Source text across the draft (what the estimate needs). */
export const sourceChars = (sources: readonly DraftSource[]) =>
  sources.reduce((n, s) => n + (s.segments?.chars ?? 0), 0)

/** "~420k tokens" style. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M tokens`
  if (n >= 1000) return `~${Math.round(n / 1000)}k tokens`
  return `~${n} tokens`
}

/** "$1.10", "under $0.01". */
export function formatUsd(usd: number): string {
  if (usd < 0.01) return "under $0.01"
  return `$${usd.toFixed(2)}`
}

/** Every token the build is expected to use, across its stages. */
export function estimateTokens(e: BuildEstimate): number {
  return Object.values(e.stages).reduce(
    (n, s) => n + s.usage.input + s.usage.cacheRead + s.usage.cacheWrite + s.usage.output,
    0
  )
}

/** The estimate line: "~420k tokens, about $1.10". */
export function estimateLabel(e: BuildEstimate): string {
  return `${formatTokens(estimateTokens(e))}, about ${formatUsd(e.usd)}`
}

// ─── Choose Views ──────────────────────────────────────────────────────────

/** A card on Choose Views. */
export type Proposal = {
  /** The skim's `v-…` id, or a saved View's id. */
  key: string
  viewType: string
  label: string
  question: string
  why: string
  /** A View already queued in the draft. */
  savedId?: string
}

export type Choice = {
  proposals: Proposal[]
  /** Keys of the chosen cards. */
  chosen: string[]
}

export const fromSkim = (v: ProposedView): Proposal => ({
  key: v.id,
  viewType: v.viewType,
  label: v.label,
  question: v.question,
  why: v.why,
})

/** The draft's saved Views, as cards, all chosen. */
export function fromDraft(draft: Draft): Choice {
  const proposals = draft.views
    .filter((v) => v.status === "queued")
    .map((v) => ({
      key: v.id,
      viewType: v.viewType,
      label: v.label,
      question: v.question ?? v.label,
      why: "Saved in your draft",
      savedId: v.id,
    }))
  return { proposals, chosen: proposals.map((p) => p.key) }
}

/** A fresh skim's answer: its cards, with the ones it turned on chosen. */
export function fromProposal(views: readonly ProposedView[]): Choice {
  return {
    proposals: views.map(fromSkim),
    chosen: views.filter((v) => v.on).map((v) => v.id),
  }
}

const sameQuestion = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
  b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

/**
 * Adds more cards (Suggest more, or Ask for a specific View) after the ones
 * there, skipping repeats; `choose` also picks them (a specific request).
 */
export function addProposals(
  choice: Choice,
  views: readonly ProposedView[],
  choose: boolean
): Choice {
  const added = views
    .map(fromSkim)
    .filter(
      (p) =>
        !choice.proposals.some(
          (q) =>
            q.key === p.key ||
            (q.viewType === p.viewType && sameQuestion(q.question, p.question))
        )
    )
  return {
    proposals: [...choice.proposals, ...added],
    chosen: choose ? [...choice.chosen, ...added.map((p) => p.key)] : choice.chosen,
  }
}

export function toggle(choice: Choice, key: string, on: boolean): Choice {
  const chosen = choice.chosen.filter((k) => k !== key)
  return { ...choice, chosen: on ? [...chosen, key] : chosen }
}

/** The chosen cards, in page order (rank): the first is the best View. */
export function chosenInOrder(choice: Choice): Proposal[] {
  const on = new Set(choice.chosen)
  return choice.proposals.filter((p) => on.has(p.key))
}

/** What Save draft and Create send: the chosen Views, best first. */
export function planViews(choice: Choice): PlanView[] {
  return chosenInOrder(choice).map((p) => ({
    ...(p.savedId ? { id: p.savedId } : {}),
    viewType: p.viewType,
    label: p.label,
    question: p.question,
  }))
}

/**
 * After a save: each chosen card points at the queued View it became (the
 * server returns them in the order sent), so saving again updates them
 * rather than adding more. Cards no longer chosen lose theirs (deleted).
 */
export function withSavedIds(choice: Choice, draft: Draft): Choice {
  const queued = draft.views.filter((v) => v.status === "queued")
  const saved = new Map(
    chosenInOrder(choice).map((p, i) => [p.key, queued[i]?.viewType === p.viewType ? queued[i]!.id : undefined])
  )
  return {
    ...choice,
    proposals: choice.proposals.map((p) => {
      const { savedId: _old, ...rest } = p
      void _old
      const id = saved.get(p.key)
      return id ? { ...rest, savedId: id } : rest
    }),
  }
}

/** What the skim shouldn't repeat. */
export const existingOf = (choice: Choice) => ({
  existing: choice.proposals.map((p) => ({ viewType: p.viewType, question: p.question })),
  takenIds: choice.proposals.map((p) => p.key),
})

export function createLabel(n: number): string {
  return `Create Expedition with ${n} View${n === 1 ? "" : "s"}`
}

/** "12 Concepts found across 3 Sources". */
export function counterLabel(concepts: number, sources: number): string {
  return `${plural(concepts, "Concept")} found across ${plural(sources, "Source")}`
}

/** A draft's title worth keeping (not the placeholder New gives it). */
export const PLACEHOLDER_TITLE = "Untitled Expedition"
export const hasOwnTitle = (title: string) =>
  !!title.trim() && title.trim() !== PLACEHOLDER_TITLE

// ─── The skim cache ────────────────────────────────────────────────────────

/** Choose Views' state, kept for this tab so a reload doesn't skim again. */
export type FlowCache = {
  /** The Sources the skim read (sorted ids): a different set skims again. */
  sources: string
  goals: Goal[]
  choice: Choice | null
  title: string
  summary: string
}

export const sourcesKey = (sources: readonly DraftSource[]) =>
  sources
    .map((s) => s.id)
    .sort()
    .join(",")

const cacheKey = (expeditionId: string) => `seply-create:${expeditionId}`

export function readCache(expeditionId: string): FlowCache | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(expeditionId))
    return raw ? (JSON.parse(raw) as FlowCache) : null
  } catch {
    return null
  }
}

export function writeCache(expeditionId: string, cache: FlowCache | null) {
  try {
    if (cache) sessionStorage.setItem(cacheKey(expeditionId), JSON.stringify(cache))
    else sessionStorage.removeItem(cacheKey(expeditionId))
  } catch {
    // Storage off (private mode): the flow still works, it just skims again.
  }
}
