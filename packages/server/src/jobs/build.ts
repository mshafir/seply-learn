// The build (spec §5.2 step 3, WP-3.5b): the curator agent turns an
// Expedition's Sources into its Concept set and its chosen Views.
//
//   plan          which Sources and Views; the spending cap; whole or chunks
//   queue Views   the chosen Views appear in the rail, queued (one Change)
//   note          the understanding note (kept in the job, never shown)
//   concepts      the Concept set, one step (or one per chunk, then a merge),
//                 committed as one Change: "Found 84 Concepts in 3 Sources"
//   View n        each View built, inspected, self-reviewed, and committed as
//                 its own Change (or failed with a plain reason)
//
// Every AI stage is a durable step (retried twice) whose result is JSON: the
// op bodies and the spend meter's state. A restart replays the job from the
// top, skipping recorded steps, so a committed View is a checkpoint. A Retry
// (a new attempt) plans again from the logged state: the Concept set is kept
// once it exists, and Views already ready are skipped.
//
// The step functions live in @seply/ai; this file only sequences them.
import {
  applyBodies,
  buildView,
  conceptCount,
  conceptSetLabel,
  estimateFor,
  Goal,
  extractConcepts,
  mergeConceptSet,
  meteredModel,
  modelFor,
  startingSettings,
  planSources,
  previewNodes,
  SpendingCapReached,
  SpendMeter,
  understand,
  autoMerge,
  type AiSetup,
  type CuratorSource,
  type LanguageModelV4,
  type SourcePlan,
  type SpendState,
  type Stage,
  type ViewPlan,
} from "@seply/ai"
import {
  Id,
  isLive,
  keysAfter,
  ulid,
  ViewTypeId,
  type DomainState,
  type OpBody,
} from "@seply/domain"
import { z } from "zod"
import { resolveAi } from "../ai.ts"
import type { Db } from "../db.ts"
import { loadState } from "../projection.ts"
import { readSegments } from "../sources/store.ts"
import { failureReason, isJobPaused } from "./host.ts"
import type { JobContext, JobDefinition, JobServices, Json } from "./types.ts"

/** One View the reader chose (the skim's proposal, spec §5.2 step 2). */
export const BuildViewChoice = z.strictObject({
  viewType: ViewTypeId,
  /** The label in the Views rail while it builds; the curator may sharpen it. */
  label: z.string().trim().min(1).max(80),
  /** The question it answers, in the reader's words. */
  question: z.string().trim().min(1).max(300).optional(),
  /** Why it was proposed ("You kept asking 'what is…'"). */
  why: z.string().trim().max(300).optional(),
})
export type BuildViewChoice = z.infer<typeof BuildViewChoice>

export const BuildJobInput = z.strictObject({
  /**
   * The chosen Views, best first. The build queues them in the rail at once.
   * Views already queued in the Expedition are built too, after these.
   */
  views: z.array(BuildViewChoice).max(8).default([]),
  /**
   * Views already in the Expedition (queued by the create flow), best first:
   * each is built into its own row. Built before `views`.
   */
  viewIds: z.array(Id).max(16).optional(),
  /** The reader's goals from the Sources screen; the understanding note weighs them. */
  goals: z.array(Goal).max(3).optional(),
  /** Which Sources to build from; every Source by default. */
  sources: z.array(Id).min(1).optional(),
  /** The spending cap in USD; 2× the estimate by default (spec §5.6). */
  capUsd: z.number().positive().max(200).optional(),
})
export type BuildJobInput = z.infer<typeof BuildJobInput>

/** Step options for AI stages: retried twice (spec §5.6), with room for a long tool loop. */
const AI_STEP = { retries: 2, retryDelayMs: 5_000, timeoutMs: 30 * 60_000 }

type PlannedView = {
  n: number
  viewId: string
  viewType: ViewTypeId
  label: string
  question?: string
  why?: string
  /** "new": to create; else its status when planned. */
  status: "new" | "queued" | "building" | "failed" | "ready"
}

type Plan = {
  views: PlannedView[]
  keys: string[]
  sources: string[]
  sourceChars: number
  conceptsDone: boolean
  capUsd: number
  sourcePlan: SourcePlan
  draft: boolean
}

