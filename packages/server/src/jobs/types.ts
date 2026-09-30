// Jobs (spec §2.5): builds and other long AI work, behind one interface.
//
// - A **JobDefinition** is the work, written once against `JobContext`: named,
//   durable steps, progress events and commits. Definitions live in this
//   package; the step functions they call (curator, skim, writers) live in
//   @seply/ai.
// - A **JobEngine** is the runtime's durable executor: Cloudflare Workflows
//   in apps/worker, pg-boss on Node later, and `createInlineEngine` (in
//   process) for tests.
// - A **JobRunner** is what the API calls: start, cancel, retry, wake.
//   `createJobRunner` builds one from an engine; it keeps the `jobs` rows.
import type { BuildEvent, JobStatus, OpBody } from "@seply/domain"
import type { z } from "zod"
import type { LanguageModelV4, Stage, ViewReader } from "@seply/ai"
import type { BlobStore } from "../blobs.ts"
import type { ServerEnv } from "../config.ts"
import type { Db, DbConnection } from "../db.ts"
import type { Relay } from "../relay.ts"

/** A `jobs` row, as the API returns it. */
export type Job = {
  id: string
  expeditionId: string
  kind: string
  input: unknown
  startedBy: string
  status: JobStatus
  step: string | null
  progress: number
  error: string | null
  attempt: number
  createdAt: string
  updatedAt: string
}

/** What an engine is handed to run one attempt of a job. JSON only. */
export type JobPayload = {
  jobId: string
  expeditionId: string
  kind: string
  input: unknown
  startedBy: string
  attempt: number
}

/** The engine's id for one attempt of a job (a Workflow instance id). */
export const instanceId = (p: { jobId: string; attempt: number }) =>
  `${p.jobId}-${p.attempt}`

export type StepOptions = {
  /** Retries after the first attempt (default 3). */
  retries?: number
  /** Delay before the first retry, doubled each time (default 2 s). */
  retryDelayMs?: number
  /** Per attempt (default 15 minutes). */
  timeoutMs?: number
}

export const STEP_DEFAULTS: Required<StepOptions> = {
  retries: 3,
  retryDelayMs: 2_000,
  timeoutMs: 15 * 60_000,
}

/** JSON a step may return (its checkpoint). */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json | undefined }

/**
 * The runtime's durable step: runs `fn`, retrying it on a throw, and records
 * its result. Once a step has returned, the same attempt never runs it again,
 * even after a restart: it returns the recorded result instead. Step names
 * must be unique within an attempt and deterministic.
 */
export interface Steps {
  do<T extends Json>(
    name: string,
    options: Required<StepOptions>,
    fn: (info: { attempt: number }) => Promise<T>
  ): Promise<T>
}

/** The runtime pieces a running job uses. */
export type JobDeps = {
  /** One database connection; the job closes it after each use. */
  connect: () => Promise<DbConnection>
  relay: Relay
  /** Delivers a notification to one user's browsers (web push). Optional. */
  notify?: (db: Db, userId: string, n: JobNotification) => Promise<void>
  now?: () => number
  /** What AI jobs (the build) read from the runtime. */
  services?: JobServices
}

/**
 * What AI jobs need from the app that runs them (spec §2.1: the composing app
 * fills the ports). The build reads the AI setup from `env` (instance keys) and
 * the database (BYOK), Source segments from `blobs`, and renders Views for
 * `view.inspect` with `views` (@seply/views/inspect's `readView`, which this
 * package may not import).
 */
export type JobServices = {
  env?: ServerEnv
  blobs?: BlobStore
  views?: ViewReader
  /** Tests only: the model a stage uses instead of the resolved one. */
  model?: (stage: Stage) => LanguageModelV4
  /** Tests only: how much Source the curator reads at once (see @seply/ai's planSources). */
  curator?: { wholeSourceMaxTokens?: number; chunkTokens?: number }
}

