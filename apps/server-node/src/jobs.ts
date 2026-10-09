// Jobs on Node (spec §2.5): pg-boss in Postgres, with an in-process worker.
// One pg-boss job per attempt (`<jobId>-<attempt>`, as a Workflow instance on
// Cloudflare), with the same step semantics as Workflows: each `ctx.step`'s
// result is recorded in `job_steps`, retried with backoff on a throw, and a
// replay of the attempt returns recorded results instead of running steps
// again. pg-boss heartbeats each running job, so when an instance dies (a
// crash, a deploy) another instance, or this one restarted, picks the
// attempt up again after `heartbeatSeconds` and replays it from its last
// recorded step. Cancel marks the job's row `cancelled`; the attempt stops
// at its next step boundary, whichever instance runs it.
import { createHash } from "node:crypto"
import {
  instanceId,
  publishBuild,
  runJob,
  type Job,
  type JobDeps,
  type JobEngine,
  type JobPayload,
  type JobRegistry,
  type Json,
  type Steps,
} from "@seply/server"
import type pg from "pg"
import { PgBoss, type Job as BossJob } from "pg-boss"

export const JOB_QUEUE = "seply-jobs"

/** Thrown into a run that should stop: cancelled, or retried as a new attempt. */
class Halted extends Error {
  constructor() {
    super("halted")
  }
}

/** pg-boss ids are UUIDs: one derived from the attempt's id, so a launch is idempotent. */
export function bossJobId(id: string): string {
  const h = createHash("sha1").update(`seply-job:${id}`).digest("hex")
  // A version-5-shaped UUID (name-based, SHA-1).
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) +
      h.slice(18, 20),
    h.slice(20, 32),
  ].join("-")
}

/** How many times pg-boss starts an attempt again after its instance died. */
const RESTARTS = 20

export type PgBossEngine = JobEngine & {
  /** Creates the queue and starts this instance's workers. */
  start(): Promise<void>
  /** Stops taking new jobs; running ones finish or are picked up again later. */
  stop(): Promise<void>
  /**
   * Tests: simulates this instance dying. Every attempt it runs stops at its
   * next step boundary, and the step in flight is not recorded. (Stop its
   * pg-boss without grace too, so another instance picks the attempts up.)
   */
  halt(): void
}

