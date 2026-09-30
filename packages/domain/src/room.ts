// The Expedition room's wire protocol (spec §2.4): JSON messages `{ t, … }`
// sent by the server to everyone connected to one Expedition. Shared by the
// server (which sends them) and @seply/sync (which reads them). WP-3.2 has
// the minimal set: `hello`, `build` and `poke`; `ops`, presence, `leave` and
// `kick` come with the full relay (WP-4.1).
import { z } from "zod"
import { ViewStatus } from "./common.ts"

/** A job's lifecycle (spec §2.5). Terminal: complete, failed, cancelled. */
export const JobStatus = z.enum([
  "queued",
  "running",
  "complete",
  "failed",
  "cancelled",
])
export type JobStatus = z.infer<typeof JobStatus>

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "complete",
  "failed",
  "cancelled",
]

/** A Concept streamed into a View while it builds, before it is committed. */
export const PreviewNode = z.looseObject({
  id: z.string(),
  title: z.string(),
  kind: z.string().optional(),
})
export type PreviewNode = z.infer<typeof PreviewNode>

/**
 * One progress event of a job. With `viewId` it is about that View (its
 * status is the View's: queued, building, ready, failed); without, it is about
 * the whole job (its status is the job's). Not persisted: the View's status
 * and failure reason are logged fields, and the job's are in `jobs`.
 */
export const BuildEvent = z.object({
  jobId: z.string(),
  /** The job kind, e.g. "build" or "fake". */
  kind: z.string(),
  viewId: z.string().optional(),
  status: z.union([JobStatus, ViewStatus]),
  /** What it is doing now, in plain words ("Building the Timeline"). */
  step: z.string(),
  /** 0 to 1, for the whole job (or the View, with `viewId`). */
  progress: z.number().min(0).max(1),
  previewNodes: z.array(PreviewNode).optional(),
  /** A plain failure reason, on `failed`. */
  reason: z.string().optional(),
  /** ISO 8601, when the event was sent. */
  at: z.string(),
})
export type BuildEvent = z.infer<typeof BuildEvent>

export const RoomHello = z.object({
  t: z.literal("hello"),
  headSeq: z.number().int().min(0),
  /** Presence arrives with WP-4.1; always empty for now. */
  presence: z.array(z.unknown()),
  /** The latest event of each running job and of each View it is building. */
  builds: z.array(BuildEvent),
})

export const RoomBuild = BuildEvent.extend({ t: z.literal("build") })

/** New ops were logged: pull after your `headSeq`. */
export const RoomPoke = z.object({
  t: z.literal("poke"),
  headSeq: z.number().int().min(0),
})

export const RoomMessage = z.discriminatedUnion("t", [
  RoomHello,
  RoomBuild,
  RoomPoke,
])
export type RoomMessage = z.infer<typeof RoomMessage>
export type RoomHello = z.infer<typeof RoomHello>
export type RoomBuild = z.infer<typeof RoomBuild>
export type RoomPoke = z.infer<typeof RoomPoke>

/** Parses one incoming room frame; null when it isn't one we know. */
export function parseRoomMessage(data: string): RoomMessage | null {
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const r = RoomMessage.safeParse(json)
  return r.success ? r.data : null
}

/** The key a room keeps a job's latest event under (one per View, one for the job). */
export function buildKey(evt: Pick<BuildEvent, "jobId" | "viewId">): string {
  return evt.viewId ? `${evt.jobId}/${evt.viewId}` : evt.jobId
}
