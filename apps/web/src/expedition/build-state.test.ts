import type { BuildEvent } from "@seply/domain"
import { describe, expect, it } from "vitest"

import type { Job } from "@/lib/api.ts"
import {
  activeJob,
  buildSummary,
  EMPTY_LOG,
  readyLabel,
  receive,
  retryableJob,
  startViewOf,
  viewBuild,
  withJob,
  withJobs,
  type BuildLog,
} from "./build-state.ts"

const at = (s: number) =>
  new Date(Date.UTC(2026, 8, 30, 12, 0, s)).toISOString()

const job = (over: Partial<Job> = {}): Job => ({
  id: "J1",
  expeditionId: "E",
  kind: "fake",
  input: {},
  startedBy: "U",
  status: "running",
  step: "Starting",
  progress: 0,
  error: null,
  attempt: 1,
  capRaises: 0,
  createdAt: at(0),
  updatedAt: at(0),
  ...over,
})

const evt = (over: Partial<BuildEvent> & { at: string }): BuildEvent => ({
  jobId: "J1",
  kind: "fake",
  status: "running",
  step: "Working",
  progress: 0,
  ...over,
})

const build = (log: BuildLog, e: BuildEvent) =>
  receive(log, { t: "build", ...e })

const queued = { id: "V1", status: "queued" as const }
const v2 = { id: "V2", status: "queued" as const }

describe("a View's build status", () => {
  it("is queued until the jobs are known, then waits its turn", () => {
    expect(viewBuild(queued, EMPTY_LOG)).toEqual({
      status: "queued",
      step: "Queued",
    })
    const log = withJobs(EMPTY_LOG, [job()])
    expect(viewBuild(queued, log)).toEqual({
      status: "queued",
      step: "Waiting its turn",
    })
  })

  it("builds with the step, progress and every streamed Concept", () => {
    let log = withJobs(EMPTY_LOG, [job()])
    log = build(
      log,
      evt({
        at: at(1),
        viewId: "V1",
        status: "building",
        step: "Building Test View 1",
        progress: 0.2,
        previewNodes: [{ id: "a", title: "A" }],
      })
    )
    log = build(
      log,
      evt({
        at: at(2),
        viewId: "V1",
        status: "building",
        step: "Linking",
        progress: 0.5,
        previewNodes: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
      })
    )
    expect(viewBuild(queued, log)).toEqual({
      status: "building",
      step: "Linking",
      progress: 0.5,
      previewNodes: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    })
    // Other Views still wait.
    expect(viewBuild(v2, log).status).toBe("queued")
  })

  it("is ready or failed as soon as the event says so, before the pull", () => {
    let log = withJobs(EMPTY_LOG, [job()])
    log = build(
      log,
      evt({ at: at(1), viewId: "V1", status: "ready", progress: 1 })
    )
    expect(viewBuild(queued, log)).toEqual({ status: "ready" })
    log = build(
      log,
      evt({
        at: at(2),
        viewId: "V2",
        status: "failed",
        reason: "Only one estimate",
      })
    )
    expect(viewBuild(v2, log)).toEqual({
      status: "failed",
      reason: "Only one estimate",
    })
  })

  it("reads a failure from the log after the job has ended", () => {
    const log = withJobs(EMPTY_LOG, [job({ status: "failed", error: "x" })])
    expect(
      viewBuild(
        { id: "V1", status: "failed", failReason: "Too few dates" },
        log
      )
    ).toEqual({ status: "failed", reason: "Too few dates" })
    expect(viewBuild({ id: "V1", status: "failed" }, log)).toEqual({
      status: "failed",
      reason: "This View couldn't be built.",
    })
  })

  it("is stopped when a cancelled job left it queued", () => {
    let log = withJobs(EMPTY_LOG, [job()])
    log = build(log, evt({ at: at(1), viewId: "V1", status: "building" }))
    log = build(log, evt({ at: at(2), status: "cancelled", step: "Cancelled" }))
    expect(activeJob(log)).toBeNull()
    expect(viewBuild(queued, log)).toEqual({
      status: "stopped",
      reason: "The build was stopped before this View was built.",
    })
    expect(viewBuild({ id: "V3", status: "ready" }, log)).toEqual({
      status: "ready",
    })
    expect(retryableJob(log)?.id).toBe("J1")
  })

  it("forgets a retried job's old events", () => {
    let log = withJobs(EMPTY_LOG, [job({ status: "failed", updatedAt: at(3) })])
    log = build(
      log,
      evt({ at: at(2), viewId: "V1", status: "failed", reason: "Nope" })
    )
    const failedView = {
      id: "V1",
      status: "failed" as const,
      failReason: "Nope",
    }
    expect(viewBuild(failedView, log).status).toBe("failed")
    // Retry: the row comes back queued, and the room announces it.
    log = withJob(log, job({ status: "queued", attempt: 2, updatedAt: at(4) }))
    log = build(log, evt({ at: at(4), status: "queued", step: "Queued" }))
    expect(activeJob(log)?.status).toBe("queued")
    // The pull sets it back to queued in the log.
    expect(viewBuild(queued, log)).toEqual({
      status: "queued",
      step: "Waiting its turn",
    })
    expect(log.previews).toEqual({})
  })

  it("waits at the spending cap", () => {
    let log = withJobs(EMPTY_LOG, [job()])
    log = build(
      log,
      evt({
        at: at(1),
        status: "paused",
        step: "Paused at the spending cap",
        reason: "Spent $0.50 of the $0.50 cap",
      })
    )
    expect(activeJob(log)).toMatchObject({
      status: "paused",
      reason: "Spent $0.50 of the $0.50 cap",
    })
    expect(viewBuild(queued, log)).toEqual({
      status: "queued",
      step: "Paused at the spending cap",
    })
  })
})

