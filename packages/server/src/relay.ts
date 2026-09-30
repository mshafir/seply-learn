// The live relay (spec §2.4): one room per Expedition. /push calls
// `published` after its transaction commits; jobs call `build` with their
// progress; `GET /api/expeditions/:id/live` hands the WebSocket upgrade to
// `handleUpgrade`. On Cloudflare the room is a Durable Object (apps/worker,
// WP-3.2: `hello`, `build`, `poke`); the full protocol (ops, presence, kick,
// agent presence) and the Node rooms come with WP-4.1. Without a live relay
// the app uses `noopRelay`.
import type { BuildEvent, LoggedOp, ReaderBatch } from "@seply/domain"

/** Who is joining a room; the app has checked they may view the Expedition. */
export type RoomJoin = {
  expeditionId: string
  userId: string
  /** The Expedition's head seq when they joined (the room never reads Postgres). */
  headSeq: number
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
   * Accepts a WebSocket upgrade into the Expedition's room. Optional: without
   * it the live route answers 501.
   */
  handleUpgrade?(req: Request, join: RoomJoin): Promise<Response> | Response
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