export type JobNotification = {
  title: string
  body: string
  /** Where a click opens, same origin (e.g. `/e/<id>`). */
  url: string
  /** Notifications with one tag replace each other. */
  tag: string
}

/** A progress event as a job sends it; the context adds the job's id, kind and time. */
export type Progress = Omit<BuildEvent, "jobId" | "kind" | "at">

export interface JobContext<Input> {
  job: Omit<JobPayload, "input">
  input: Input
  /**
   * A durable, retried step (see `Steps`). Its result must be JSON. Throw to
   * fail this try; after its retries, the job fails with that error.
   */
  step<T extends Json>(
    name: string,
    fn: (info: { attempt: number }) => Promise<T>,
    options?: StepOptions
  ): Promise<T>
  /**
   * A checkpoint that commits: `produce` returns op bodies and a Change label
   * (a step, so the minted op ids are recorded), then they are appended as one
   * Change with origin `build`, authored by whoever started the job (another
   * step). Retries and restarts never log them twice. Returns the head seq,
   * or null when `produce` returned no ops.
   */
  commit(
    name: string,
    produce: () => Promise<{ ops: OpBody[]; label: string }>,
    options?: StepOptions
  ): Promise<number | null>
  /**
   * Sends a progress event to the Expedition's room. Best effort: never
   * throws. Job-level events (no `viewId`) also update the job's step and
   * progress. Code outside steps runs again on a restart, so an event may be
   * sent twice; only the latest matters.
   */
  progress(evt: Progress): Promise<void>
  /** Runs `fn` over one database connection, closed afterwards. Use inside steps. */
  withDb<T>(fn: (db: Db) => Promise<T>): Promise<T>
  /** The runtime's services (AI setup, blobs, the ViewReader); empty when it has none. */
  services: JobServices
}

export type JobDefinition<Input = unknown> = {
  kind: string
  /** Validates `input` when the job is started through the API. */
  input: z.ZodType<Input>
  /** Only startable where test credentials are on (a localhost Worker). */
  testOnly?: boolean
  /** The web push sent to whoever started it when it ends; null for none. */
  notification?(
    job: Omit<JobPayload, "input">,
    outcome: "complete" | "failed"
  ): Omit<JobNotification, "url" | "tag"> | null
  run(ctx: JobContext<Input>): Promise<void>
}

export type JobRegistry = ReadonlyMap<string, JobDefinition<unknown>>

export function jobRegistry(
  // Each definition has its own input type; the registry erases it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...defs: JobDefinition<any>[]
): JobRegistry {
  return new Map(
    defs.map((d) => [d.kind, d as unknown as JobDefinition<unknown>])
  )
}

/** The runtime's durable executor. */
export interface JobEngine {
  /** Starts one attempt; the engine then calls `runJob` with its own `Steps`. */
  launch(payload: JobPayload): Promise<void>
  /** Stops an attempt for good (cancel). Resolves if it has already ended. */
  terminate(id: string): Promise<void>
  /**
   * Nudges an attempt the runtime has lost track of. On Cloudflare only
   * `wrangler dev` needs it: it does not resume running Workflows after a
   * restart, while production does.
   */
  wake?(id: string): Promise<void>
}

/** What the API calls (spec §2.5: start, retry, cancel; progress goes to the Relay). */
export interface JobRunner {
  readonly registry: JobRegistry
  start(
    db: Db,
    req: {
      expeditionId: string
      kind: string
      input: unknown
      startedBy: string
    }
  ): Promise<Job>
  /** Stops a queued or running job; it ends `cancelled`. */
  cancel(db: Db, jobId: string): Promise<Job>
  /** Starts a failed or cancelled job again, as its next attempt, from its first step. */
  retry(db: Db, jobId: string): Promise<Job>
  /** Wakes every running job (see `JobEngine.wake`). Returns how many. */
  wake(db: Db): Promise<number>
}