describe("jobs", () => {
  it("overlays newer events on the rows, and knows jobs seen only live", () => {
    let log = withJobs(EMPTY_LOG, [
      job({ status: "complete", updatedAt: at(5) }),
    ])
    // An older event doesn't override the row.
    log = build(log, evt({ at: at(1), status: "running" }))
    expect(activeJob(log)).toBeNull()
    log = build(
      log,
      evt({ jobId: "J2", at: at(6), status: "queued", step: "Queued" })
    )
    expect(activeJob(log)).toMatchObject({ id: "J2", status: "queued" })
  })

  it("keeps the newest event of each key through a hello", () => {
    let log = withJobs(EMPTY_LOG, [job()])
    log = build(
      log,
      evt({ at: at(3), viewId: "V1", status: "building", step: "B" })
    )
    log = receive(log, {
      t: "hello",
      headSeq: 3,
      presence: [],
      builds: [evt({ at: at(2), viewId: "V1", status: "building", step: "A" })],
    })
    expect(viewBuild(queued, log)).toMatchObject({ step: "B" })
  })
})

describe("the summary", () => {
  it("counts ready, pending and failed Views", () => {
    let log = withJobs(EMPTY_LOG, [job()])
    log = build(log, evt({ at: at(1), viewId: "V2", status: "building" }))
    const s = buildSummary(
      [
        { id: "V1", status: "ready" },
        { id: "V2", status: "queued" },
        { id: "V3", status: "failed" },
      ],
      log
    )
    expect(s).toMatchObject({ ready: 1, total: 3, pending: 1, failed: 1 })
    expect(s.job?.id).toBe("J1")
    expect(readyLabel(s)).toBe("1 of 3 Views ready")
    expect(readyLabel({ ready: 0, total: 1 })).toBe("0 of 1 View ready")
  })
})

describe("the View a screen opens on", () => {
  const views = [{ id: "A" }, { id: "B" }, { id: "C" }]
  const readyOf =
    (...ids: string[]) =>
    (v: { id: string }) =>
      ids.includes(v.id)

  it("is the best View once it is ready", () => {
    expect(startViewOf(views, "C", readyOf("B", "C"))?.id).toBe("C")
  })
  it("is the first ready one while the best still builds", () => {
    expect(startViewOf(views, "C", readyOf("B"))?.id).toBe("B")
  })
  it("is the best, else the first, while nothing is ready", () => {
    expect(startViewOf(views, "C", readyOf())?.id).toBe("C")
    expect(startViewOf(views, null, readyOf())?.id).toBe("A")
    expect(startViewOf([], null, readyOf())).toBeNull()
  })
})
