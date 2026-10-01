// Grow asks on the Expedition screen (spec §3.8, §5.5; WP-4.4), for owners
// and editors online.
//
// - `ask` starts a `grow` job (the Ask box, a Concept action); `follow`
//   follows one started elsewhere ("Write the article"). Each ask this tab
//   follows streams from GET …/asks/:jobId/stream: its `data-proposal` parts
//   go to `onProposal` (use-proposals.ts's `ingest`, so items appear in
//   Suggestions and dashed on the canvas as they arrive), its `data-ask`
//   parts move the ask on. A stream that drops while the ask still runs is
//   opened again.
// - `stop` is the job's Cancel (what streamed is kept); `resume` its Continue
//   past the per-ask cap.
// - Activity (every ask, with who asked) loads on demand, and again when an
//   ask this tab follows ends. Asks of mine still running there (after a
//   reload) are followed again.
// - The estimate (what an ask costs here, and the cap) loads on demand.
import * as React from "react"
import type { ProposalView } from "@seply/domain"

import {
  isAsking,
  sessionAsk,
  withPart,
  type SessionAsk,
} from "@/expedition/asks.ts"
import {
  estimateAsk,
  jobAction,
  listAsks,
  startJob,
  streamAsk,
  type AskEstimate,
  type AskView,
  type GrowInput,
  type Job,
} from "@/lib/api.ts"

/** How long to wait before opening a dropped stream again, and how often. */
const REOPEN_MS = 1_000
const REOPEN_TRIES = 30

export type Asks = {
  /** Asks this tab started or follows, oldest first. */
  asks: SessionAsk[]
  /** The newest Proposal each followed ask streamed, by job id (= Proposal id). */
  streamed: Readonly<Record<string, ProposalView>>
  /** Activity: every ask, newest first; null until loaded. */
  activity: AskView[] | null
  activityError: unknown
  refreshActivity: () => Promise<void>
  estimate: AskEstimate | null
  estimateError: unknown
  /** Loads the estimate (once; again with `force`). */
  loadEstimate: (force?: boolean) => void
  /** Starts a Grow ask; resolves with its job (throws when it can't start). */
  ask: (input: GrowInput, rationale: string) => Promise<Job>
  /** Follows an ask started elsewhere (e.g. "Write the article"). */
  follow: (job: Job, rationale: string) => void
  /** Stop: cancels the ask; what it suggested stays. */
  stop: (jobId: string) => Promise<void>
  /** Continue past the per-ask cap (the cap again). */
  resume: (jobId: string) => Promise<void>
}

