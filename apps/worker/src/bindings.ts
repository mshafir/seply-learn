import type { JobPayload, ServerEnv } from "@seply/server"
import type { ExpeditionRoom } from "./room.ts"

/** This Worker's env: the server's vars and secrets, plus its bindings. */
export type Bindings = ServerEnv & {
  HYPERDRIVE?: Hyperdrive
  /** Source files and segments. */
  SOURCES?: R2Bucket
  EXPEDITION_ROOM: DurableObjectNamespace<ExpeditionRoom>
  JOBS: Workflow<JobPayload>
  /**
   * "1": on an instance's first request, wake the jobs the runtime lost.
   * Only `wrangler dev` needs it (it doesn't resume Workflows after a restart).
   */
  JOBS_WAKE_ON_START?: string
}
