// The Expedition room's wire protocol (spec §2.4): JSON messages `{ t, … }`
// sent by the server to everyone connected to one Expedition. Shared by the
// server (which sends them) and @seply/sync (which reads them), plus the two
// messages a client sends: its `presence` and `leave`.
//
// Server → client: `hello`, `ops` (or `poke` for large batches and gaps),
// `build`, `presence`, `leave` and `kick`. Client → server: `presence`
// (throttled to about `PRESENCE_HZ`) and `leave`. Who may send presence, and
// who hears it, is the room's business (apps/worker); the shapes are here.
import { z } from "zod"
import { ViewStatus } from "./common.ts"
import type { LoggedOp } from "./history.ts"

/**
 * A job's lifecycle (spec §2.5). Terminal: complete, failed, cancelled.
 * `paused`: the attempt stopped at the spending cap; Continue starts the next
 * attempt with a raised cap, Stop cancels it.
 */
export const JobStatus = z.enum([
  "queued",
  "running",
  "paused",
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

/** How often a client sends its presence, at most (spec: ~10–20 Hz). */
export const PRESENCE_HZ = 15

/** A batch of logged ops larger than this (JSON bytes) goes out as a `poke`. */
export const OPS_INLINE_BYTES = 64_000

const Id = z.string().min(1).max(128)
/** 0 to 1 across the canvas pane, or across the Concept under the pointer. */
const Fraction = z.number().min(-1).max(2)

/**
 * Where a pointer is on the canvas: `x`, `y` as fractions of the canvas pane,
 * and, when it is over a Concept, `on` that Concept with fractions of its box
 * (so another reader's cursor lands on the same Concept whatever their
 * window, zoom or pan).
 */
export const RoomCursor = z.object({
  x: Fraction,
  y: Fraction,
  on: z.object({ id: Id, x: Fraction, y: Fraction }).optional(),
})
export type RoomCursor = z.infer<typeof RoomCursor>

/** What one participant is doing: their View, cursor, selection and edit. */
export const PresenceState = z.object({
  /** The View they have open, or null (none yet). */
  view: Id.nullable(),
  cursor: RoomCursor.nullable(),
  /** Selected Concept ids. */
  selection: z.array(Id).max(50),
  /** What they are editing, e.g. a Concept id, when they are. */
  editing: Id.optional(),
})
export type PresenceState = z.infer<typeof PresenceState>

export const IDLE_PRESENCE: PresenceState = {
  view: null,
  cursor: null,
  selection: [],
}

/**
 * Someone in the room: one connection (a tab), or an agent via MCP. A reader
 * with two tabs open is two participants with one `userId`.
 */
export const Participant = PresenceState.extend({
  /** The connection's id (an agent's is `agent:<userId>`). */
  id: Id,
  userId: Id,
  name: z.string().max(200),
  /** An agent via MCP, shown until its TTL runs out. */
  agent: z.boolean().optional(),
})
export type Participant = z.infer<typeof Participant>

export const RoomHello = z.object({
  t: z.literal("hello"),
  headSeq: z.number().int().min(0),
  /**
   * Everyone else here. Only collaborators hear presence; other readers get
   * an empty list.
   */
  presence: z.array(Participant),
  /** The latest event of each running job and of each View it is building. */
  builds: z.array(BuildEvent),
  /** This connection's own participant id, when it may send presence. */
  you: Id.optional(),
})

export const RoomBuild = BuildEvent.extend({ t: z.literal("build") })

/**
 * New ops were logged: pull after your `headSeq`. Also sent at the current
 * head when the Expedition's Proposals change (WP-4.3), so open Suggestions
 * tabs fetch them again.
 */
export const RoomPoke = z.object({
  t: z.literal("poke"),
  headSeq: z.number().int().min(0),
})

/** A logged op as the room relays it; the server validated it on push. */
const RelayedOp = z.custom<LoggedOp>(
  (v) =>
    !!v &&
    typeof v === "object" &&
    typeof (v as LoggedOp).opId === "string" &&
    Number.isInteger((v as LoggedOp).serverSeq)
)

/**
 * Newly logged ops, `from` (exclusive: the head they follow) `to` (the last
 * one's seq). A client whose head is `from` (or later) applies them; one
 * further behind pulls.
 */
export const RoomOps = z.object({
  t: z.literal("ops"),
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  ops: z.array(RelayedOp).min(1),
})

/** A participant joined or moved (server → client). */
export const RoomPresence = Participant.extend({ t: z.literal("presence") })

/** A participant left: their tab closed, or an agent's TTL ran out. */
export const RoomLeave = z.object({ t: z.literal("leave"), id: Id })

/**
 * The room closes this connection (access removed, Visibility changed). The
 * client stops reconnecting; reopening checks access again.
 */
export const RoomKick = z.object({
  t: z.literal("kick"),
  reason: z.string().max(200),
})

export const RoomMessage = z.discriminatedUnion("t", [
  RoomHello,
  RoomBuild,
  RoomPoke,
  RoomOps,
  RoomPresence,
  RoomLeave,
  RoomKick,
])
export type RoomMessage = z.infer<typeof RoomMessage>
export type RoomHello = z.infer<typeof RoomHello>
export type RoomBuild = z.infer<typeof RoomBuild>
export type RoomPoke = z.infer<typeof RoomPoke>
export type RoomOps = z.infer<typeof RoomOps>
export type RoomPresence = z.infer<typeof RoomPresence>
export type RoomLeave = z.infer<typeof RoomLeave>
export type RoomKick = z.infer<typeof RoomKick>

/** What a client sends: its presence, or that it is leaving. */
export const ClientMessage = z.discriminatedUnion("t", [
  PresenceState.extend({ t: z.literal("presence") }),
  z.object({ t: z.literal("leave") }),
])
export type ClientMessage = z.infer<typeof ClientMessage>

function parseWith<T>(schema: z.ZodType<T>, data: string): T | null {
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const r = schema.safeParse(json)
  return r.success ? r.data : null
}

/** Parses one incoming room frame; null when it isn't one we know. */
export function parseRoomMessage(data: string): RoomMessage | null {
  return parseWith(RoomMessage, data)
}

/** Parses one frame a client sent; null when it isn't valid. */
export function parseClientMessage(data: string): ClientMessage | null {
  return parseWith(ClientMessage, data)
}

/**
 * The room message for a newly logged batch: `ops` when it is small enough,
 * else a `poke` (clients pull). `batch` is in `serverSeq` order.
 */
export function opsMessage(
  batch: readonly LoggedOp[],
  maxBytes = OPS_INLINE_BYTES
): RoomOps | RoomPoke | null {
  const first = batch[0]
  const last = batch.at(-1)
  if (!first || !last) return null
  const msg: RoomOps = {
    t: "ops",
    from: first.serverSeq - 1,
    to: last.serverSeq,
    ops: [...batch],
  }
  // Contiguous, or a client can't tell what it is missing.
  const contiguous = batch.every(
    (op, i) => op.serverSeq === first.serverSeq + i
  )
  if (!contiguous || JSON.stringify(msg).length > maxBytes)
    return { t: "poke", headSeq: last.serverSeq }
  return msg
}

/** The key a room keeps a job's latest event under (one per View, one for the job). */
export function buildKey(evt: Pick<BuildEvent, "jobId" | "viewId">): string {
  return evt.viewId ? `${evt.jobId}/${evt.viewId}` : evt.jobId
}
