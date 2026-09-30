// What the Expedition screen knows about its builds (spec §3.5), as pure
// functions over the room's `build` events (@seply/sync's RoomClient) and the
// jobs list (GET /api/expeditions/:id/jobs). The Views rail, the canvas, the
// header activity indicator and the toasts all read it.
//
// A View's own status (queued, building, ready, failed) and failure reason
// are logged fields; events arrive before the pull that brings them, so the
// newest event about a View wins over its logged status while its job runs.
// Queued or building Views that no running job will build (the job was
// cancelled, stopped at the spending cap, or failed on another View) are
// "stopped": the build left them behind, and they can be retried or removed.
import type { BuildEvent, PreviewNode, RoomMessage } from "@seply/domain"
import type { ViewRow } from "@seply/sync"

import type { Job, JobStatus } from "@/lib/api.ts"

/** A job as the screen sees it: its row, updated by its newest event. */
export type JobState = {
  id: string
  kind: string
  status: JobStatus
  step: string | null
  progress: number
  /** Why it failed, or how far it got at the spending cap. */
  reason: string | null
}

export type BuildLog = {
  /** The newest event of each job and each View it builds, by `jobId[/viewId]`. */
  events: Record<string, BuildEvent>
  /** Concepts streamed into each building View so far, by View id. */
  previews: Record<string, PreviewNode[]>
  /** The Expedition's jobs, newest first; null until loaded. */
  jobs: Job[] | null
}

export const EMPTY_LOG: BuildLog = { events: {}, previews: {}, jobs: null }

const OPEN: readonly JobStatus[] = ["queued", "running", "paused"]
const RETRYABLE: readonly JobStatus[] = ["failed", "cancelled"]

const keyOf = (e: Pick<BuildEvent, "jobId" | "viewId">) =>
  e.viewId ? `${e.jobId}/${e.viewId}` : e.jobId

const newer = (a: BuildEvent, b: BuildEvent | undefined) => !b || a.at >= b.at

/** A job starts an attempt (queued again: Retry, Continue): forget its Views' old events. */
function restart(log: BuildLog, jobId: string): BuildLog {
  const prefix = `${jobId}/`
  const events = Object.fromEntries(
    Object.entries(log.events).filter(([k]) => !k.startsWith(prefix))
  )
  const stale = new Set(
    Object.values(log.events)
      .filter((e) => e.jobId === jobId && e.viewId)
      .map((e) => e.viewId!)
  )
  const previews = Object.fromEntries(
    Object.entries(log.previews).filter(([id]) => !stale.has(id))
  )
  return { ...log, events, previews }
}

function addEvent(log: BuildLog, evt: BuildEvent): BuildLog {
  const key = keyOf(evt)
  if (!newer(evt, log.events[key])) return log
  if (!evt.viewId && evt.status === "queued") log = restart(log, evt.jobId)
  const events = { ...log.events, [key]: evt }
  if (!evt.viewId || !evt.previewNodes?.length) return { ...log, events }
  const had = log.previews[evt.viewId] ?? []
  const known = new Set(had.map((n) => n.id))
  const added = evt.previewNodes.filter((n) => !known.has(n.id))
  return {
    ...log,
    events,
    previews: added.length
      ? { ...log.previews, [evt.viewId]: [...had, ...added] }
      : log.previews,
  }
}

/** Folds one room message into the log (`hello` and `build`; others pass). */
export function receive(log: BuildLog, msg: RoomMessage): BuildLog {
  if (msg.t === "hello") return msg.builds.reduce(addEvent, log)
  if (msg.t === "build") return addEvent(log, msg)
  return log
}

export function withJobs(log: BuildLog, jobs: Job[]): BuildLog {
  return { ...log, jobs }
}

/** One job as an action (start, Retry, Continue, Cancel) returned it. */
export function withJob(log: BuildLog, job: Job): BuildLog {
  const next = job.status === "queued" ? restart(log, job.id) : log
  const events = { ...next.events }
  // The row is the news now; an older job-level event mustn't override it.
  if (events[job.id] && events[job.id]!.at < job.updatedAt)
    delete events[job.id]
  const rest = (log.jobs ?? []).filter((j) => j.id !== job.id)
  return {
    ...next,
    events,
    jobs: [job, ...rest].sort((a, b) => (a.id < b.id ? 1 : -1)),
  }
}