/** What an AI step returns: its outcome and the meter after it. */
type Metered<T> = T & { meter: SpendState }

export const buildJob: JobDefinition<BuildJobInput> = {
  kind: "build",
  input: BuildJobInput,
  notification: (_job, outcome) =>
    outcome === "complete"
      ? { title: "Your Expedition is ready", body: "Every View is built." }
      : { title: "The build stopped", body: "Some Views couldn't be built. Open it to see why." },

  async run(ctx) {
    const { expeditionId } = ctx.job
    const services = ctx.services
    await ctx.progress({ status: "running", step: "Reading the Sources", progress: 0 })

    // --- plan -------------------------------------------------------------
    const plan = await ctx.step(
      "plan",
      () =>
        ctx.withDb(async (db) => {
          const state = await mustLoad(db, expeditionId)
          const sources = await loadSources(db, services, state, ctx.input.sources)
          const ai = await setupFor(db, services, ctx.job.startedBy)
          const views = planViews(state, ctx.input.views, ctx.input.viewIds ?? [])
          const sourceChars = sources.reduce(
            (n, s) => n + s.segments.reduce((m, g) => m + g.text.length, 0),
            0
          )
          const todo = views.filter((v) => v.status !== "ready").length
          const capUsd =
            ctx.input.capUsd ??
            (ai.setup ? estimateFor(ai.setup, sourceChars, todo).capUsd : 5)
          const last =
            Object.values(state.views)
              .filter(isLive)
              .map((v) => v.orderKey)
              .sort()
              .at(-1) ?? null
          const out: Plan = {
            views,
            keys: keysAfter(last, Math.max(1, views.length)),
            sources: sources.map((s) => s.id),
            sourceChars,
            conceptsDone: conceptCount(state) > 0,
            capUsd,
            sourcePlan: planSources(sources, ai.priceKey, {
              maxTokens: services.curator?.wholeSourceMaxTokens,
              chunkTokens: services.curator?.chunkTokens,
            }),
            draft: state.expedition.status === "draft",
          }
          return out as unknown as Json
        }),
      { retries: 2 }
    ) as unknown as Plan

    const total = plan.views.length
    await ctx.commit("queue Views", async () => ({
      label: `Queued ${total} View${total === 1 ? "" : "s"}`,
      ops: [
        ...(plan.draft
          ? [{ kind: "expedition.set", target: expeditionId, path: "status", value: "building" } as OpBody]
          : []),
        ...plan.views.flatMap((v, i): OpBody[] =>
          v.status === "new"
            ? [
                {
                  kind: "view.create",
                  target: v.viewId,
                  value: {
                    viewType: v.viewType,
                    label: v.label,
                    ...(v.question && { question: v.question }),
                    orderKey: plan.keys[i]!,
                    settings: startingSettings(v.viewType),
                    status: "queued",
                  },
                },
              ]
            : v.status === "failed" || v.status === "building"
              ? [{ kind: "view.set", target: v.viewId, path: "status", value: "queued" }]
              : []
        ),
      ],
    }))

    // --- the understanding note --------------------------------------------
    // The cap (spec §5.6), raised once for each Continue. A stage that
    // reaches it throws SpendingCapReached out of its step: the attempt ends
    // `paused`, and Continue starts the next one from the log.
    const start = new SpendMeter({ kind: "build", capUsd: plan.capUsd })
    for (let i = 0; i < ctx.job.capRaises; i++) start.raise()
    let meter: SpendState = start.toJSON()
    const whole = plan.sourcePlan.mode === "whole"
    await ctx.progress({ status: "running", step: "Understanding the Sources", progress: 0.02 })
    const note = (await ctx.step(
      "note",
      async () =>
        metered(meter, async (m) => {
          const { sources, model } = await load(ctx, m, "curator")
          return { note: await understand({ model, sources, whole, goals: ctx.input.goals }) }
        }),
      AI_STEP
    )) as unknown as Metered<{ note: string }>
    meter = note.meter

    // --- the Concept set -----------------------------------------------------
    if (!plan.conceptsDone) {
      const onConcepts = throttle(async (state: DomainState) => {
        const n = conceptCount(state)
        await ctx.progress({
          status: "running",
          step: `Finding Concepts · ${n} so far`,
          progress: 0.05,
        })
      })
      const bodies: OpBody[] = []
      const chunks = plan.sourcePlan.mode === "chunks" ? plan.sourcePlan.chunks : [null]
      for (const [i, chunk] of chunks.entries()) {
        const r = (await ctx.step(
          chunk ? `concepts: chunk ${i + 1} of ${chunks.length}` : "concepts",
          async () =>
            metered(meter, async (m) => {
              const { sources, model, state } = await load(ctx, m, "curator")
              const before = applyBodies(state, bodies)
              const out = await extractConcepts({
                model,
                sources,
                state: before,
                note: note.note,
                ...(chunk && { chunk: { index: i, of: chunks.length, parts: chunk } }),
                onStep: ({ state }) => onConcepts(state),
              })
              // Whole Sources: the deterministic merge runs here; chunks get the merge pass.
              const merged = chunk ? [] : autoMerge(applyBodies(before, out.bodies))
              return {
                bodies: [...out.bodies, ...merged] as unknown as Json,
                summary: out.summary,
                steps: out.steps,
                toolCalls: out.toolCalls,
              }
            }),
          AI_STEP
        )) as unknown as Metered<{ bodies: OpBody[] }>
        meter = r.meter
        bodies.push(...r.bodies)
      }
      if (plan.sourcePlan.mode === "chunks") {
        const r = (await ctx.step(
          "concepts: merge",
          async () =>
            metered(meter, async (m) => {
              const { sources, model, state } = await load(ctx, m, "curator")
              const out = await mergeConceptSet({
                model,
                sources,
                state: applyBodies(state, bodies),
                note: note.note,
                onStep: ({ state }) => onConcepts(state),
              })
              return {
                bodies: out.bodies as unknown as Json,
                summary: out.summary,
                steps: out.steps,
                toolCalls: out.toolCalls,
              }
            }),
          AI_STEP
        )) as unknown as Metered<{ bodies: OpBody[] }>
        meter = r.meter
        bodies.push(...r.bodies)
      }
      await ctx.commit("commit Concept set", async () => {
        const found = await ctx.withDb(async (db) =>
          conceptCount(applyBodies(await mustLoad(db, expeditionId), bodies))
        )
        return { label: conceptSetLabel(found, plan.sources.length), ops: bodies }
      })
      await ctx.progress({
        status: "running",
        step: "Found the Concepts",
        progress: 0.3,
      })
    }

    // --- each View -------------------------------------------------------------
    const todo = plan.views.filter((v) => v.status !== "ready")
    const failed: string[] = []
    for (const [i, v] of todo.entries()) {
      const at = 0.3 + (0.7 * i) / todo.length
      await ctx.progress({
        viewId: v.viewId,
        status: "building",
        step: `Building ${v.label}`,
        progress: 0,
      })
      let r: Metered<
        | { status: "ready"; bodies: OpBody[]; label: string }
        | { status: "failed"; reason: string }
      >
      try {
        r = (await ctx.step(
          `View ${v.n}: build`,
          async () =>
            metered(meter, async (m) => {
              const { sources, model, state } = await load(ctx, m, "curator")
              const views = services.views
              if (!views) throw new Error("This server can't draw Views for the curator")
              let steps = 0
              const onStep = throttle(async (s: { state: DomainState; staged: readonly OpBody[] }) => {
                steps++
                await ctx.progress({
                  viewId: v.viewId,
                  status: "building",
                  step: `Building ${v.label}`,
                  progress: Math.min(0.9, steps / 20),
                  previewNodes: previewNodes(s.state, s.staged),
                })
              })
              const out = await buildView({
                model,
                sources,
                state,
                note: note.note,
                view: viewPlan(v),
                views,
                whole,
                onStep: (s) => onStep(s),
              })
              return (
                out.status === "ready"
                  ? {
                      status: "ready",
                      bodies: out.bodies,
                      label: out.label,
                      // Kept in the job for review; never shown.
                      review: out.review,
                      warnings: out.warnings,
                      steps: out.steps,
                      toolCalls: out.toolCalls,
                    }
                  : { status: "failed", reason: out.reason, steps: out.steps, toolCalls: out.toolCalls }
              ) as unknown as object
            }),
          AI_STEP
        )) as unknown as typeof r
      } catch (err) {
        // The spending cap pauses the whole job; anything else fails this View.
        if (isJobPaused(err)) throw err
        r = { status: "failed", reason: failureReason(err), meter }
      }
      meter = r.meter

      if (r.status === "failed") {
        const reason = r.reason
        failed.push(v.label)
        await ctx.commit(`View ${v.n}: fail`, async () => ({
          label: `Could not build ${v.label}`,
          ops: [
            { kind: "view.set", target: v.viewId, path: "status", value: "failed" },
            { kind: "view.set", target: v.viewId, path: "failReason", value: reason },
          ],
        }))
        await ctx.progress({ viewId: v.viewId, status: "failed", step: `${v.label} failed`, progress: 0, reason })
        continue
      }

      const built = r
      await ctx.commit(`View ${v.n}: commit`, async () => {
        // Read at commit time: the first View to finish becomes the best View.
        const extra = await ctx.withDb(async (db) => {
          const state = await mustLoad(db, expeditionId)
          const ops: OpBody[] = []
          if (state.views[v.viewId]?.failReason)
            ops.push({ kind: "view.set", target: v.viewId, path: "failReason", value: null })
          if (!state.expedition.bestViewId)
            ops.push({ kind: "expedition.set", target: expeditionId, path: "bestViewId", value: v.viewId })
          if (state.expedition.status !== "ready")
            ops.push({ kind: "expedition.set", target: expeditionId, path: "status", value: "ready" })
          return ops
        })
        return { label: built.label, ops: [...built.bodies, ...extra] }
      })
      await ctx.progress({ viewId: v.viewId, status: "ready", step: `${v.label} is ready`, progress: 1 })
      await ctx.progress({
        status: "running",
        step: `Built ${i + 1} of ${todo.length} Views`,
        progress: at + 0.7 / todo.length,
      })
    }

    if (failed.length)
      throw new Error(
        failed.length === todo.length
          ? `No View could be built (${failed.join(", ")})`
          : `${failed.length} of ${todo.length} Views couldn't be built: ${failed.join(", ")}`
      )
  },
}

