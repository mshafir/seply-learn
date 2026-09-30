// What the AI jobs share (the build, the writers, "Write the article"): each
// AI step reads the state, the Sources and a metered model afresh, and
// returns JSON with the spend meter after it.
import {
  modelFor,
  meteredModel,
  SpendingCapReached,
  SpendMeter,
  type AiSetup,
  type CuratorSource,
  type LanguageModelV4,
  type SpendState,
  type Stage,
} from "@seply/ai"
import type { DomainState } from "@seply/domain"
import { resolveAi } from "../ai.ts"
import type { Db } from "../db.ts"
import { loadState } from "../projection.ts"
import { readSegments } from "../sources/store.ts"
import type { JobContext, JobServices, Json } from "./types.ts"

/** Step options for AI stages: retried twice (spec §5.6), with room for a long tool loop. */
export const AI_STEP = { retries: 2, retryDelayMs: 5_000, timeoutMs: 30 * 60_000 }

/** What an AI step returns: its outcome and the meter after it. */
export type Metered<T> = T & { meter: SpendState }

export async function mustLoad(db: Db, expeditionId: string): Promise<DomainState> {
  const state = await loadState(db, expeditionId)
  if (!state) throw new Error("The Expedition is gone")
  return state
}

/**
 * The Sources to build from, with their segments, in the order they were
 * added. None is an error unless `allowNone` (an article can be written from
 * background knowledge alone, e.g. in an imported Expedition).
 */
export async function loadSources(
  db: Db,
  services: JobServices,
  state: DomainState,
  only: readonly string[] | undefined,
  opts: { allowNone?: boolean } = {}
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
  if (!out.length && !opts.allowNone) throw new Error("There are no Sources to build from")
  return out
}

type AiFor = {
  setup: AiSetup | null
  priceKey: { provider: string; modelId: string }
}

/** The AI setup (never persisted: resolved in each step), or the test model. */
export async function setupFor(
  db: Db,
  services: JobServices,
  userId: string,
  stage: Stage = "curator"
): Promise<AiFor> {
  if (services.model) {
    const m = services.model(stage)
    return { setup: null, priceKey: { provider: "gateway", modelId: m.modelId } }
  }
  if (!services.env) throw new Error("This server has no AI configured")
  const ai = await resolveAi(db, services.env, userId)
  if (!ai.ok)
    throw new Error(
      ai.reason === "no-key"
        ? "No AI key: add one in Settings"
        : "This server has no AI configured"
    )
  return {
    setup: ai.setup,
    priceKey: { provider: ai.setup.credentials.provider, modelId: ai.setup.models[stage] },
  }
}

/** What each AI step reads afresh: the state, the Sources and a metered model. */
export async function load(
  ctx: JobContext<object & { sources?: string[] }>,
  meter: SpendMeter,
  stage: Stage,
  opts: { allowNoSources?: boolean } = {}
): Promise<{ state: DomainState; sources: CuratorSource[]; model: LanguageModelV4 }> {
  return ctx.withDb(async (db) => {
    const state = await mustLoad(db, ctx.job.expeditionId)
    const sources = await loadSources(db, ctx.services, state, ctx.input.sources, {
      allowNone: opts.allowNoSources,
    })
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
export async function metered<T extends object>(
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

/** Calls `fn` at most every `ms` (progress events are best effort). */
export function throttle<A extends unknown[]>(fn: (...a: A) => Promise<void>, ms = 1500) {
  let last = 0
  return async (...a: A) => {
    const now = Date.now()
    if (now - last < ms) return
    last = now
    await fn(...a)
  }
}
