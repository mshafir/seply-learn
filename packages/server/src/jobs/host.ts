// Runs one attempt of a job inside any engine: the runtime-neutral half of
// the JobRunner. The engine supplies durable `Steps`; this marks the job
// running, runs its definition, and records how it ended, with progress
// events to the room and a web push to whoever started it.
//
// Engines replay `run` from the top after a restart, skipping steps that
// already returned. So everything with a side effect that must not repeat is
// a step; code between steps must be deterministic.
//
// A step that throws @seply/ai's `SpendingCapReached` is not retried: it is
// recorded as a cap hit, `ctx.step` throws `JobPaused`, and the attempt ends
// `paused` (spec §3.5: Continue or Stop).
import { SpendingCapReached } from "@seply/ai"
import { makeOps, ulid, type BuildEvent, type Op } from "@seply/domain"
import type { Db } from "../db.ts"
import { appendOps } from "../oplog.ts"
import { announceProposals } from "../proposals.ts"
import { publishBuild, publishCommitted } from "../relay.ts"
import { updateOpenJob } from "./store.ts"
import {
  STEP_DEFAULTS,
  type JobContext,
  type JobDeps,
  type JobPayload,
  type JobRegistry,
  type Json,
  type Progress,
  type Steps,
} from "./types.ts"

/** The longest failure reason kept. */
const REASON_MAX = 300

/** The attempt stopped at the spending cap. Let it propagate out of `run`. */
export class JobPaused extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number
  ) {
    super(`Spent $${spentUsd.toFixed(2)} of the $${capUsd.toFixed(2)} cap`)
    this.name = "JobPaused"
  }
}

export const isJobPaused = (err: unknown): err is JobPaused =>
  err instanceof JobPaused

/** How a step that hit the cap is recorded (so a replay pauses again). */
const CAP_HIT = "__spendingCapReached"
type CapHit = { [CAP_HIT]: { spentUsd: number; capUsd: number } }
const isCapHit = (v: unknown): v is CapHit =>
  typeof v === "object" && v !== null && CAP_HIT in v

/** A plain failure reason for readers: the error's message, trimmed. */
export function failureReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const plain = msg.trim() || "Something went wrong"
  return plain.length > REASON_MAX
    ? `${plain.slice(0, REASON_MAX - 1)}…`
    : plain
}

