// Asks (spec §3.8, §5.5; WP-4.4): Grow asks and "Write the article", the jobs
// whose writes become one Proposal each (its id is the job's). Owners and
// editors only (`reviewProposals`: 403 for a viewer, 404 when the caller
// can't view the Expedition).
//
//   GET /expeditions/:id/asks
//     → 200 { asks: AskView[] }   Activity: the newest 50 asks, who asked and
//                                 what came of them. The chat isn't kept.
//   GET /expeditions/:id/asks/:jobId/stream
//     → 200 text/event-stream     the ask as an AI SDK UI message stream:
//                                 `data-proposal` parts (id: the Proposal's,
//                                 data: its ProposalView; a later part
//                                 replaces an earlier one) as its items
//                                 arrive, and `data-ask` parts (id: the job's,
//                                 data: { status, step, error }); it ends
//                                 when the ask ends or pauses at its cap.
//
// Starting, stopping (cancel) and Continue are the job routes.
import {
  can,
  schema,
  TERMINAL_JOB_STATUSES,
  type JobStatus,
  type ProposalView,
} from "@seply/domain"
import { GROW_ACTION_LABELS, type GrowAction } from "@seply/ai"
import { and, desc, eq, inArray } from "drizzle-orm"
import { Hono, type Context } from "hono"
import { streamSSE } from "hono/streaming"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { roleOf } from "./oplog.ts"
import { readProposal } from "./proposals.ts"
import { getJob } from "./jobs/store.ts"
import type { Job } from "./jobs/types.ts"

const { expeditions, jobs, proposals, proposalItems, users } = schema

/** Job kinds that are asks: what they write is one Proposal. */
export const ASK_KINDS = ["grow", "article"] as const

/** One ask, as Activity lists it. */
export type AskView = {
  jobId: string
  kind: (typeof ASK_KINDS)[number]
  /** The ask in words (the Proposal's rationale). */
  rationale: string
  author: { id: string; name: string; image: string | null }
  status: JobStatus
  step: string | null
  /** Why it failed, or how far it got at the spending cap. */
  error: string | null
  createdAt: string
  updatedAt: string
  /** Its Proposal's items, by review status. */
  items: { pending: number; accepted: number; dismissed: number }
}

/** The newest asks first. */
export async function listAsks(db: Db, expeditionId: string, limit = 50): Promise<AskView[]> {
  const rows = await db
    .select({
      job: jobs,
      name: users.name,
      image: users.image,
      rationale: proposals.rationale,
    })
    .from(jobs)
    .leftJoin(users, eq(users.id, jobs.startedBy))
    .leftJoin(
      proposals,
      and(eq(proposals.expeditionId, jobs.expeditionId), eq(proposals.id, jobs.id))
    )
    .where(and(eq(jobs.expeditionId, expeditionId), inArray(jobs.kind, [...ASK_KINDS])))
    .orderBy(desc(jobs.id))
    .limit(limit)
  const ids = rows.map((r) => r.job.id)
  const items = ids.length
    ? await db
        .select({ proposalId: proposalItems.proposalId, status: proposalItems.status })
        .from(proposalItems)
        .where(
          and(eq(proposalItems.expeditionId, expeditionId), inArray(proposalItems.proposalId, ids))
        )
    : []
  return rows.map(({ job, name, image, rationale }) => {
    const mine = items.filter((i) => i.proposalId === job.id)
    const n = (s: string) => mine.filter((i) => i.status === s).length
    return {
      jobId: job.id,
      kind: job.kind as AskView["kind"],
      rationale: rationale ?? fallbackRationale(job.kind, job.input),
      author: { id: job.startedBy, name: name ?? "Someone", image: image ?? null },
      status: job.status,
      step: job.step,
      error: job.error,
      createdAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
      items: { pending: n("pending") + n("stale"), accepted: n("accepted"), dismissed: n("dismissed") },
    }
  })
}

