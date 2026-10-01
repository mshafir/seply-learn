// The writers (spec §5.2 step 4, WP-3.6).
//
// - `runWriters`: the build's last stage, after every View. A summary and an
//   overview for every Concept, then an article for each core Concept, in
//   batches (planned in a step, so a replay writes the same batches). Up to
//   `WRITER_PARALLEL` batches run side by side; each is committed as its own
//   Change as soon as its wave is back, so reading can start while the rest
//   are written. A Retry plans again from the logged state: nothing written
//   is written twice.
// - `articleJob` (kind `article`): the "Write the article" Concept action.
//   Spec §5.5 makes it an ask like Grow's, so what it writes becomes one
//   Proposal (reader copy: a suggestion) for an editor to accept, never a
//   Change.
import {
  ARTICLE_LENGTH_IDS,
  ARTICLE_LENGTHS,
  combineSpend,
  planSources,
  planWriters,
  SpendMeter,
  unresolvedProv,
  writeBatch,
  writerLabel,
  type ArticleLength,
  type SpendState,
  type WriteResult,
  type WriterMode,
  type WriterPlan,
} from "@seply/ai"
import { Id, isLive, type OpBody } from "@seply/domain"
import { z } from "zod"
import { resolveAi } from "../ai.ts"
import { addProposalItems, createProposal } from "../proposals.ts"
import { isJobPaused } from "./host.ts"
import {
  AI_STEP,
  load,
  loadSources,
  metered,
  mustLoad,
  setupFor,
  type Metered,
} from "./ai-steps.ts"
import type { JobContext, JobDefinition, Json } from "./types.ts"

/** How many writer batches run at once. */
export const WRITER_PARALLEL = 3

type Batch = { n: number; mode: WriterMode; ids: string[] }
type Written = Metered<Pick<WriteResult, "bodies" | "written" | "missing" | "repairs" | "unlinked">>

/**
 * Writes what the Expedition still owes, from `meter`; returns the meter
 * after. A spending cap reached in any batch pauses the job once that wave's
 * finished batches are committed. A batch that fails for another reason is
 * skipped; the job then fails naming what is unwritten, and Retry writes it.
 */
export async function runWriters(
  ctx: JobContext<{ sources?: string[]; goals?: string[] }>,
  opts: { meter: SpendState; whole: boolean; note?: string; progress: [number, number] }
): Promise<SpendState> {
  const { expeditionId } = ctx.job
  let meter = opts.meter
  const plan = (await ctx.step(
    "write: plan",
    () =>
      ctx.withDb(async (db) => planWriters(await mustLoad(db, expeditionId), ctx.services.writers) as unknown as Json),
    { retries: 2 }
  )) as unknown as WriterPlan
  const batches: Batch[] = [
    ...plan.overviews.map((ids) => ({ mode: "overviews" as const, ids })),
    ...plan.articles.map((ids) => ({ mode: "articles" as const, ids })),
  ].map((b, i) => ({ ...b, n: i + 1 }))
  if (!batches.length) return meter

  const total = {
    overviews: plan.overviews.flat().length,
    articles: plan.articles.flat().length,
  }
  const done = { overviews: 0, articles: 0 }
  const [from, to] = opts.progress
  const report = async (mode: WriterMode) => {
    const all = total.overviews + total.articles
    await ctx.progress({
      status: "running",
      step:
        mode === "overviews"
          ? `Writing overviews · ${done.overviews} of ${total.overviews}`
          : `Writing articles · ${done.articles} of ${total.articles}`,
      progress: from + ((to - from) * (done.overviews + done.articles)) / Math.max(1, all),
    })
  }

  const failed: Batch[] = []
  let paused: unknown = null
  for (const mode of ["overviews", "articles"] as const) {
    const todo = batches.filter((b) => b.mode === mode)
    if (todo.length) await report(mode)
    for (let w = 0; w < todo.length && !paused; w += WRITER_PARALLEL) {
      const wave = todo.slice(w, w + WRITER_PARALLEL)
      const base = meter
      const settled = await Promise.allSettled(
        wave.map(
          (b) =>
            ctx.step(
              `write ${b.n}`,
              () =>
                metered(base, async (m) => {
                  const { state, sources, model } = await load(ctx, m, "writer")
                  const r = await writeBatch(b.mode, {
                    model,
                    state,
                    sources,
                    ids: b.ids,
                    whole: opts.whole,
                    ...(opts.note && { note: opts.note }),
                    ...(ctx.input.goals && { goals: ctx.input.goals }),
                  })
                  // The repair makes every ref resolve; this is the guard.
                  const bad = unresolvedProv(r.bodies, sources)
                  if (bad.length)
                    throw new Error(`Provenance that doesn't resolve: ${bad.map((x) => x.ref.segment).join(", ")}`)
                  return r
                }),
              AI_STEP
            ) as unknown as Promise<Written>
        )
      )
      meter = combineSpend(
        base,
        settled.flatMap((s) => (s.status === "fulfilled" ? [s.value.meter] : []))
      )
      for (const [i, s] of settled.entries()) {
        const b = wave[i]!
        if (s.status === "rejected") {
          if (isJobPaused(s.reason)) paused ??= s.reason
          else {
            console.error(`writers: batch ${b.n} failed`, s.reason)
            failed.push(b)
          }
          continue
        }
        const r = s.value
        if (r.bodies.length)
          await ctx.commit(`write ${b.n}: commit`, async () => {
            const state = await ctx.withDb((db) => mustLoad(db, expeditionId))
            // A Concept deleted meanwhile (an editor, or undo) is skipped.
            const ops = r.bodies.filter((op) =>
              op.kind === "section.create"
                ? isLive(state.concepts[op.value.conceptId])
                : isLive(state.concepts[op.target])
            )
            return { label: writerLabel(state, b.mode, r.written), ops }
          })
        done[b.mode] += r.written.length
        if (r.missing.length) failed.push({ ...b, ids: r.missing })
      }
      await report(mode)
    }
    if (paused) throw paused
  }

  if (failed.length) {
    const n = (mode: WriterMode) => failed.filter((b) => b.mode === mode).flatMap((b) => b.ids).length
    const parts = [
      n("overviews") && `${n("overviews")} overview${n("overviews") === 1 ? "" : "s"}`,
      n("articles") && `${n("articles")} article${n("articles") === 1 ? "" : "s"}`,
    ].filter(Boolean)
    throw new Error(`Couldn't write ${parts.join(" and ")}. Retry to write them.`)
  }
  return meter
}