export async function runJob(
  payload: JobPayload,
  steps: Steps,
  deps: JobDeps,
  registry: JobRegistry
): Promise<void> {
  const def = registry.get(payload.kind)
  if (!def) throw new Error(`unknown job kind: ${payload.kind}`)
  const input = def.input.parse(payload.input)
  const { jobId, expeditionId, kind, startedBy, attempt } = payload
  const capRaises = payload.capRaises ?? 0
  const job = { jobId, expeditionId, kind, startedBy, attempt, capRaises }
  const now = deps.now ?? Date.now
  let lastProgress = 0

  const withDb = async <T>(fn: (db: Db) => Promise<T>): Promise<T> => {
    const conn = await deps.connect()
    try {
      return await fn(conn.db)
    } finally {
      await conn.close().catch((err) => console.error("jobs: close", err))
    }
  }

  const step: JobContext<unknown>["step"] = async (name, fn, options) => {
    const out: unknown = await steps.do(
      name,
      { ...STEP_DEFAULTS, ...options },
      async (info): Promise<Json> => {
        try {
          return await fn(info)
        } catch (err) {
          if (!(err instanceof SpendingCapReached)) throw err
          const hit: CapHit = {
            [CAP_HIT]: { spentUsd: err.spentUsd, capUsd: err.capUsd },
          }
          return hit
        }
      }
    )
    if (isCapHit(out)) {
      const { spentUsd, capUsd } = out[CAP_HIT]
      throw new JobPaused(spentUsd, capUsd)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return out as any
  }

  const progress = async (evt: Progress) => {
    const full: BuildEvent = {
      ...evt,
      jobId: job.jobId,
      kind: job.kind,
      at: new Date(now()).toISOString(),
    }
    if (!evt.viewId) lastProgress = evt.progress
    await publishBuild(deps.relay, job.expeditionId, full)
    if (evt.viewId || !isOpen(evt.status)) return
    try {
      await withDb((db) =>
        updateOpenJob(db, job.jobId, job.attempt, {
          step: evt.step,
          progress: evt.progress,
        })
      )
    } catch (err) {
      console.error("jobs: progress not saved", err)
    }
  }

  const commit: JobContext<unknown>["commit"] = async (
    name,
    produce,
    options
  ) => {
    const planned = (await step(
      `${name} (ops)`,
      async () => {
        const { ops, label } = await produce()
        const changeId = ulid(now())
        const logged = makeOps(ops, {
          expeditionId: job.expeditionId,
          actor: job.startedBy,
          changeId,
          nextOpId: () => ulid(now()),
        })
        return { changeId, label, ops: logged } as unknown as Json
      },
      options
    )) as unknown as { changeId: string; label: string; ops: Op[] }
    if (!planned.ops.length) return null
    return step(
      `${name} (commit)`,
      async () => {
        const out = await withDb((db) =>
          db.transaction((tx) =>
            appendOps(tx, {
              expeditionId: job.expeditionId,
              userId: job.startedBy,
              ops: planned.ops,
              changes: [
                { id: planned.changeId, label: planned.label, origin: "build" },
              ],
            })
          )
        )
        await publishCommitted(deps.relay, job.expeditionId, out.logged)
        return out.headSeq
      },
      options
    )
  }

  const announce = async () => {
    try {
      await withDb((db) => announceProposals(db, deps.relay, job.expeditionId))
    } catch (err) {
      console.error("jobs: announcing Proposals failed", err)
    }
  }

  const ctx: JobContext<unknown> = {
    job,
    input,
    step,
    commit,
    progress,
    withDb,
    announceProposals: announce,
    services: deps.services ?? {},
  }

  /** Moves the job's row; false when it had ended or moved on (cancel, retry). */
  const mark = (
    name: string,
    set: Parameters<typeof updateOpenJob>[3]
  ): Promise<boolean> =>
    step(
      name,
      () =>
        withDb((db) => updateOpenJob(db, job.jobId, job.attempt, set)).then(
          (j) => !!j
        ),
      { retries: 5 }
    )

  const started = await mark("job: start", {
    status: "running",
    step: "Starting",
    progress: 0,
  })
  if (!started) return // cancelled before it began
  await progress({ status: "running", step: "Starting", progress: 0 })

  let failure: unknown = null
  try {
    await def.run(ctx)
  } catch (err) {
    failure = err
  }

  if (isJobPaused(failure)) {
    const reason = failure.message
    const paused = await mark("job: paused", {
      status: "paused",
      step: "Paused at the spending cap",
      progress: lastProgress,
      error: reason,
    })
    if (paused)
      await progress({
        status: "paused",
        step: "Paused at the spending cap",
        progress: lastProgress,
        reason,
      })
    return
  }

  const outcome = failure ? "failed" : "complete"
  const reason = failure ? failureReason(failure) : undefined
  const ended = await mark(`job: ${outcome}`, {
    status: outcome,
    step: failure ? "Failed" : "Done",
    progress: failure ? lastProgress : 1,
    error: reason ?? null,
  })
  if (ended) {
    await progress({
      status: outcome,
      step: failure ? "Failed" : "Done",
      progress: failure ? lastProgress : 1,
      reason,
    })
    const note = def.notification?.(job, outcome)
    const notify = deps.notify
    if (note && notify) {
      await step(
        "job: notify",
        async () => {
          await withDb((db) =>
            notify(db, job.startedBy, {
              ...note,
              url: `/e/${job.expeditionId}`,
              tag: `job-${job.jobId}`,
            })
          )
          return true
        },
        { retries: 2 }
      ).catch((err) => console.error("jobs: notify failed", err))
    }
  }
  // The engine records the attempt as failed too (a Workflow instance errors).
  if (failure) throw failure
}

const isOpen = (s: BuildEvent["status"]) =>
  s === "queued" || s === "running" || s === "building"
