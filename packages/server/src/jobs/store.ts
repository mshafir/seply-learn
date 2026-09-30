// The `jobs` rows. Status only moves forward within an attempt: once a job is
// complete, failed or cancelled, only a retry (the next attempt) reopens it.
import { schema, TERMINAL_JOB_STATUSES, type JobStatus } from "@seply/domain"
import { and, desc, eq, inArray, notInArray } from "drizzle-orm"
import type { Db } from "../db.ts"
import type { Job } from "./types.ts"

const { jobs } = schema
type Row = typeof jobs.$inferSelect

const toJob = (r: Row): Job => ({
  id: r.id,
  expeditionId: r.expeditionId,
  kind: r.kind,
  input: r.input,
  startedBy: r.startedBy,
  status: r.status,
  step: r.step,
  progress: r.progress,
  error: r.error,
  attempt: r.attempt,
  createdAt: new Date(r.createdAt).toISOString(),
  updatedAt: new Date(r.updatedAt).toISOString(),
})

export async function insertJob(
  db: Db,
  row: Pick<Row, "id" | "expeditionId" | "kind" | "input" | "startedBy">
): Promise<Job> {
  const [r] = await db.insert(jobs).values(row).returning()
  return toJob(r!)
}

export async function getJob(db: Db, id: string): Promise<Job | null> {
  const [r] = await db.select().from(jobs).where(eq(jobs.id, id))
  return r ? toJob(r) : null
}

/** An Expedition's most recent jobs, newest first. */
export async function listJobs(
  db: Db,
  expeditionId: string,
  limit = 20
): Promise<Job[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.expeditionId, expeditionId))
    .orderBy(desc(jobs.id))
    .limit(limit)
  return rows.map(toJob)
}

export async function runningJobs(db: Db): Promise<Job[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running"]))
  return rows.map(toJob)
}

/**
 * Updates an open job of this attempt; a job that has ended, or moved on to
 * another attempt, is left alone. Returns the row if it changed.
 */
export async function updateOpenJob(
  db: Db,
  id: string,
  attempt: number,
  set: Partial<Pick<Row, "status" | "step" | "progress" | "error">>
): Promise<Job | null> {
  const [r] = await db
    .update(jobs)
    .set({ ...set, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.attempt, attempt),
        notInArray(jobs.status, [...TERMINAL_JOB_STATUSES])
      )
    )
    .returning()
  return r ? toJob(r) : null
}

/** Reopens an ended job as its next attempt. Null if it is still open. */
export async function reopenJob(db: Db, id: string): Promise<Job | null> {
  const current = await getJob(db, id)
  if (!current || !isEnded(current.status)) return null
  const [r] = await db
    .update(jobs)
    .set({
      status: "queued",
      step: null,
      progress: 0,
      error: null,
      attempt: current.attempt + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(jobs.id, id), eq(jobs.attempt, current.attempt)))
    .returning()
  return r ? toJob(r) : null
}

export const isEnded = (s: JobStatus) => TERMINAL_JOB_STATUSES.includes(s)
