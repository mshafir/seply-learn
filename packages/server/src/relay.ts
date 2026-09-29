// The live relay (spec §2.4). /push calls `published` after its transaction
// commits. The live implementations (a Durable Object on Cloudflare,
// in-process rooms + LISTEN/NOTIFY on Node) come in M4; until then the app
// uses `noopRelay`. The rest of the interface (build, kick, agentPresence,
// handleUpgrade) is added with its first caller.
import type { LoggedOp, ReaderBatch } from "@umbel/domain"

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
