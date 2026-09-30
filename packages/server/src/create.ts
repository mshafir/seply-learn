// The create flow (spec §3.3, §3.4, §5.2 steps 1–2; WP-3.4): the draft's
// Sources and chosen Views, the skim, saving the chosen Views, and the hand-off
// to the build (WP-3.5b). Mounted under /expeditions, behind `requireUser`.
//
//   GET  /expeditions/:id/draft   the draft: Sources (with their size), queued Views, counts
//   POST /expeditions/:id/skim    run the skim: propose, suggest more, or ask for one View
//   PUT  /expeditions/:id/plan    save the title and the chosen Views (queued), one Change
//   POST /expeditions/:id/build   start the build (the `build` job, WP-3.5b); 501 without a job runner
import {
  estimateFor,
  Goal,
  modelFor,
  runSkim,
  SpendingCapReached,
  SpendMeter,
  startingSettings,
  type ProviderOptions,
  type SkimRequest,
  type SkimSource,
} from "@seply/ai"
import {
  can,
  isLive,
  keysAfter,
  makeOps,
  ulid,
  ViewTypeId,
  type Action,
  type DomainState,
  type OpBody,
  type Role,
  type SegmentsDoc,
  type SourceKind,
  type ViewStatus,
} from "@seply/domain"
import { Hono, type Context } from "hono"
import { z } from "zod"
import { resolveAi } from "./ai.ts"
import type { AppEnv } from "./app.ts"
import type { Db } from "./db.ts"
import { appendOps, roleOf } from "./oplog.ts"
import { loadState } from "./projection.ts"
import type { BuildJobInput } from "./jobs/build.ts"
import type { JobRunner } from "./jobs/types.ts"
import { publishCommitted, type Relay } from "./relay.ts"
import { expeditionVisibility, readSegments } from "./sources/store.ts"

/** A Source on the create screens. */
export type DraftSource = {
  id: string
  kind: SourceKind
  title: string
  mime?: string
  size?: number
  addedAt: string
  /** Its text, when stored (null: no segments, e.g. imported from JSON). */
  segments: {
    kind: SegmentsDoc["kind"]
    format: SegmentsDoc["format"]
    count: number
    chars: number
  } | null
}

/** A View of the draft, in rail order (queued until built). */
export type DraftView = {
  id: string
  viewType: ViewTypeId
  label: string
  question: string | null
  status: ViewStatus
}

/** GET /expeditions/:id/draft. */
export type Draft = {
  expedition: {
    id: string
    title: string
    summary: string
    status: "draft" | "building" | "ready"
    role: Role
    bestViewId: string | null
  }
  sources: DraftSource[]
  views: DraftView[]
  /** Live Concepts (the build's live counter: "N Concepts found across M Sources"). */
  counts: { concepts: number; sources: number }
}

/** The most Views a plan may hold. */
export const MAX_PLAN_VIEWS = 12
/** How long the skim may take before the request gives up. */
export const SKIM_TIMEOUT_MS = 60_000

export const SkimBody = z
  .object({
    mode: z.enum(["propose", "more", "ask"]).default("propose"),
    goals: z.array(Goal).max(3).default([]),
    /** "Ask for a specific View": the reader's words. */
    request: z.string().trim().min(1).max(500).optional(),
    /** Views already on the page, not to repeat. */
    existing: z
      .array(z.object({ viewType: z.string().max(40), question: z.string().max(500) }))
      .max(40)
      .default([]),
    /** Proposal ids already on the page, so new ones don't reuse them. */
    takenIds: z.array(z.string().max(80)).max(60).default([]),
  })
  .strict()
  .refine((b) => b.mode !== "ask" || !!b.request, {
    message: "a specific request needs `request`",
    path: ["request"],
  })

export const PlanBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(1000).optional(),
    /** Ranked: the first becomes the best View. */
    views: z
      .array(
        z
          .object({
            /** A View already queued in this draft; omitted for a new one. */
            id: z.string().min(1).max(80).optional(),
            viewType: ViewTypeId,
            label: z.string().trim().min(1).max(60),
            question: z.string().trim().min(1).max(300),
          })
          .strict()
      )
      .max(MAX_PLAN_VIEWS),
  })
  .strict()

