// Grow (spec §5.5, WP-4.4): one ask to the curator agent, as a job of kind
// `grow`. Owners and editors start it from the Ask box or a Concept action
// (POST /expeditions/:id/jobs { kind: "grow", input }).
//
// Every write lands in ONE Proposal per ask, whose id is the job's: created
// first (rationale: the ask), then items appended after each of the agent's
// steps, so they stream (the room is poked, and the asker's stream sends
// them as `data-proposal` parts: grow-routes.ts). It never writes a Change.
//
// - Stop is Cancel: the agent stops at its next step; what streamed stays.
// - The per-ask cap (the reader's `askCapUsd`, default $0.50) pauses the ask
//   with what streamed kept: Continue (the cap again) or Stop.
// - A retried step, or a Continue, resumes with the ask's pending items
//   already in the agent's state, so nothing is suggested twice.
import {
  DEFAULT_ASK_CAP_USD,
  grow,
  GROW_ACTIONS,
  growRationale,
  meteredModel,
  planSources,
  SpendMeter,
  type GrowAsk,
} from "@seply/ai"
import { scriptedModel, type ScriptTurn } from "@seply/ai/testing"
import { Id, isLive, previewProposals, schema } from "@seply/domain"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import { resolveAi } from "../ai.ts"
import { readConfig } from "../config.ts"
import { addProposalItems, createProposal } from "../proposals.ts"
import {
  AI_STEP,
  load,
  loadSources,
  metered,
  mustLoad,
  setupFor,
  type Metered,
} from "./ai-steps.ts"
import { getJob } from "./store.ts"
import type { JobContext, JobDefinition } from "./types.ts"

/**
 * Tests only (a localhost server with test credentials): the model's turns,
 * so e2e runs an ask with no provider. `"@n"` in a call's input is the id of
 * the n-th Concept this ask created; `"=Title"` the id of the Concept with
 * that title in the Expedition.
 */
export const GrowScript = z.strictObject({
  steps: z
    .array(
      z.union([
        z.strictObject({
          calls: z
            .array(z.strictObject({ tool: z.string(), input: z.record(z.string(), z.unknown()) }))
            .max(20),
        }),
        z.strictObject({ text: z.string() }),
      ])
    )
    .min(1)
    .max(30),
  /** Each step waits this long first (so Stop can be pressed mid-ask). */
  delayMs: z.number().int().min(0).max(10_000).optional(),
})
export type GrowScript = z.infer<typeof GrowScript>

export const GrowJobInput = z
  .strictObject({
    /** The reader's words, from the Ask box. */
    ask: z.string().trim().min(2).max(2000).optional(),
    /** A Concept action, about `conceptId`. */
    action: z.enum(GROW_ACTIONS).optional(),
    conceptId: Id.optional(),
    /** The View the reader is looking at. */
    viewId: Id.optional(),
    /** The ask's spending cap; the reader's per-ask cap by default (spec §5.5). */
    capUsd: z.number().positive().max(20).optional(),
    script: GrowScript.optional(),
  })
  .refine((v) => !!v.ask || (!!v.action && !!v.conceptId), {
    message: "an ask needs words, or a Concept action and its Concept",
  })
export type GrowJobInput = z.infer<typeof GrowJobInput>

const askOf = (i: GrowJobInput): GrowAsk => ({
  ...(i.ask && { text: i.ask }),
  ...(i.action && { action: i.action }),
  ...(i.conceptId && { conceptId: i.conceptId }),
  ...(i.viewId && { viewId: i.viewId }),
})

/** What a scripted ask is priced as. */
const SCRIPT_PRICE = { provider: "gateway", modelId: "anthropic/claude-opus-5.5" } as const

type Plan = { rationale: string; capUsd: number; whole: boolean }
type Asked = Metered<{ items: number; text: string; stopped: boolean }>

export const growJob: JobDefinition<GrowJobInput> = {
  kind: "grow",
  input: GrowJobInput,
  notification: () => null,

  async run(ctx) {
    const { expeditionId, jobId } = ctx.job
    const plan = (await ctx.step(
      "plan",
      () =>
        ctx.withDb(async (db) => {
          const state = await mustLoad(db, expeditionId)
          const { conceptId, script } = ctx.input
          if (conceptId && !isLive(state.concepts[conceptId])) throw new Error("That Concept is gone")
          if (script && !testCredentials(ctx)) throw new Error("Scripted asks are for tests only")
          const sources = await loadSources(db, ctx.services, state, undefined, { allowNone: true })
          const priceKey = script
            ? SCRIPT_PRICE
            : (await setupFor(db, ctx.services, ctx.job.startedBy, "curator")).priceKey
          let capUsd = ctx.input.capUsd
          if (capUsd === undefined && !ctx.services.model && !script) {
            const r = await resolveAi(db, ctx.services.env!, ctx.job.startedBy)
            capUsd = r.ok ? r.askCapUsd : undefined
          }
          return {
            rationale: growRationale(askOf(ctx.input), state),
            capUsd: capUsd ?? DEFAULT_ASK_CAP_USD,
            whole: planSources(sources, priceKey).mode === "whole",
          }
        }),
      { retries: 2 }
    )) as Plan

    // The Proposal first, so the ask shows (Activity, the stream) before anything streams.
    await ctx.step(
      "propose",
      () =>
        ctx.withDb((db) =>
          createProposal(db, {
            expeditionId,
            id: jobId,
            author: ctx.job.startedBy,
            origin: "ai",
            rationale: plan.rationale,
          })
        ),
      { retries: 3 }
    )
    await ctx.progress({ status: "running", step: "Thinking about your ask", progress: 0.1 })

    const start = new SpendMeter({ kind: "ask", capUsd: plan.capUsd })
    for (let i = 0; i < ctx.job.capRaises; i++) start.raise()
    const r = (await ctx.step(
      "ask",
      () => metered(start.toJSON(), (m) => runAsk(ctx, m, plan)),
      AI_STEP
    )) as unknown as Asked
    if (r.stopped) return
    if (!r.items)
      throw new Error(
        r.text ? `Nothing to suggest: ${r.text.slice(0, 240)}` : "Nothing to suggest for this ask."
      )
    await ctx.progress({
      status: "running",
      step: `Suggested ${r.items === 1 ? "1 change" : `${r.items} changes`}`,
      progress: 0.95,
    })
  },
}