// --- helpers ------------------------------------------------------------------

async function mustLoad(db: Db, expeditionId: string): Promise<DomainState> {
  const state = await loadState(db, expeditionId)
  if (!state) throw new Error("The Expedition is gone")
  return state
}

/** The Sources to build from, with their segments, in the order they were added. */
async function loadSources(
  db: Db,
  services: JobServices,
  state: DomainState,
  only: readonly string[] | undefined
): Promise<CuratorSource[]> {
  if (!services.blobs) throw new Error("This server can't read Sources")
  const ids = Object.values(state.sources)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))
    .map((s) => s.id)
    .filter((id) => !only || only.includes(id))
  const out: CuratorSource[] = []
  for (const id of ids) {
    const r = await readSegments(db, services.blobs, state.expedition.id, id)
    if (!r || !r.segments.segments.length) continue
    out.push({
      id,
      title: r.source.title,
      segments: r.segments.segments.map((s) => ({
        id: s.id,
        text: s.text,
        ...(s.speaker && { speaker: s.speaker }),
        ...(s.heading && { heading: s.heading }),
      })),
    })
  }
  if (!out.length) throw new Error("There are no Sources to build from")
  return out
}

type AiFor = {
  setup: AiSetup | null
  priceKey: { provider: string; modelId: string }
}