export const BuildBody = z
  .object({ goals: z.array(Goal).max(3).default([]) })
  .strict()

/**
 * What the build receives (WP-3.5b wires it). The draft is saved first, so
 * everything is in the Expedition: its Sources (`source.add`, segments in
 * the blob store: `readSegments`) and the chosen Views, queued, in rank order
 * (the first is the best View). The build re-resolves the AI setup from
 * `userId` (never persist it).
 */
export type BuildRequest = {
  expeditionId: string
  userId: string
  /** The queued Views to build, best first. */
  viewIds: string[]
  sourceIds: string[]
  goals: Goal[]
}
export type BuildStart =
  | { ok: true; jobId: string }
  | { ok: false; status: 409 | 501; error: string; message: string }

/**
 * The hand-off to the build (WP-3.5b): marks the draft `building` (its own
 * Change, so a second click finds it started already) and starts the `build`
 * job through the JobRunner. The job builds each queued View into its
 * existing row, best first, and resolves the AI setup from `userId` itself.
 */
export async function startBuild(
  c: Context<AppEnv>,
  request: BuildRequest,
  deps: { runner?: JobRunner; relay: Relay }
): Promise<BuildStart> {
  const { runner, relay } = deps
  if (!runner?.registry.has("build"))
    return {
      ok: false,
      status: 501,
      error: "build-unavailable",
      message: "Building isn't available on this server. Your draft is in your Library, under Drafts.",
    }
  const { expeditionId, userId, viewIds, sourceIds, goals } = request
  const db = await c.var.db()
  const changeId = ulid(Date.now())
  const { logged } = await db.transaction((tx) =>
    appendOps(tx, {
      expeditionId,
      userId,
      ops: makeOps(
        [{ kind: "expedition.set", target: expeditionId, path: "status", value: "building" }],
        { expeditionId, actor: userId, changeId, nextOpId: () => ulid(Date.now()) }
      ),
      changes: [{ id: changeId, label: "Started the build" }],
    })
  )
  await publishCommitted(relay, expeditionId, logged)
  const input: BuildJobInput = { views: [], viewIds, sources: sourceIds, goals }
  const job = await runner.start(db, { expeditionId, kind: "build", input, startedBy: userId })
  return { ok: true, jobId: job.id }
}

type Access = { role: Role | null; ok: boolean; found: boolean }

async function access(
  db: Db,
  expeditionId: string,
  userId: string,
  action: Action
): Promise<Access> {
  const visibility = await expeditionVisibility(db, expeditionId)
  if (!visibility) return { role: null, ok: false, found: false }
  const role = await roleOf(db, expeditionId, userId)
  const actor = { role, signedIn: true }
  return {
    role,
    found: can(actor, "read", visibility),
    ok: can(actor, action, visibility),
  }
}

const liveViews = (state: DomainState) =>
  Object.values(state.views)
    .filter(isLive)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))

async function readDraft(
  c: Context<AppEnv>,
  db: Db,
  state: DomainState,
  role: Role
): Promise<Draft> {
  const blobs = (() => {
    try {
      return c.var.blobs()
    } catch {
      return null
    }
  })()
  const sources = await Promise.all(
    Object.values(state.sources)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(async (s): Promise<DraftSource> => {
        const read = blobs ? await readSegments(db, blobs, state.expedition.id, s.id) : null
        const doc = read?.segments
        return {
          id: s.id,
          kind: s.kind,
          title: s.title,
          ...(s.mime ? { mime: s.mime } : {}),
          ...(s.size !== undefined ? { size: s.size } : {}),
          addedAt: s.addedAt,
          segments: doc
            ? { kind: doc.kind, format: doc.format, count: doc.segments.length, chars: doc.chars }
            : null,
        }
      })
  )
  const { id, title, summary, status, bestViewId } = state.expedition
  return {
    expedition: { id, title, summary, status, role, bestViewId },
    sources,
    views: liveViews(state).map((v) => ({
      id: v.id,
      viewType: v.viewType,
      label: v.label,
      question: v.question ?? null,
      status: v.status,
    })),
    counts: {
      concepts: Object.values(state.concepts).filter(isLive).length,
      sources: sources.length,
    },
  }
}