// --- "Write the article" ---------------------------------------------------------

export const ArticleJobInput = z.strictObject({
  conceptId: Id,
  /** How long the reader asked for (about ARTICLE_LENGTHS words). */
  length: z.enum(ARTICLE_LENGTH_IDS as [ArticleLength, ...ArticleLength[]]).optional(),
  /** The ask's spending cap; the reader's per-ask cap by default (spec §5.5). */
  capUsd: z.number().positive().max(20).optional(),
})
export type ArticleJobInput = z.infer<typeof ArticleJobInput>

/**
 * The "Write the article" Concept action (spec §3.7, §5.5): the article
 * writer for one Concept. It never writes the Expedition: the sections go
 * into one Proposal, "Write the article for <title>", for an owner or editor
 * to accept or dismiss in Suggestions (WP-4.3).
 */
export const articleJob: JobDefinition<ArticleJobInput> = {
  kind: "article",
  input: ArticleJobInput,
  notification: () => null,

  async run(ctx) {
    const { expeditionId } = ctx.job
    const plan = (await ctx.step(
      "plan",
      () =>
        ctx.withDb(async (db) => {
          const state = await mustLoad(db, expeditionId)
          const c = state.concepts[ctx.input.conceptId]
          if (!isLive(c)) throw new Error("That Concept is gone")
          // No Sources with segments (an imported Expedition): background knowledge only.
          const sources = await loadSources(db, ctx.services, state, undefined, { allowNone: true })
          const ai = await setupFor(db, ctx.services, ctx.job.startedBy, "writer")
          let capUsd = ctx.input.capUsd
          if (capUsd === undefined && !ctx.services.model) {
            const r = await resolveAi(db, ctx.services.env!, ctx.job.startedBy)
            capUsd = r.ok ? r.askCapUsd : undefined
          }
          return {
            title: c!.title,
            // The job's id, so its Proposal is found from the job (Activity,
            // the ask's stream) and a Retry suggests nothing twice.
            proposalId: ctx.job.jobId,
            capUsd: capUsd ?? 0.5,
            whole: planSources(sources, ai.priceKey).mode === "whole",
          }
        }),
      { retries: 2 }
    )) as { title: string; proposalId: string; capUsd: number; whole: boolean }

    await ctx.progress({ status: "running", step: `Writing the article for ${plan.title}`, progress: 0.1 })
    const start = new SpendMeter({ kind: "ask", capUsd: plan.capUsd })
    for (let i = 0; i < ctx.job.capRaises; i++) start.raise()
    const r = (await ctx.step(
      "write",
      () =>
        metered(start.toJSON(), async (m) => {
          const { state, sources, model } = await load(ctx, m, "writer", { allowNoSources: true })
          const out = await writeBatch("articles", {
            model,
            state,
            sources,
            ids: [ctx.input.conceptId],
            whole: plan.whole,
            articleWords: ARTICLE_LENGTHS[ctx.input.length ?? "standard"],
          })
          const bad = unresolvedProv(out.bodies, sources)
          if (bad.length) throw new Error("The article cites segments that don't exist")
          return { bodies: out.bodies, written: out.written, repairs: out.repairs }
        }),
      AI_STEP
    )) as unknown as Metered<{ bodies: OpBody[]; written: string[] }>
    if (!r.bodies.length)
      throw new Error(`No article came back for ${plan.title}. Try again.`)

    await ctx.step(
      "propose",
      () =>
        ctx.withDb(async (db) => {
          await db.transaction(async (tx) => {
            await createProposal(tx, {
              expeditionId,
              id: plan.proposalId,
              author: ctx.job.startedBy,
              origin: "ai",
              rationale: `Write the article for ${plan.title}`,
            })
            await addProposalItems(tx, {
              expeditionId,
              proposalId: plan.proposalId,
              items: [{ id: `${plan.proposalId}-1`, ops: r.bodies }],
            })
          })
          return plan.proposalId
        }),
      { retries: 3 }
    )
    await ctx.announceProposals()
    await ctx.progress({
      status: "running",
      step: `Suggested an article for ${plan.title}`,
      progress: 0.95,
    })
  },
}