/** The AI setup (never persisted: resolved in each step), or the test model. */
async function setupFor(db: Db, services: JobServices, userId: string): Promise<AiFor> {
  if (services.model) {
    const m = services.model("curator")
    return { setup: null, priceKey: { provider: "gateway", modelId: m.modelId } }
  }
  if (!services.env) throw new Error("This server has no AI configured")
  const ai = await resolveAi(db, services.env, userId)
  if (!ai.ok)
    throw new Error(
      ai.reason === "no-key"
        ? "No AI key: add one in Settings to build"
        : "This server has no AI configured"
    )
  return {
    setup: ai.setup,
    priceKey: { provider: ai.setup.credentials.provider, modelId: ai.setup.models.curator },
  }
}

/** What each AI step reads afresh: the state, the Sources and a metered model. */
async function load(
  ctx: JobContext<BuildJobInput>,
  meter: SpendMeter,
  stage: Stage
): Promise<{ state: DomainState; sources: CuratorSource[]; model: LanguageModelV4 }> {
  return ctx.withDb(async (db) => {
    const state = await mustLoad(db, ctx.job.expeditionId)
    const sources = await loadSources(db, ctx.services, state, ctx.input.sources)
    const test = ctx.services.model?.(stage)
    let model: LanguageModelV4
    if (test) {
      model = meteredModel(test, meter, { provider: "gateway", modelId: test.modelId })
    } else {
      const ai = await setupFor(db, ctx.services, ctx.job.startedBy)
      model = modelFor(ai.setup!, stage, meter)
    }
    return { state, sources, model }
  })
}

