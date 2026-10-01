// Grow asks (spec §3.8, §5.5; WP-4.4), as pure functions the Ask and
// Activity tabs, the Concept actions and use-asks.ts read: what each ask is
// doing in plain words, what it costs, and how a stream part moves it on.
import { formatUsd } from "@/create/flow.ts"
import type {
  AskEstimate,
  AskStreamPart,
  AskView,
  GrowAction,
  Job,
  JobStatus,
} from "@/lib/api.ts"

/** The Concept actions that are Grow asks, in the panel's order (spec §3.7). */
export const GROW_ACTIONS: readonly { action: GrowAction; label: string }[] = [
  { action: "missing", label: "Add what's missing to understand this" },
  { action: "examples", label: "Add examples" },
  { action: "related", label: "Suggest related" },
]

/** The Proposal's rationale a Concept action will have (the server words it the same). */
export function actionRationale(action: GrowAction, title: string): string {
  if (action === "examples") return `Add examples of ${title}`
  if (action === "related") return `Suggest Concepts related to ${title}`
  return `Add what's missing to understand ${title}`
}

/** An ask this tab started or follows: its job, and what its stream said last. */
export type SessionAsk = {
  jobId: string
  kind: string
  rationale: string
  status: JobStatus
  step: string | null
  error: string | null
  /** For a Concept action: which one, and about which Concept. */
  action?: GrowAction
  conceptId?: string
}

const OPEN: readonly JobStatus[] = ["queued", "running"]

/** Still working (Stop applies). */
export const isAsking = (s: JobStatus) => OPEN.includes(s)

export function sessionAsk(job: Job, rationale: string): SessionAsk {
  const input = (job.input ?? {}) as { action?: GrowAction; conceptId?: string }
  return {
    jobId: job.id,
    kind: job.kind,
    rationale,
    status: job.status,
    step: job.step,
    error: job.error,
    ...(input.action && { action: input.action }),
    ...(input.conceptId && { conceptId: input.conceptId }),
  }
}

/** An ask after one `data-ask` part (others leave it as it was). */
export function withPart(ask: SessionAsk, part: AskStreamPart): SessionAsk {
  if (part.type !== "data-ask" || part.id !== ask.jobId) return ask
  return { ...ask, ...part.data }
}

/** "1 change" / "3 changes". */
const changes = (n: number) => (n === 1 ? "1 change" : `${n} changes`)

/**
 * Where an ask stands, in plain words. `suggested` is how many items its
 * Proposal has so far.
 */
export function askStatus(
  ask: Pick<SessionAsk, "status" | "error" | "kind">,
  suggested: number
): string {
  switch (ask.status) {
    case "queued":
      return "Starting…"
    case "running":
      return suggested
        ? `Suggested ${changes(suggested)} so far…`
        : ask.kind === "article"
          ? "Writing the article…"
          : "Thinking about your ask…"
    case "paused":
      return `Stopped at your spending cap${suggested ? ` · ${changes(suggested)} kept` : ""}`
    case "cancelled":
      return `Stopped${suggested ? ` · ${changes(suggested)} kept` : ""}`
    case "failed":
      return ask.error ?? "This ask couldn't be answered."
    default:
      return suggested ? `Suggested ${changes(suggested)}` : "Done"
  }
}

/** Activity's line under an ask: what came of its suggestions. */
export function activityItems(items: AskView["items"]): string {
  const parts = [
    items.pending && `${items.pending} waiting`,
    items.accepted && `${items.accepted} accepted`,
    items.dismissed && `${items.dismissed} dismissed`,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "No suggestions"
}

/** Whose AI an ask uses (spec §3.8). */
export function keyCopy(keySource: AskEstimate["keySource"]): string {
  return keySource === "reader"
    ? "Uses your API key"
    : "Uses this instance's AI"
}

/** What an ask costs, shown before asking: the estimate and the cap that stops it. */
export function costCopy(e: Pick<AskEstimate, "usd" | "askCapUsd">): string {
  return `About ${formatUsd(e.usd)} an ask, at most ${formatUsd(e.askCapUsd)} (your cap)`
}