/** Before its Proposal exists (or when it never did): the ask from its input. */
function fallbackRationale(kind: string, input: unknown): string {
  const i = (input ?? {}) as { ask?: string; action?: GrowAction }
  if (kind === "article") return "Write the article"
  return i.ask ?? (i.action ? GROW_ACTION_LABELS[i.action] : "An ask")
}

/** How often a stream looks for new items. */
export const STREAM_POLL_MS = 700
/** A stream ends after this long whatever happens (the client reopens it). */
const STREAM_MAX_MS = 30 * 60_000

/** The parts of an ask's stream (AI SDK UI message stream chunks). */
export type AskStreamPart =
  | { type: "start"; messageId: string }
  | { type: "data-proposal"; id: string; data: ProposalView }
  | {
      type: "data-ask"
      id: string
      data: Pick<Job, "status" | "step" | "error">
    }
  | { type: "finish" }

/** The stream ends at these: the ask is over, or waits at its cap. */
const ENDED: readonly JobStatus[] = [...TERMINAL_JOB_STATUSES, "paused"]

export function askRoutes() {
  const r = new Hono<AppEnv>()

  /** The caller may review this Expedition's Proposals: null, or the refusal. */
  const refused = async (c: Context<AppEnv>, db: Db, expeditionId: string) => {
    const [exp] = await db
      .select({ visibility: expeditions.visibility, deletedAt: expeditions.deletedAt })
      .from(expeditions)
      .where(eq(expeditions.id, expeditionId))
    if (!exp || exp.deletedAt) return c.json({ error: "Expedition not found" }, 404)
    const actor = { role: await roleOf(db, expeditionId, c.var.user.id), signedIn: true }
    if (!can(actor, "read", exp.visibility)) return c.json({ error: "Expedition not found" }, 404)
    if (!can(actor, "reviewProposals", exp.visibility))
      return c.json({ error: "only owners and editors see asks" }, 403)
    return null
  }

  r.get("/:id/asks", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const no = await refused(c, db, expeditionId)
    if (no) return no
    return c.json({ asks: await listAsks(db, expeditionId) })
  })

  r.get("/:id/asks/:jobId/stream", async (c) => {
    const db = await c.var.db()
    const expeditionId = c.req.param("id")
    const jobId = c.req.param("jobId")
    const no = await refused(c, db, expeditionId)
    if (no) return no
    const job = await getJob(db, jobId)
    if (!job || job.expeditionId !== expeditionId || !(ASK_KINDS as readonly string[]).includes(job.kind))
      return c.json({ error: "ask not found" }, 404)

    let done!: () => void
    c.var.hold(new Promise<void>((r) => (done = r)))
    c.header("x-vercel-ai-ui-message-stream", "v1")
    return streamSSE(
      c,
      async (s) => {
        let closed = false
        s.onAbort(() => {
          closed = true
        })
        const send = (part: AskStreamPart | "[DONE]") =>
          s.writeSSE({ data: typeof part === "string" ? part : JSON.stringify(part) })
        try {
          await send({ type: "start", messageId: jobId })
          let lastProposal = ""
          let lastAsk = ""
          const until = Date.now() + STREAM_MAX_MS
          while (!closed) {
            const now = await getJob(db, jobId)
            if (!now) break
            const proposal = await readProposal(db, expeditionId, jobId)
            const sig = proposal
              ? proposal.items.map((i) => `${i.id}:${i.status}`).join(",")
              : ""
            if (proposal && sig !== lastProposal) {
              lastProposal = sig
              await send({ type: "data-proposal", id: proposal.id, data: proposal })
            }
            const ask = { status: now.status, step: now.step, error: now.error }
            if (JSON.stringify(ask) !== lastAsk) {
              lastAsk = JSON.stringify(ask)
              await send({ type: "data-ask", id: jobId, data: ask })
            }
            if (ENDED.includes(now.status) || Date.now() > until) break
            await s.sleep(STREAM_POLL_MS)
          }
          if (!closed) {
            await send({ type: "finish" })
            await send("[DONE]")
          }
        } finally {
          done()
        }
      },
      async (err) => {
        console.error("asks: stream failed", err)
        done()
      }
    )
  })

  return r
}