/** Every job, newest first: the list, each updated by a newer event, plus jobs only seen live. */
export function jobStates(log: BuildLog): JobState[] {
  const jobEvents = Object.values(log.events).filter((e) => !e.viewId)
  const byId = new Map(jobEvents.map((e) => [e.jobId, e]))
  const out: JobState[] = (log.jobs ?? []).map((j) => {
    const evt = byId.get(j.id)
    byId.delete(j.id)
    // The row wins when it is newer (a retry after the failure event).
    if (evt && evt.at >= j.updatedAt)
      return {
        id: j.id,
        kind: j.kind,
        status: evt.status as JobStatus,
        step: evt.step,
        progress: evt.progress,
        reason: evt.reason ?? (evt.status === j.status ? j.error : null),
      }
    return {
      id: j.id,
      kind: j.kind,
      status: j.status,
      step: j.step,
      progress: j.progress,
      reason: j.error,
    }
  })
  const unseen = [...byId.values()].map((e): JobState => ({
    id: e.jobId,
    kind: e.kind,
    status: e.status as JobStatus,
    step: e.step,
    progress: e.progress,
    reason: e.reason ?? null,
  }))
  // Job ids are ULIDs: newest first.
  return [...unseen, ...out].sort((a, b) => (a.id < b.id ? 1 : -1))
}

/** The job building now (queued, running or paused at the cap), newest first. */
export function activeJob(log: BuildLog): JobState | null {
  return jobStates(log).find((j) => OPEN.includes(j.status)) ?? null
}

/** The newest job that Retry can start again (failed or cancelled). */
export function retryableJob(log: BuildLog): JobState | null {
  const newest = jobStates(log).find((j) => !OPEN.includes(j.status))
  return newest && RETRYABLE.includes(newest.status) ? newest : null
}

export type ViewBuild =
  | { status: "ready" }
  | { status: "queued"; step: string }
  | {
      status: "building"
      step: string
      progress: number
      previewNodes: PreviewNode[]
    }
  | { status: "failed"; reason: string }
  /** Queued or building, and nothing running will build it. */
  | { status: "stopped"; reason: string }

/** The newest event about one View, from any job. */
function latestFor(log: BuildLog, viewId: string): BuildEvent | undefined {
  let best: BuildEvent | undefined
  for (const e of Object.values(log.events))
    if (e.viewId === viewId && newer(e, best)) best = e
  return best
}

export const DEFAULT_FAIL_REASON = "This View couldn't be built."

/** One View's build status, for the rail and the canvas. */
export function viewBuild(
  view: Pick<ViewRow, "id" | "status" | "failReason">,
  log: BuildLog
): ViewBuild {
  const job = activeJob(log)
  const evt = latestFor(log, view.id)
  // A retry sets a failed View back to queued in the log; until that pull
  // arrives, an event from the job now running is the fresher news.
  const evtCurrent = !!evt && !!job && evt.jobId === job.id
  if (view.status === "ready" || evt?.status === "ready")
    return { status: "ready" }
  if (evt?.status === "failed" && (!job || evtCurrent))
    return { status: "failed", reason: evt.reason || DEFAULT_FAIL_REASON }
  if (view.status === "failed" && !evtCurrent)
    return {
      status: "failed",
      reason: view.failReason || DEFAULT_FAIL_REASON,
    }
  if (job) {
    if (evtCurrent && evt!.status === "building")
      return {
        status: "building",
        step: evt!.step,
        progress: evt!.progress,
        previewNodes: log.previews[view.id] ?? [],
      }
    return {
      status: "queued",
      step:
        job.status === "paused"
          ? "Paused at the spending cap"
          : "Waiting its turn",
    }
  }
  if (log.jobs === null) return { status: "queued", step: "Queued" }
  const last = jobStates(log)[0]
  return {
    status: "stopped",
    reason:
      last?.status === "cancelled"
        ? "The build was stopped before this View was built."
        : last?.status === "failed"
          ? "The build ended before this View was built."
          : "Nothing is building this View.",
  }
}

export type BuildSummary = {
  job: JobState | null
  ready: number
  total: number
  /** Views building or waiting to. */
  pending: number
  failed: number
}

export function buildSummary(
  views: readonly Pick<ViewRow, "id" | "status" | "failReason">[],
  log: BuildLog
): BuildSummary {
  const statuses = views.map((v) => viewBuild(v, log).status)
  const count = (...s: ViewBuild["status"][]) =>
    statuses.filter((x) => s.includes(x)).length
  return {
    job: activeJob(log),
    ready: count("ready"),
    total: views.length,
    pending: count("queued", "building"),
    failed: count("failed", "stopped"),
  }
}

/** "1 of 3 Views ready" */
export function readyLabel(s: Pick<BuildSummary, "ready" | "total">): string {
  return `${s.ready} of ${s.total} ${s.total === 1 ? "View" : "Views"} ready`
}
