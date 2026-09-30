// Jobs on Cloudflare (spec §2.5): one Workflow class runs every job kind, one
// instance per attempt (`<jobId>-<attempt>`). Each `ctx.step` is a Workflow
// step: persisted and retried, so a restart replays `run` and skips the steps
// that already returned. Progress goes to the Expedition's room.
import {
  connectPg,
  createJobRunner,
  instanceId,
  JOB_KINDS,
  notifyUser,
  readVapid,
  runJob,
  type JobDeps,
  type JobEngine,
  type JobPayload,
  type JobRunner,
  type Relay,
  type Steps,
} from "@seply/server"
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import type { Bindings } from "./bindings.ts"
import { roomRelay } from "./relay.ts"

/** Our `Steps` over a Workflow's `step.do`. */
export function workflowSteps(step: WorkflowStep): Steps {
  return {
    do(name, o, fn) {
      return step.do(
        name,
        {
          retries: {
            limit: o.retries,
            delay: o.retryDelayMs,
            backoff: "exponential",
          },
          timeout: o.timeoutMs,
        },
        // Step results are JSON, which is serializable.
        (ctx) => fn({ attempt: ctx.attempt }) as Promise<never>
      )
    },
  }
}

/** What a running job needs from this Worker's bindings. */
export function jobDeps(env: Bindings): JobDeps {
  const hyperdrive = env.HYPERDRIVE
  const vapid = readVapid(env)
  return {
    connect: () => {
      if (!hyperdrive) throw new Error("no database configured")
      return connectPg(hyperdrive.connectionString)
    },
    relay: roomRelay(env.EXPEDITION_ROOM),
    notify: (db, userId, note) =>
      notifyUser(db, userId, note, { vapid }).then(() => {}),
  }
}

export class JobWorkflow extends WorkflowEntrypoint<Bindings, JobPayload> {
  async run(event: Readonly<WorkflowEvent<JobPayload>>, step: WorkflowStep) {
    await runJob(
      event.payload,
      workflowSteps(step),
      jobDeps(this.env),
      JOB_KINDS
    )
  }
}

/** Workflow statuses from which an instance may still run. */
const OPEN = new Set([
  "queued",
  "running",
  "paused",
  "waiting",
  "waitingForPause",
])

export function workflowsEngine(wf: Workflow<JobPayload>): JobEngine {
  return {
    async launch(payload) {
      await wf.create({ id: instanceId(payload), params: payload })
    },
    async terminate(id) {
      const inst = await wf.get(id)
      if (OPEN.has((await inst.status()).status)) await inst.terminate()
    },
    // `wrangler dev` leaves running instances stranded after a restart (they
    // report "running" and never move); pausing and resuming one replays it
    // from its last recorded step. Production resumes on its own.
    async wake(id) {
      const inst = await wf.get(id)
      if ((await inst.status()).status !== "running") return
      await inst.pause()
      await inst.resume()
    },
  }
}

/** The runner the API uses, over this Worker's Workflow and room. */
export function workerJobRunner(env: Bindings, relay: Relay): JobRunner {
  return createJobRunner({
    engine: workflowsEngine(env.JOBS),
    registry: JOB_KINDS,
    relay,
  })
}
