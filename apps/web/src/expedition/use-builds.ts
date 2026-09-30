// The Expedition screen's live builds: the room (@seply/sync's RoomClient,
// WP-3.2) and the jobs list, folded into a BuildLog (build-state.ts).
//
// - Every `build` event updates the log and goes to `onEvent` (the screen's
//   toasts and first-ready auto-open).
// - The jobs list is fetched on each `hello` (a (re)connect) and whenever a
//   job starts, ends or pauses.
// - A `poke` (a build committed a View) pulls at once, so the View's logged
//   status and Concepts arrive without waiting for the next poll.
//
// Off (signed out, or reading the offline copy), it is an empty log.
import * as React from "react"
import type { BuildEvent, RoomMessage } from "@seply/domain"
import { RoomClient, roomUrl, type SyncClient } from "@seply/sync"

import {
  EMPTY_LOG,
  receive,
  withJob,
  withJobs,
  type BuildLog,
} from "@/expedition/build-state.ts"
import { jobAction, listJobs, type Job } from "@/lib/api.ts"

export type JobAction = "cancel" | "retry" | "continue"

export type Builds = {
  log: BuildLog
  /** Cancel (or Stop), Retry or Continue a job; resolves with its row. */
  act: (jobId: string, action: JobAction) => Promise<Job>
  /** A job this screen started (e.g. "Write the article"), before the room reports it. */
  track: (job: Job) => void
}

/** Job-level statuses after which the list is fetched again. */
const REFETCH = new Set(["queued", "paused", "complete", "failed", "cancelled"])

export function useBuilds({
  expeditionId,
  client,
  enabled,
  onEvent,
}: {
  expeditionId: string
  client: SyncClient
  enabled: boolean
  onEvent?: (evt: BuildEvent) => void
}): Builds {
  const [log, setLog] = React.useState<BuildLog>(EMPTY_LOG)
  const onEventRef = React.useRef(onEvent)
  React.useEffect(() => {
    onEventRef.current = onEvent
  })

  React.useEffect(() => {
    if (!enabled) return
    let stopped = false
    let fetching = false
    let again = false
    const refetch = () => {
      if (fetching) {
        again = true
        return
      }
      fetching = true
      listJobs(expeditionId)
        .then(
          (jobs) => {
            if (!stopped) setLog((l) => withJobs(l, jobs))
          },
          (e) => console.error("builds: listing jobs failed", e)
        )
        .finally(() => {
          fetching = false
          if (again && !stopped) {
            again = false
            refetch()
          }
        })
    }

    const room = new RoomClient({ url: roomUrl(expeditionId) })
    const unsubscribe = room.subscribe((msg: RoomMessage) => {
      if (stopped) return
      setLog((l) => receive(l, msg))
      if (msg.t === "hello") refetch()
      else if (msg.t === "poke") client.pull().catch(() => {})
      else if (msg.t === "build") {
        if (!msg.viewId && REFETCH.has(msg.status)) refetch()
        onEventRef.current?.(msg)
      }
    })
    return () => {
      stopped = true
      unsubscribe()
      room.close()
      setLog(EMPTY_LOG)
    }
  }, [expeditionId, client, enabled])

  const act = React.useCallback(async (jobId: string, action: JobAction) => {
    const job = await jobAction(jobId, action)
    setLog((l) => withJob(l, job))
    return job
  }, [])

  const track = React.useCallback((job: Job) => {
    setLog((l) => withJob(l, job))
  }, [])

  return { log, act, track }
}
