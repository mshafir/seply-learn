// The live relay (spec §2.4): one room per Expedition. /push calls
// `published` after its transaction commits; jobs call `build` with their
// progress; `GET /api/expeditions/:id/live` hands the WebSocket upgrade to
// `handleUpgrade`; sharing calls `kick` when someone loses access, and the
// MCP handler calls `agentPresence` on each tool call. On Cloudflare the room
// is a hibernating Durable Object (apps/worker); on Node, in-process rooms
// with LISTEN/NOTIFY between instances (apps/server-node). Both run room.ts's
// `Room`. The wire protocol is @seply/domain's room.ts. Without a live relay
// the app uses `noopRelay`.
import type { BuildEvent, LoggedOp, ReaderBatch, Role } from "@seply/domain"

/**
 * How someone joins (spec §2.4):
 * - `collaborator`: the owner or an invited editor or viewer. Sends presence
 *   and hears everyone else's.
 * - `reader`: signed in, not a collaborator, reading a public or unlisted
 *   link. Read-only: hears `ops`, `poke` and `build`, sends no presence and
 *   hears none.
 * - `anonymous`: signed out, reading a public or unlisted link. Hears `ops`
 *   and `poke` only.
 */
export type RoomAccess = "collaborator" | "reader" | "anonymous"

/** Who is joining a room; the app has checked they may view the Expedition. */
export type RoomJoin = {
  expeditionId: string
  /** Null for an anonymous reader. */
  userId: string | null
  /** Their display name (empty when anonymous). */
  name: string
  access: RoomAccess
  /**
   * Their Collaborator role (null for readers of a link). The room never
   * takes ops from anyone (they arrive through /push, which checks the role
   * on every op); a viewer's presence carries no `editing`. A role change
   * kicks the user's connections, so a reconnect picks up the new role.
   */
  role: Role | null
  /** The Expedition's head seq when they joined (the room never reads Postgres). */
  headSeq: number
}

/** An agent via MCP, shown as a participant until `ttlMs` passes without a call. */
export type AgentPresence = {
  /** The user the agent acts for. */
  userId: string
  /** What to show, e.g. "Claude (via MCP)". */
  label: string
  ttlMs: number
}

export interface Relay {
  /** Newly logged ops of one Expedition, in `serverSeq` order. Never a retry's. */
  published(
    expeditionId: string,
    batch: readonly LoggedOp[]
  ): Promise<void> | void
  /**
   * The reader channel: one reader's own marks (Reading status, personal
   * View settings, position), saved outside the op log, for that reader's
   * other tabs and devices only. Never sent to anyone else. Optional: until
   * the live relay (M4), other devices catch up when they next fetch their
   * state, and other tabs of one browser hear it on a BroadcastChannel.
   */
  reader?(userId: string, marks: ReaderBatch): Promise<void> | void
  /** A job's progress, for everyone in the Expedition's room. Optional. */
  build?(expeditionId: string, evt: BuildEvent): Promise<void> | void
  /**
   * A `poke` at the current head, for everyone in the room. Sent when an
   * Expedition's Proposals change (WP-4.3: written, reviewed, reopened), so
   * open Suggestions tabs fetch them again; a client at that head pulls
   * nothing. Optional.
   */
  poke?(expeditionId: string, headSeq: number): Promise<void> | void
  /**
   * Accepts a WebSocket upgrade into the Expedition's room. Optional: without
   * it the live route answers 501.
   */
  handleUpgrade?(req: Request, join: RoomJoin): Promise<Response> | Response
  /**
   * Closes a user's connections with `kick`, e.g. when they are removed or
   * Visibility changes. `userId` null kicks everyone who isn't a
   * collaborator (anonymous and signed-in readers of a link). A kicked client
   * reconnects only by opening the Expedition again, which checks access.
   */
  kick?(
    expeditionId: string,
    userId: string | null,
    reason: string
  ): Promise<void> | void
  /** An agent's presence, renewed on each call. Optional. */
  agentPresence?(
    expeditionId: string,
    agent: AgentPresence
  ): Promise<void> | void
}

export const noopRelay: Relay = {
  published() {},
}

/** Tells the relay after a commit. The ops are logged already, so a failure is
 * only logged: clients catch up on their next pull. */
export async function publishCommitted(
  relay: Relay,
  expeditionId: string,
  batch: readonly LoggedOp[]
) {
  if (!batch.length) return
  try {
    await relay.published(expeditionId, batch)
  } catch (err) {
    console.error("relay: published failed", err)
  }
}

/** Pokes the room (Proposals changed). Best effort, like `publishBuild`. */
export async function publishPoke(
  relay: Relay,
  expeditionId: string,
  headSeq: number
) {
  try {
    await relay.poke?.(expeditionId, headSeq)
  } catch (err) {
    console.error("relay: poke failed", err)
  }
}

/** Sends a build event. Best effort: progress is never worth failing a job over. */
export async function publishBuild(
  relay: Relay,
  expeditionId: string,
  evt: BuildEvent
) {
  try {
    await relay.build?.(expeditionId, evt)
  } catch (err) {
    console.error("relay: build failed", err)
  }
}