export function createPgBossEngine(opts: {
  boss: PgBoss
  pool: pg.Pool
  deps: JobDeps
  registry: JobRegistry
  concurrency: number
  heartbeatSeconds: number
  /** Polling for new jobs (pg-boss's `pollingIntervalSeconds`). */
  pollingSeconds?: number
}): PgBossEngine {
  const { boss, pool, deps, registry } = opts
  /** Bumped by `halt`: a run of an older generation stops. */
  let generation = 0

  /** Whether this attempt may go on: not cancelled, not moved on to another attempt. */
  const live = async (p: JobPayload) => {
    const { rows } = await pool.query<{ status: string; attempt: number }>(
      "select status, attempt from jobs where id = $1",
      [p.jobId]
    )
    const row = rows[0]
    return !!row && row.attempt === p.attempt && row.status !== "cancelled"
  }

  const durableSteps = async (p: JobPayload): Promise<Steps> => {
    const gen = generation
    const halted = () => gen !== generation
    const { rows } = await pool.query<{ name: string; result: Json }>(
      "select name, result from job_steps where job_id = $1 and attempt = $2",
      [p.jobId, p.attempt]
    )
    const recorded = new Map(rows.map((r) => [r.name, r.result]))
    if (recorded.size)
      console.log(
        `jobs: resuming ${instanceId(p)} after ${recorded.size} recorded steps`
      )
    return {
      async do(name, options, fn) {
        if (halted()) throw new Halted()
        if (recorded.has(name)) return recorded.get(name) as never
        if (!(await live(p))) throw new Halted()
        for (let attempt = 1; ; attempt++) {
          try {
            // A cancel (on any instance) stops waiting for the step at once,
            // so the attempt frees its worker; what the step still does
            // is never recorded.
            const value = await untilCancelled(
              withTimeout(fn({ attempt }), options.timeoutMs, name),
              async () => halted() || !(await live(p))
            )
            if (halted()) throw new Halted()
            await pool.query(
              `insert into job_steps (job_id, attempt, name, result)
               values ($1, $2, $3, $4::jsonb) on conflict do nothing`,
              [p.jobId, p.attempt, name, JSON.stringify(value ?? null)]
            )
            recorded.set(name, structuredClone(value))
            return value
          } catch (err) {
            if (err instanceof Halted || halted()) throw new Halted()
            if (attempt > options.retries) throw err
            if (!(await live(p))) throw new Halted()
            await sleep(options.retryDelayMs * 2 ** (attempt - 1))
          }
        }
      },
    }
  }

  /** One attempt, as pg-boss hands it to this instance. */
  const run = async (job: BossJob<JobPayload>) => {
    const p = job.data
    try {
      await runJob(p, await durableSteps(p), deps, registry)
    } catch (err) {
      if (err instanceof Halted) return
      // `runJob` rethrows a job's failure once it has recorded it (so a
      // Workflow instance errors): the attempt is over, and running it again
      // would only replay it. Only an attempt left open is retried.
      if (!(await stillOpen(p))) return
      if (job.retryCount < RESTARTS) throw err // pg-boss starts it again
      // Out of restarts: the job ends failed rather than running forever.
      console.error(`jobs: ${instanceId(p)} gave up`, err)
      await giveUp(p)
    }
  }

  /** Whether this attempt's row is still queued or running (it didn't finish). */
  const stillOpen = async (p: JobPayload) => {
    const { rows } = await pool.query<{ status: string; attempt: number }>(
      "select status, attempt from jobs where id = $1",
      [p.jobId]
    )
    const row = rows[0]
    return (
      !!row &&
      row.attempt === p.attempt &&
      (row.status === "queued" || row.status === "running")
    )
  }

  const giveUp = async (p: JobPayload) => {
    const { rows } = await pool.query<Job & { progress: number }>(
      `update jobs set status = 'failed', step = 'Failed',
         error = 'The job stopped unexpectedly', updated_at = now()
       where id = $1 and attempt = $2
         and status not in ('complete', 'failed', 'cancelled')
       returning progress`,
      [p.jobId, p.attempt]
    )
    if (!rows[0]) return
    await publishBuild(deps.relay, p.expeditionId, {
      jobId: p.jobId,
      kind: p.kind,
      status: "failed",
      step: "Failed",
      progress: rows[0].progress,
      reason: "The job stopped unexpectedly",
      at: new Date().toISOString(),
    })
  }

  return {
    async start() {
      const queue = {
        // Heartbeats find dead instances; the expiry only bounds a hung attempt.
        heartbeatSeconds: opts.heartbeatSeconds,
        expireInSeconds: 24 * 60 * 60,
        retryLimit: RESTARTS,
        retryDelay: 1,
        retryBackoff: true,
        retryDelayMax: 60,
      }
      if (await boss.getQueue(JOB_QUEUE))
        await boss.updateQueue(JOB_QUEUE, queue)
      else await boss.createQueue(JOB_QUEUE, queue)
      await boss.work<JobPayload>(
        JOB_QUEUE,
        {
          localConcurrency: opts.concurrency,
          batchSize: 1,
          pollingIntervalSeconds: opts.pollingSeconds ?? 1,
        },
        async ([job]) => {
          if (job) await run(job)
        }
      )
    },
    async stop() {
      await boss.offWork(JOB_QUEUE).catch(() => {})
    },
    halt() {
      generation++
    },
    async launch(payload) {
      await boss.send(JOB_QUEUE, payload, {
        id: bossJobId(instanceId(payload)),
      })
    },
    async terminate(id) {
      // The row's `cancelled` (the runner sets it) stops a running attempt at
      // its next step; a queued one never starts.
      await boss.cancel(JOB_QUEUE, bossJobId(id)).catch(() => {})
    },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** How often a running step checks whether its attempt was cancelled. */
const CANCEL_POLL_MS = 1000

/** `p`, unless `stopped()` turns true first: then it throws `Halted`. */
function untilCancelled<T>(
  p: Promise<T>,
  stopped: () => Promise<boolean>
): Promise<T> {
  let timer: NodeJS.Timeout
  let done = false
  const watch = new Promise<never>((_, reject) => {
    const tick = async () => {
      if (done) return
      if (await stopped().catch(() => false)) return reject(new Halted())
      timer = setTimeout(tick, CANCEL_POLL_MS)
    }
    timer = setTimeout(tick, CANCEL_POLL_MS)
  })
  // The step may go on after a cancel; its outcome is ignored.
  p.catch(() => {})
  return Promise.race([p, watch]).finally(() => {
    done = true
    clearTimeout(timer)
  })
}

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `step "${name}" timed out after ${Math.round(ms / 1000)} s`
            )
          ),
        ms
      )
    }),
  ]).finally(() => clearTimeout(timer))
}