/** The Sources with stored text, as the skim reads them. */
async function skimSources(
  c: Context<AppEnv>,
  db: Db,
  state: DomainState
): Promise<SkimSource[]> {
  const blobs = c.var.blobs()
  const out: SkimSource[] = []
  for (const s of Object.values(state.sources).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const read = await readSegments(db, blobs, state.expedition.id, s.id)
    if (read && read.segments.segments.length)
      out.push({ id: s.id, title: s.title, kind: s.kind, segments: read.segments })
  }
  return out
}

export function createFlowRoutes(relay: Relay, ai?: ProviderOptions, jobs?: JobRunner) {
  const r = new Hono<AppEnv>()

  r.get("/:id/draft", async (c) => {
    const id = c.req.param("id")
    const db = await c.var.db()
    const a = await access(db, id, c.var.user.id, "read")
    const state = a.found && a.role ? await loadState(db, id) : null
    if (!state || !a.role) return c.json({ error: "Expedition not found" }, 404)
    return c.json(await readDraft(c, db, state, a.role))
  })

  r.post("/:id/skim", async (c) => {
    const id = c.req.param("id")
    const body = SkimBody.safeParse(await c.req.json().catch(() => ({})))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const userId = c.var.user.id
    const a = await access(db, id, userId, "useAi")
    if (!a.found) return c.json({ error: "Expedition not found" }, 404)
    if (!a.ok) return c.json({ error: "not allowed", message: "Viewers can't run the AI" }, 403)
    const state = await loadState(db, id)
    if (!state) return c.json({ error: "Expedition not found" }, 404)
    const sources = await skimSources(c, db, state)
    if (!sources.length)
      return c.json({ error: "no-sources", message: "Add a Source first." }, 400)

    const resolved = await resolveAi(db, c.env ?? {}, userId, ai)
    if (!resolved.ok) return c.json({ error: resolved.reason }, 409)
    const { setup } = resolved

    const { mode, goals, request, existing, takenIds } = body.data
    const skimRequest: SkimRequest =
      mode === "propose"
        ? { mode }
        : mode === "more"
          ? { mode, existing }
          : { mode, request: request!, existing }
    // The skim is the build's first stage: it counts against the build's cap.
    const chars = sources.reduce((n, s) => n + s.segments.chars, 0)
    const meter = new SpendMeter({ kind: "build", capUsd: estimateFor(setup, chars).capUsd })
    // Spec §5.2 starts the curator at this moment; v1 starts it at Create
    // (POST /build) instead: the Views are chosen by then, and a draft that is
    // never built spends nothing on it (WP-3.5b, a judgement call).
    try {
      const run = await runSkim({
        model: modelFor(setup, "skim", meter),
        sources,
        goals,
        request: skimRequest,
        takenIds,
        abortSignal: AbortSignal.timeout(SKIM_TIMEOUT_MS),
      })
      return c.json({
        skim: run.result,
        run: {
          ms: run.ms,
          usd: Number(meter.spentUsd.toFixed(6)),
          model: setup.models.skim,
          sample: run.sample,
        },
      })
    } catch (err) {
      if (err instanceof SpendingCapReached) throw err
      console.error("skim failed:", err instanceof Error ? err.message : err)
      return c.json(
        {
          error: "skim-failed",
          message: "The AI couldn't read your Sources just now. Try again.",
        },
        502
      )
    }
  })

  r.put("/:id/plan", async (c) => {
    const id = c.req.param("id")
    const body = PlanBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const userId = c.var.user.id
    const a = await access(db, id, userId, "edit")
    if (!a.found || !a.role) return c.json({ error: "Expedition not found" }, 404)
    if (!a.ok) return c.json({ error: "not allowed", message: "Viewers can't change the draft" }, 403)
    const state = await loadState(db, id)
    if (!state) return c.json({ error: "Expedition not found" }, 404)
    if (state.expedition.status !== "draft")
      return c.json({ error: "not-a-draft", message: "This Expedition has been built already." }, 409)

    const plan = body.data
    const live = liveViews(state)
    const queued = new Map(live.filter((v) => v.status === "queued").map((v) => [v.id, v]))
    for (const v of plan.views) {
      if (!v.id) continue
      const found = queued.get(v.id)
      if (!found || found.viewType !== v.viewType)
        return c.json(
          { error: "invalid body", message: `View ${v.id} isn't a queued ${v.viewType} View of this draft` },
          400
        )
    }
    const kept = new Set(plan.views.flatMap((v) => (v.id ? [v.id] : [])))
    const others = live.filter((v) => !queued.has(v.id))
    const keys = keysAfter(others.at(-1)?.orderKey ?? null, plan.views.length)

    const bodies: OpBody[] = []
    const set = (path: string, value: unknown) =>
      bodies.push({ kind: "expedition.set", target: id, path, value })
    if (plan.title !== state.expedition.title) set("title", plan.title)
    if (plan.summary !== undefined && plan.summary !== state.expedition.summary)
      set("summary", plan.summary)
    for (const v of queued.values())
      if (!kept.has(v.id)) bodies.push({ kind: "view.delete", target: v.id })
    const now = Date.now()
    const ids: string[] = []
    plan.views.forEach((v, i) => {
      const key = keys[i]!
      if (!v.id) {
        const viewId = ulid(now)
        ids.push(viewId)
        bodies.push({
          kind: "view.create",
          target: viewId,
          value: {
            viewType: v.viewType,
            label: v.label,
            question: v.question,
            orderKey: key,
            settings: startingSettings(v.viewType),
            status: "queued",
          },
        })
        return
      }
      ids.push(v.id)
      const was = queued.get(v.id)!
      if (was.label !== v.label)
        bodies.push({ kind: "view.set", target: v.id, path: "label", value: v.label })
      if ((was.question ?? null) !== v.question)
        bodies.push({ kind: "view.set", target: v.id, path: "question", value: v.question })
      if (was.orderKey !== key) bodies.push({ kind: "view.move", target: v.id, value: key })
    })
    const best = ids[0] ?? null
    if (best !== state.expedition.bestViewId) set("bestViewId", best)

    if (bodies.length) {
      const changeId = ulid(now)
      const ops = makeOps(bodies, {
        expeditionId: id,
        actor: userId,
        changeId,
        nextOpId: () => ulid(Date.now()),
      })
      const n = plan.views.length
      const { logged } = await db.transaction((tx) =>
        appendOps(tx, {
          expeditionId: id,
          userId,
          ops,
          changes: [{ id: changeId, label: `Chose ${n} View${n === 1 ? "" : "s"}` }],
        })
      )
      await publishCommitted(relay, id, logged)
    }
    const after = (await loadState(db, id))!
    return c.json(await readDraft(c, db, after, a.role))
  })

  r.post("/:id/build", async (c) => {
    const id = c.req.param("id")
    const body = BuildBody.safeParse(await c.req.json().catch(() => ({})))
    if (!body.success)
      return c.json({ error: "invalid body", issues: body.error.issues }, 400)
    const db = await c.var.db()
    const userId = c.var.user.id
    const a = await access(db, id, userId, "useAi")
    if (!a.found) return c.json({ error: "Expedition not found" }, 404)
    if (!a.ok) return c.json({ error: "not allowed", message: "Viewers can't build" }, 403)
    const state = await loadState(db, id)
    if (!state) return c.json({ error: "Expedition not found" }, 404)
    if (state.expedition.status !== "draft")
      return c.json({ error: "not-a-draft", message: "This Expedition has been built already." }, 409)
    const viewIds = liveViews(state)
      .filter((v) => v.status === "queued")
      .map((v) => v.id)
    const sourceIds = Object.keys(state.sources).sort()
    if (!viewIds.length || !sourceIds.length)
      return c.json(
        { error: "nothing-to-build", message: "Save at least one Source and one View first." },
        409
      )
    // Best View first.
    const best = state.expedition.bestViewId
    if (best && viewIds.includes(best)) viewIds.sort((x, y) => (x === best ? -1 : y === best ? 1 : 0))
    const started = await startBuild(c, {
      expeditionId: id,
      userId,
      viewIds,
      sourceIds,
      goals: body.data.goals,
    }, { runner: jobs, relay })
    if (!started.ok)
      return c.json({ error: started.error, message: started.message }, started.status)
    return c.json({ jobId: started.jobId }, 202)
  })

  return r
}