export function useAsks({
  expeditionId,
  enabled,
  me,
  onProposal,
  onJob,
  onEnded,
}: {
  expeditionId: string
  enabled: boolean
  /** The signed-in reader: their running asks in Activity are followed again. */
  me: string | null
  onProposal: (p: ProposalView) => void
  /** A job row an action returned (the builds log tracks asks too). */
  onJob?: (job: Job) => void
  /** An ask this tab follows has ended or paused. */
  onEnded?: (ask: SessionAsk) => void
}): Asks {
  const [asks, setAsks] = React.useState<SessionAsk[]>([])
  const [streamed, setStreamed] = React.useState<Record<string, ProposalView>>(
    {}
  )
  const [activity, setActivity] = React.useState<{
    asks: AskView[] | null
    error: unknown
  }>({ asks: null, error: null })
  const [estimate, setEstimate] = React.useState<{
    value: AskEstimate | null
    error: unknown
  }>({ value: null, error: null })

  const handlers = React.useRef({ onProposal, onJob, onEnded })
  React.useEffect(() => {
    handlers.current = { onProposal, onJob, onEnded }
  })
  const asksRef = React.useRef(asks)
  React.useEffect(() => {
    asksRef.current = asks
  })
  const streams = React.useRef(new Map<string, AbortController>())
  React.useEffect(() => {
    const open = streams.current
    return () => {
      for (const c of open.values()) c.abort()
      open.clear()
    }
  }, [])

  const refreshRef = React.useRef<() => Promise<void>>(async () => {})

  const open = React.useCallback(
    (jobId: string, tries = 0) => {
      if (streams.current.has(jobId)) return
      const ctl = new AbortController()
      streams.current.set(jobId, ctl)
      let last: SessionAsk["status"] | null = null
      streamAsk(
        expeditionId,
        jobId,
        (part) => {
          if (part.type === "data-proposal") {
            setStreamed((all) => ({ ...all, [jobId]: part.data }))
            handlers.current.onProposal(part.data)
          } else if (part.type === "data-ask") {
            last = part.data.status
            setAsks((all) => all.map((a) => withPart(a, part)))
          }
        },
        ctl.signal
      )
        .catch((e) => console.error("asks: stream failed", e))
        .finally(() => {
          if (streams.current.get(jobId) === ctl) streams.current.delete(jobId)
          if (ctl.signal.aborted) return
          if ((last === null || isAsking(last)) && tries < REOPEN_TRIES) {
            window.setTimeout(() => open(jobId, tries + 1), REOPEN_MS)
            return
          }
          const ask = asksRef.current.find((a) => a.jobId === jobId)
          if (ask)
            handlers.current.onEnded?.({ ...ask, status: last ?? ask.status })
          void refreshRef.current()
        })
    },
    [expeditionId]
  )

  const add = React.useCallback(
    (ask: SessionAsk) => {
      setAsks((all) =>
        all.some((a) => a.jobId === ask.jobId) ? all : [...all, ask]
      )
      open(ask.jobId)
    },
    [open]
  )

  const refreshActivity = React.useCallback(async () => {
    if (!enabled) return
    try {
      const list = await listAsks(expeditionId)
      setActivity({ asks: list, error: null })
      // Mine, still running, from before a reload: follow them again.
      for (const a of list)
        if (
          a.author.id === me &&
          isAsking(a.status) &&
          !asksRef.current.some((s) => s.jobId === a.jobId)
        )
          add({
            jobId: a.jobId,
            kind: a.kind,
            rationale: a.rationale,
            status: a.status,
            step: a.step,
            error: a.error,
          })
    } catch (error) {
      setActivity((s) => ({ ...s, error }))
    }
  }, [enabled, expeditionId, me, add])
  React.useEffect(() => {
    refreshRef.current = refreshActivity
  })

  const estimating = React.useRef(false)
  const tried = !!estimate.value || !!estimate.error
  const loadEstimate = React.useCallback(
    (force = false) => {
      if (!enabled || estimating.current || (tried && !force)) return
      estimating.current = true
      estimateAsk(expeditionId)
        .then(
          (value) => setEstimate({ value, error: null }),
          (error) => setEstimate({ value: null, error })
        )
        .finally(() => {
          estimating.current = false
        })
    },
    [enabled, expeditionId, tried]
  )

  const ask = React.useCallback(
    async (input: GrowInput, rationale: string) => {
      const job = await startJob(expeditionId, "grow", input)
      handlers.current.onJob?.(job)
      add(sessionAsk(job, rationale))
      return job
    },
    [expeditionId, add]
  )

  const follow = React.useCallback(
    (job: Job, rationale: string) => add(sessionAsk(job, rationale)),
    [add]
  )

  const act = React.useCallback(
    async (jobId: string, action: "cancel" | "continue") => {
      const job = await jobAction(jobId, action)
      handlers.current.onJob?.(job)
      setAsks((all) =>
        all.map((a) =>
          a.jobId === jobId
            ? { ...a, status: job.status, step: job.step, error: job.error }
            : a
        )
      )
      if (action === "continue") open(jobId)
      else void refreshActivity()
    },
    [open, refreshActivity]
  )

  return {
    asks,
    streamed,
    activity: activity.asks,
    activityError: activity.error,
    refreshActivity,
    estimate: estimate.value,
    estimateError: estimate.error,
    loadEstimate,
    ask,
    follow,
    stop: (jobId) => act(jobId, "cancel"),
    resume: (jobId) => act(jobId, "continue"),
  }
}
