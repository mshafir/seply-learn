// The JobRunner the API calls, over any engine. It owns the `jobs` rows and
// the lifecycle events the room sees before and after an attempt runs
// (queued, cancelled); the attempt itself reports through `runJob`.
import { ulid, type BuildEvent } from "@seply/domain"
import type { Db } from "../db.ts"
import { publishBuild, type Relay } from "../relay.ts"
import {
  getJob,
  insertJob,
  isEnded,
  reopenJob,
  runningJobs,
  updateOpenJob,
} from "./store.ts"
import {
  instanceId,
  type Job,
  type JobEngine,
  type JobPayload,
  type JobRegistry,
  type JobRunner,
} from "./types.ts"

/** A refused runner call: the HTTP status and message to answer with. */
export class JobError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message)
    this.name = "JobError"
  }
}

export const payloadOf = (j: Job): JobPayload => ({
  jobId: j.id,
  expeditionId: j.expeditionId,
  kind: j.kind,
  input: j.input,
  startedBy: j.startedBy,
  attempt: j.attempt,
  capRaises: j.capRaises,
})

export function createJobRunner(opts: {
  engine: JobEngine
  registry: JobRegistry
  relay: Relay
  now?: () => number
}): JobRunner {
  const { engine, registry, relay } = opts
  const now = opts.now ?? Date.now

  const announce = (j: Job, evt: Pick<BuildEvent, "status" | "step">) =>
    publishBuild(relay, j.expeditionId, {
      ...evt,
      jobId: j.id,
      kind: j.kind,
      progress: j.progress,
      at: new Date(now()).toISOString(),
    })

  const launch = async (db: Db, j: Job) => {
    await announce(j, { status: "queued", step: "Queued" })
    try {
      await engine.launch(payloadOf(j))
    } catch (err) {
      console.error("jobs: launch failed", err)
      const failed = await updateOpenJob(db, j.id, j.attempt, {
        status: "failed",
        step: "Failed",
        error: "The job could not be started",
      })
      if (failed) await announce(failed, { status: "failed", step: "Failed" })
      return failed ?? j
    }
    return j
  }

  const mustGet = async (db: Db, id: string) => {
    const j = await getJob(db, id)
    if (!j) throw new JobError(404, "job not found")
    return j
  }

  return {
    registry,

    async start(db, req) {
      const def = registry.get(req.kind)
      if (!def) throw new JobError(400, `unknown job kind: ${req.kind}`)
      const j = await insertJob(db, {
        id: ulid(now()),
        expeditionId: req.expeditionId,
        kind: req.kind,
        input: req.input ?? {},
        startedBy: req.startedBy,
      })
      return launch(db, j)
    },

    async cancel(db, id) {
      const j = await mustGet(db, id)
      if (isEnded(j.status)) throw new JobError(409, `the job is ${j.status}`)
      try {
        await engine.terminate(instanceId({ jobId: j.id, attempt: j.attempt }))
      } catch (err) {
        // Marked cancelled anyway: runJob stops writing once it has ended.
        console.error("jobs: terminate failed", err)
      }
      const cancelled = await updateOpenJob(db, j.id, j.attempt, {
        status: "cancelled",
        step: "Cancelled",
      })
      if (!cancelled) return mustGet(db, id) // it ended meanwhile
      await announce(cancelled, { status: "cancelled", step: "Cancelled" })
      return cancelled
    },

    async retry(db, id) {
      const j = await mustGet(db, id)
      if (!isEnded(j.status) || j.status === "complete")
        throw new JobError(409, `the job is ${j.status}`)
      const reopened = await reopenJob(db, id)
      if (!reopened) throw new JobError(409, "the job was retried already")
      return launch(db, reopened)
    },

    async continue(db, id) {
      const j = await mustGet(db, id)
      if (j.status !== "paused")
        throw new JobError(409, `the job is ${j.status}`)
      const reopened = await reopenJob(db, id, { capRaise: true })
      if (!reopened) throw new JobError(409, "the job was continued already")
      return launch(db, reopened)
    },

    async wake(db) {
      const wake = engine.wake?.bind(engine)
      if (!wake) return 0
      const open = await runningJobs(db)
      await Promise.all(
        open.map((j) =>
          wake(instanceId({ jobId: j.id, attempt: j.attempt })).catch((err) =>
            console.error("jobs: wake failed", j.id, err)
          )
        )
      )
      return open.length
    },
  }
}