/**
 * Runs an AI stage with the meter restored from the last step. A cap
 * reached inside it propagates (the host pauses the job; never retried).
 */
async function metered<T extends object>(
  state: SpendState,
  fn: (m: SpendMeter) => Promise<T>
): Promise<Json> {
  const m = SpendMeter.from(state)
  try {
    const out = await fn(m)
    return { ...out, meter: m.toJSON() } as unknown as Json
  } catch (err) {
    // The AI SDK may wrap it; the host pauses on the bare error.
    throw capReached(err) ?? err
  }
}

function capReached(err: unknown): SpendingCapReached | null {
  for (let e: unknown = err, i = 0; e && i < 5; i++) {
    if (e instanceof SpendingCapReached) return e
    e = (e as { lastError?: unknown }).lastError ?? (e as { cause?: unknown }).cause
  }
  return null
}

/**
 * Which Views to build: those named by id, then the chosen ones (matched to Views a previous attempt
 * queued, by View Type and label), then any others queued in the Expedition.
 */
function planViews(
  state: DomainState,
  chosen: readonly BuildViewChoice[],
  viewIds: readonly string[]
): PlannedView[] {
  const live = Object.values(state.views)
    .filter(isLive)
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
  const used = new Set<string>()
  const out: PlannedView[] = []
  // Views named by id (the create flow queued them): into their own rows.
  for (const id of viewIds) {
    const v = state.views[id]
    if (!isLive(v) || used.has(id)) continue
    used.add(id)
    out.push({
      n: out.length + 1,
      viewId: id,
      viewType: v!.viewType,
      label: v!.label,
      ...(v!.question && { question: v!.question }),
      status: v!.status,
    })
  }
  // The curator may sharpen a View's label and question, so a Retry matches
  // by View Type and label, then question, then rail order.
  const tests: ((c: BuildViewChoice, v: DomainState["views"][string]) => boolean)[] = [
    (c, v) => v.label === c.label,
    (c, v) => !!c.question && v.question === c.question,
    () => true,
  ]
  const matched = new Map<number, DomainState["views"][string]>()
  for (const test of tests)
    chosen.forEach((c, i) => {
      if (matched.has(i)) return
      const v = live.find((v) => !used.has(v.id) && v.viewType === c.viewType && test(c, v))
      if (!v) return
      matched.set(i, v)
      used.add(v.id)
    })
  for (const [i, c] of chosen.entries()) {
    const found = matched.get(i)
    out.push({
      n: out.length + 1,
      viewId: found?.id ?? ulid(Date.now()),
      viewType: c.viewType,
      label: c.label,
      ...(c.question && { question: c.question }),
      ...(c.why && { why: c.why }),
      status: found?.status ?? "new",
    })
  }
  for (const v of live) {
    if (used.has(v.id) || v.status === "ready") continue
    out.push({
      n: out.length + 1,
      viewId: v.id,
      viewType: v.viewType,
      label: v.label,
      ...(v.question && { question: v.question }),
      status: v.status,
    })
  }
  return out
}

const viewPlan = (v: PlannedView): ViewPlan => ({
  id: v.viewId,
  viewType: v.viewType,
  label: v.label,
  ...(v.question && { question: v.question }),
  ...(v.why && { why: v.why }),
})

/** Calls `fn` at most every `ms` (progress events are best effort). */
function throttle<A extends unknown[]>(fn: (...a: A) => Promise<void>, ms = 1500) {
  let last = 0
  return async (...a: A) => {
    const now = Date.now()
    if (now - last < ms) return
    last = now
    await fn(...a)
  }
}
