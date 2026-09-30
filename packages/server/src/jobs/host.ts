// Runs one attempt of a job inside any engine: the runtime-neutral half of
// the JobRunner. The engine supplies durable `Steps`; this marks the job
// running, runs its definition, and records how it ended, with progress
// events to the room and a web push to whoever started it.
//
// Engines replay `run` from the top after a restart, skipping steps that
// already returned. So everything with a side effect that must not repeat is
// a step; code between steps must be deterministic.
import { makeOps, ulid, type BuildEvent, type Op } from "@seply/domain"
import type { Db } from "../db.ts"
import { appendOps } from "../oplog.ts"
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
  const job = { jobId, expeditionId, kind, startedBy, attempt }
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

  const step: JobContext<unknown>["step"] = (name, fn, options) =>
    steps.do(name, { ...STEP_DEFAULTS, ...options }, fn)

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

  const ctx: JobContext<unknown> = {
    job,
    input,
    step,
    commit,
    progress,
    withDb,
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