/** One run of the agent, writing each step's items to the ask's Proposal. */
async function runAsk(
  ctx: JobContext<GrowJobInput>,
  meter: SpendMeter,
  plan: Plan
): Promise<{ items: number; text: string; stopped: boolean }> {
  const { expeditionId, jobId, attempt } = ctx.job
  const { state, sources, model } = ctx.input.script
    ? await scripted(ctx, meter, ctx.input.script)
    : await load(ctx, meter, "curator", { allowNoSources: true })

  // A resumed ask (a retried step, Continue): its pending items are already suggested.
  const earlier = await ctx.withDb((db) =>
    db
      .select()
      .from(schema.proposalItems)
      .where(
        and(
          eq(schema.proposalItems.expeditionId, expeditionId),
          eq(schema.proposalItems.proposalId, jobId),
          eq(schema.proposalItems.status, "pending")
        )
      )
      .orderBy(asc(schema.proposalItems.position))
  )
  const working = earlier.length ? previewProposals(state, earlier).state : state

  const stop = new AbortController()
  let count = 0
  let stopped = false
  const stillMine = async () => {
    const job = await ctx.withDb((db) => getJob(db, jobId)).catch(() => null)
    return !!job && job.status !== "cancelled" && job.attempt === attempt
  }

  try {
    const out = await grow({
      model,
      state: working,
      sources,
      whole: plan.whole,
      ask: askOf(ctx.input),
      ...(ctx.input.viewId && ctx.services.views && { views: ctx.services.views }),
      earlier: earlier.length,
      abortSignal: stop.signal,
      onItems: async (items) => {
        // Stopped meanwhile: nothing more is suggested (a Workflow's
        // terminate cuts the step off; an in-process run must check).
        if (!(await stillMine())) {
          stopped = true
          stop.abort()
          return
        }
        await ctx.withDb((db) =>
          // The base is the Expedition as the agent saw it.
          addProposalItems(db, { expeditionId, proposalId: jobId, items, state })
        )
        count += items.length
        await ctx.announceProposals()
        const all = earlier.length + count
        await ctx.progress({
          status: "running",
          step: `Suggested ${all === 1 ? "1 change" : `${all} changes`} so far`,
          progress: Math.min(0.9, 0.1 + all * 0.05),
        })
      },
      // Stop: the asker cancelled; the agent stops before its next step.
      onStep: async () => {
        if (!(await stillMine())) {
          stopped = true
          stop.abort()
        }
      },
    })
    return { items: earlier.length + out.items, text: out.text, stopped: false }
  } catch (err) {
    if (stopped) return { items: earlier.length + count, text: "", stopped: true }
    throw err
  }
}

function testCredentials(ctx: JobContext<unknown>): boolean {
  if (ctx.services.model) return true
  try {
    return !!ctx.services.env && readConfig(ctx.services.env).testCredentials
  } catch {
    return false
  }
}

/** The state and Sources as `load` reads them, and a scripted model on the ask's meter. */
async function scripted(ctx: JobContext<GrowJobInput>, meter: SpendMeter, script: GrowScript) {
  const { state, sources } = await ctx.withDb(async (db) => {
    const state = await mustLoad(db, ctx.job.expeditionId)
    return { state, sources: await loadSources(db, ctx.services, state, undefined, { allowNone: true }) }
  })
  const model = meteredModel(
    scriptedModel(scriptOf(script), { usage: { input: 1000, output: 100 } }),
    meter,
    SCRIPT_PRICE
  )
  return { state, sources, model }
}

/** A GrowScript as a scripted model's script. */
export function scriptOf(script: GrowScript) {
  return async (t: ScriptTurn) => {
    if (script.delayMs) await new Promise((r) => setTimeout(r, script.delayMs))
    const step = script.steps[t.step] ?? { text: "Done." }
    if ("text" in step) return step
    const made = t.allResults
      .filter((r) => r.tool === "concept_create" && (r.output as { ok?: boolean })?.ok)
      .map((r) => (r.output as { id: string }).id)
    const resolve = (v: unknown): unknown => {
      if (typeof v === "string" && /^@\d+$/.test(v)) return made[Number(v.slice(1))] ?? v
      if (typeof v === "string" && v.startsWith("=")) {
        const title = v.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        return new RegExp(`^(\\S+) \\| ${title} \\|`, "m").exec(t.user)?.[1] ?? v
      }
      if (Array.isArray(v)) return v.map(resolve)
      if (v && typeof v === "object")
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]))
      return v
    }
    return { calls: step.calls.map((c) => ({ tool: c.tool, input: resolve(c.input) as Record<string, unknown> })) }
  }
}
