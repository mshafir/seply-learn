// The curator's build stages (spec §5.2 step 3): the understanding note, the
// Concept set (whole Sources, or chunk by chunk and merged), and each View,
// built, inspected, self-reviewed and ready to commit as its own Change.
//
// Each stage is a plain async function over a DomainState: it returns op
// bodies (and what the job needs to report), and never writes anywhere. The
// job (`@seply/server`'s `build` kind) runs each in its own durable step and
// commits what it returns, so a restart resumes from the last commit.
import {
  isLive,
  mergeConcepts,
  ulid,
  VIEW_TYPES,
  type DomainState,
  type OpBody,
  type PreviewNode,
  type ViewTypeId,
} from "@seply/domain"
import { generateText, type LanguageModel, type ModelMessage } from "ai"
import { z } from "zod"
import type { Finding } from "../checks/index.ts"
import { inspectView } from "../inspect.ts"
import { liveConcepts, liveRelationships } from "../checks/common.ts"
import { memorySourceReader, type ViewReader } from "../ports.ts"
import { normalizeTitle } from "../search.ts"
import { StagingArea } from "../stage.ts"
import { createCuratorTools, type CuratorTool } from "../tools.ts"
import { runLoop, type LoopTools } from "./loop.ts"
import {
  conceptInstructions,
  mergeInstructions,
  noteInstructions,
  viewInstructions,
  viewTypeDoc,
} from "./playbook.ts"
import {
  chunkFilter,
  renderSourceIndex,
  renderSources,
  type CuratorSource,
} from "./sources.ts"

/** Step budgets for one loop. */
export const MAX_STEPS = {
  concepts: 80,
  merge: 40,
  view: 40,
} as const

/** How many times a stage asks the agent to fix what blocks its commit. */
const FIX_ROUNDS = 2

/** What every stage takes. */
export type StageOptions = {
  model: LanguageModel
  sources: readonly CuratorSource[]
  /** Mints entity ids (ULIDs by default). */
  newId?: () => string
  abortSignal?: AbortSignal
  /** Called after each model step, with the working copy (live counters, previews). */
  onStep?: (p: { state: DomainState; staged: readonly OpBody[] }) => void | Promise<void>
}

// --- the understanding note --------------------------------------------------

/**
 * What the reader wanted, what they decided, what's still open (spec §5.2
 * step 3.2). Plain prose, kept in the job and never shown.
 */
export async function understand(
  o: Pick<StageOptions, "model" | "sources" | "abortSignal"> & { whole: boolean }
): Promise<string> {
  const text = o.whole ? renderSources(o.sources) : renderSourceIndex(o.sources)
  const r = await generateText({
    model: o.model,
    system: noteInstructions(),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text,
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          },
        ],
      },
    ],
    maxOutputTokens: 1500,
    maxRetries: 2,
    ...(o.abortSignal && { abortSignal: o.abortSignal }),
  })
  return r.text.trim()
}

// --- the Concept set ---------------------------------------------------------

export type ConceptStageResult = {
  /** The op bodies to add, in order. */
  bodies: OpBody[]
  /** The agent's last words (a one-line summary). */
  summary: string
  steps: number
  toolCalls: number
}

/**
 * Builds (or, in chunk mode, extends) the Concept set: one loop over the
 * whole Sources, or over one chunk with the Concepts earlier chunks made
 * already in `state`. Returns the op bodies; nothing is committed.
 */
export async function extractConcepts(
  o: StageOptions & {
    state: DomainState
    note: string
    /** Chunk mode: which chunk this is, and its segments. */
    chunk?: {
      index: number
      of: number
      parts: readonly { source: string; segments: readonly string[] }[]
    }
  }
): Promise<ConceptStageResult> {
  const t = conceptTools(o)
  const prefix = o.chunk
    ? renderSources(o.sources, chunkFilter(o.chunk.parts))
    : renderSources(o.sources)
  const existing = liveConcepts(t.stage.state).length
  const task = [
    `## Your understanding note\n\n${o.note}`,
    o.chunk
      ? `## This run\n\nThis is chunk ${o.chunk.index + 1} of ${o.chunk.of} of the Sources (above). ${existing ? `The Expedition already has ${existing} Concepts from earlier chunks, listed below: search before you create, and extend those instead of duplicating them.\n\n${describeConcepts(t.stage.state)}` : "It is the first chunk."}`
      : `## This run\n\nBuild the Concept set for the whole Sources above, following the playbook.`,
    `Source ids: ${o.sources.map((s) => `${s.id} (${s.title})`).join(", ")}.`,
  ].join("\n\n")
  const r = await runLoop({
    model: o.model,
    instructions: conceptInstructions(),
    prefix,
    task,
    tools: t.tools,
    maxSteps: MAX_STEPS.concepts,
    onStep: () => o.onStep?.({ state: t.stage.state, staged: t.stage.staged }),
    abortSignal: o.abortSignal,
  })
  const blocked = await fixUntilClean(o, t, r.messages, prefix)
  return {
    bodies: [...t.stage.staged],
    summary: blocked ?? r.text,
    steps: r.steps,
    toolCalls: r.toolCalls,
  }
}

/**
 * The merge-and-tidy pass after the last chunk (chunk mode): the
 * deterministic merge of exact title/alias matches first, then the agent,
 * with the remaining near-duplicate candidates.
 */
export async function mergeConceptSet(
  o: StageOptions & { state: DomainState; note: string }
): Promise<ConceptStageResult> {
  const auto = autoMerge(o.state)
  const staged = new StagingArea(o.state)
  const r0 = staged.stage(auto)
  if (!r0.ok) throw new Error(`auto merge: ${r0.error}`)
  const t = conceptTools({ ...o, state: staged.state }, { merge: true })
  const candidates = duplicateCandidates(t.stage.state)
  const prefix = renderSourceIndex(o.sources)
  const task = [
    `## Your understanding note\n\n${o.note}`,
    `## The Concept set so far\n\n${describeConcepts(t.stage.state)}`,
    `## Candidate duplicates\n\n${candidates.length ? candidates.map((g) => `- ${g.map((c) => `${c.title} (${c.id})`).join(" · ")}`).join("\n") : "None found."}`,
    `Tidy the set following the merge playbook, then reply with a one-line summary and no tool calls.`,
  ].join("\n\n")
  const r = await runLoop({
    model: o.model,
    instructions: mergeInstructions(),
    prefix,
    task,
    tools: t.tools,
    maxSteps: MAX_STEPS.merge,
    onStep: () => o.onStep?.({ state: t.stage.state, staged: t.stage.staged }),
    abortSignal: o.abortSignal,
  })
  const blocked = await fixUntilClean(o, t, r.messages, prefix)
  return {
    bodies: [...auto, ...t.stage.staged],
    summary: blocked ?? r.text,
    steps: r.steps,
    toolCalls: r.toolCalls,
  }
}

/** The label of the Concept-set Change: "Found 84 Concepts in 3 Sources". */
export function conceptSetLabel(concepts: number, sources: number): string {
  const c = `${concepts} Concept${concepts === 1 ? "" : "s"}`
  const s = `${sources} Source${sources === 1 ? "" : "s"}`
  return `Found ${c} in ${s}`
}

type ConceptTools = ReturnType<typeof conceptTools>

function conceptTools(
  o: StageOptions & { state: DomainState },
  opts: { merge?: boolean } = {}
) {
  const c = createCuratorTools({
    state: o.state,
    views: NO_VIEWS,
    sources: memorySourceReader(
      Object.fromEntries(o.sources.map((s) => [s.id, s.segments]))
    ),
    newId: o.newId,
  })
  const pick = c.tools
  const tools: LoopTools = {
    concept_create: pick.concept_create,
    concept_update: pick.concept_update,
    relationship_add: pick.relationship_add,
    relationship_remove: pick.relationship_remove,
    attribute_define: pick.attribute_define,
    search_existing: pick.search_existing,
    source_read: pick.source_read,
  } as unknown as LoopTools
  if (opts.merge) tools.concept_merge = mergeTool(c.stage) as never
  return { ...c, tools }
}

/**
 * Asks the agent to fix Expedition-wide problems (a Relationship to a missing
 * Concept) until the set commits cleanly. Returns a note when problems remain.
 */
async function fixUntilClean(
  o: StageOptions,
  t: ConceptTools,
  history: ModelMessage[],
  prefix: string
): Promise<string | null> {
  for (let round = 0; ; round++) {
    const problems = expeditionProblems(t.stage.state)
    if (!problems.length) return null
    if (round >= FIX_ROUNDS)
      throw new Error(
        `The Concept set still has problems: ${problems.map((p) => p.message).join("; ")}`
      )
    const r = await runLoop(
      {
        model: o.model,
        instructions: conceptInstructions(),
        prefix,
        task: `These problems block the commit; fix them, then reply with no tool calls:\n${problems.map((p) => `- ${p.message}`).join("\n")}`,
        tools: t.tools,
        maxSteps: 10,
        abortSignal: o.abortSignal,
      },
      history
    )
    history = r.messages
  }
}

function expeditionProblems(state: DomainState): Finding[] {
  return liveRelationships(state)
    .filter((r) => !isLive(state.concepts[r.from]) || !isLive(state.concepts[r.to]))
    .map((r) => ({
      severity: "problem" as const,
      code: "dangling-relationship",
      message: `Relationship ${r.from} -${r.type}-> ${r.to} points at a missing Concept`,
    }))
}

/** `concept_merge` (merge pass only): the domain's merge command as a tool. */
function mergeTool(stage: StagingArea): CuratorTool<{ survivor: string; merged: string }, unknown> {
  const input = z.strictObject({ survivor: z.string().min(1), merged: z.string().min(1) })
  return {
    description:
      "Merge two Concepts that are the same idea: `merged` is folded into `survivor`, which gains its title as an alias, its Tags and provenance, and every Relationship. Move a richer summary over first with concept_update.",
    inputSchema: input,
    execute: async (raw) => {
      const p = input.safeParse(raw)
      if (!p.success) return { ok: false, error: p.error.issues.map((i) => i.message).join("; ") }
      try {
        const bodies = mergeConcepts(stage.state, p.data.survivor, p.data.merged)
        const r = stage.stage(bodies)
        return r.ok ? { ok: true, id: p.data.survivor } : r
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}

/**
 * The deterministic merge (spec §5.2: "matching on normalized titles and
 * aliases"): Concepts of one Kind whose normalized title equals another's
 * title or alias are merged into the one with the most Relationships.
 */
export function autoMerge(state: DomainState): OpBody[] {
  const stage = new StagingArea(state)
  const out: OpBody[] = []
  for (;;) {
    const pair = firstExactPair(stage.state)
    if (!pair) return out
    const bodies = mergeConcepts(stage.state, pair[0], pair[1])
    const r = stage.stage(bodies)
    if (!r.ok) return out
    out.push(...bodies)
  }
}

function firstExactPair(state: DomainState): [string, string] | null {
  const degree = new Map<string, number>()
  for (const r of liveRelationships(state)) {
    degree.set(r.from, (degree.get(r.from) ?? 0) + 1)
    degree.set(r.to, (degree.get(r.to) ?? 0) + 1)
  }
  const byKey = new Map<string, string>()
  for (const c of liveConcepts(state)) {
    for (const name of [c.title, ...c.aliases]) {
      const key = `${c.kind}|${normalizeTitle(name)}`
      const other = byKey.get(key)
      if (other && other !== c.id) {
        const [a, b] = [other, c.id]
        return (degree.get(a) ?? 0) >= (degree.get(b) ?? 0) ? [a, b] : [b, a]
      }
      if (!other) byKey.set(key, c.id)
    }
  }
  return null
}

/**
 * Groups of Concepts that may be the same idea: overlapping normalized names
 * (one contains the other) or titles within a small edit distance.
 */
export function duplicateCandidates(
  state: DomainState,
  limit = 40
): { id: string; title: string }[][] {
  const cs = liveConcepts(state).map((c) => ({
    id: c.id,
    title: c.title,
    names: [c.title, ...c.aliases].map(normalizeTitle).filter((n) => n.length > 2),
  }))
  const groups: { id: string; title: string }[][] = []
  for (let i = 0; i < cs.length && groups.length < limit; i++)
    for (let j = i + 1; j < cs.length && groups.length < limit; j++) {
      const a = cs[i]!
      const b = cs[j]!
      const close = a.names.some((x) =>
        b.names.some(
          (y) =>
            (x.length > 4 && y.length > 4 && (x.includes(y) || y.includes(x))) ||
            (Math.min(x.length, y.length) > 5 && editDistance(x, y) <= 2)
        )
      )
      if (close) groups.push([{ id: a.id, title: a.title }, { id: b.id, title: b.title }])
    }
  return groups
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    prev = cur
  }
  return prev[b.length]!
}

// --- one View ------------------------------------------------------------------

/** A View to build: already in the rail (queued), with its question. */
export type ViewPlan = {
  id: string
  viewType: ViewTypeId
  label: string
  question?: string
  /** Why it was chosen (from the skim). */
  why?: string
}

export type ViewStageResult =
  | {
      status: "ready"
      /** The op bodies of its Change, with the View marked ready. */
      bodies: OpBody[]
      label: string
      /** The agent's self-review, kept in the job. */
      review: string
      warnings: string[]
      steps: number
      toolCalls: number
    }
  | { status: "failed"; reason: string; steps: number; toolCalls: number }

/**
 * Builds one View through the tools: the agent fills what the View needs,
 * builds it, inspects it, reviews it against its question and commits it
 * (`view_commit`, refused while `view_inspect` finds problems), or fails it
 * with a plain reason (`view_fail`). Nothing is written: the committed op
 * bodies come back for the job to commit as the View's own Change.
 */
export async function buildView(
  o: StageOptions & {
    state: DomainState
    note: string
    view: ViewPlan
    views: ViewReader
    /** Whole Sources in context (else their index; the agent reads with source_read). */
    whole: boolean
  }
): Promise<ViewStageResult> {
  const { view } = o
  if (!isLive(o.state.views[view.id]))
    return { status: "failed", reason: "The View was removed before it was built.", steps: 0, toolCalls: 0 }

  let committed: { bodies: OpBody[]; review: string; label: string } | null = null
  let failed: string | null = null
  let built = false
  const reviews: string[] = []

  const c = createCuratorTools({
    state: o.state,
    views: o.views,
    sources: memorySourceReader(
      Object.fromEntries(o.sources.map((s) => [s.id, s.segments]))
    ),
    newId: o.newId,
  })
  const base = c.tools

  const viewBuild: CuratorTool<never, unknown> = {
    description: base.view_build.description.replace(
      "Create a View, or with viewId change one",
      `Build this View (${view.id})`
    ),
    // This View's type only: an object schema (providers want `type: object`
    // at the top, which the all-types union isn't), and nothing else to pick.
    inputSchema: z.object({
      viewType: z.literal(view.viewType),
      label: z.string().min(1),
      question: z.string().optional(),
      settings: VIEW_TYPES[view.viewType].shared,
    }) as never,
    execute: async (input: unknown) => {
      const r = await base.view_build.execute({ ...(input as object), viewId: view.id } as never)
      if ((r as { ok?: boolean }).ok) built = true
      return r
    },
  }

  const commitInput = z.strictObject({
    review: z
      .string()
      .min(20)
      .describe(
        "Your self-review: how the View, as view_inspect reads it, answers its question, and what is still weak."
      ),
    label: z.string().min(1).optional().describe("The Change label; default “Built <View label>”."),
  })
  const viewCommit: CuratorTool<never, unknown> = {
    description:
      "Commit this View, with everything staged for it, as its own Change. Only after view_inspect shows no problems and you have reviewed the reading against the View's question. Refused while problems remain; the reply lists them.",
    inputSchema: commitInput as never,
    execute: async (raw: unknown) => {
      const p = commitInput.safeParse(raw)
      if (!p.success)
        return { ok: false, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }
      if (!built)
        return { ok: false, error: "Build the View first (view_build), then inspect it and review it." }
      reviews.push(p.data.review)
      const label = p.data.label ?? `Built ${c.stage.state.views[view.id]?.label ?? view.label}`
      const r = await c.commit({ label, views: [view.id] })
      if (!r.ok) return r
      committed = { bodies: r.bodies, review: p.data.review, label: r.label }
      return { ok: true, committed: view.id }
    },
  }

  const failInput = z.strictObject({
    reason: z
      .string()
      .min(10)
      .max(280)
      .describe("A plain reason a reader will understand, e.g. “Only one estimate per trend, so there's nothing to compare.”"),
  })
  const viewFail: CuratorTool<never, unknown> = {
    description:
      "Fail this View when the Sources can't support it, instead of padding it with guesses. Ends the build of this View; nothing staged for it is kept.",
    inputSchema: failInput as never,
    execute: async (raw: unknown) => {
      const p = failInput.safeParse(raw)
      if (!p.success) return { ok: false, error: p.error.issues.map((i) => i.message).join("; ") }
      failed = p.data.reason
      return { ok: true }
    },
  }

  const tools: LoopTools = {
    concept_create: base.concept_create,
    concept_update: base.concept_update,
    relationship_add: base.relationship_add,
    relationship_remove: base.relationship_remove,
    attribute_define: base.attribute_define,
    search_existing: base.search_existing,
    source_read: base.source_read,
    view_build: viewBuild,
    view_inspect: base.view_inspect,
    view_commit: viewCommit,
    view_fail: viewFail,
  } as unknown as LoopTools

  const prefix = o.whole ? renderSources(o.sources) : renderSourceIndex(o.sources)
  const current = o.state.views[view.id]!
  const task = [
    `## Your understanding note\n\n${o.note}`,
    `## The Concept set\n\n${describeConcepts(o.state)}`,
    `## The View to build\n\n- id: ${view.id}\n- View Type: ${view.viewType}\n- label: ${current.label}\n- question: ${view.question ?? current.question ?? "(sharpen one from the label)"}${view.why ? `\n- why it was chosen: ${view.why}` : ""}`,
    `## The View Type's definition\n\n${viewTypeDoc(view.viewType)}`,
    `Build it following the playbook: fill what it needs, view_build, view_inspect, fix, review against the question, then view_commit, or view_fail with a plain reason.${o.whole ? "" : " The Sources are shown as an index: read segments with source_read."}`,
  ].join("\n\n")

  let steps = 0
  let toolCalls = 0
  let history: ModelMessage[] | undefined
  for (let round = 0; round <= FIX_ROUNDS; round++) {
    const r = await runLoop(
      {
        model: o.model,
        instructions: viewInstructions(),
        prefix,
        task: history
          ? "You stopped without committing or failing the View. Finish it: fix what view_inspect reports, then view_commit with your review, or view_fail with a plain reason."
          : task,
        tools,
        maxSteps: MAX_STEPS.view,
        done: () => committed !== null || failed !== null,
        onStep: () => o.onStep?.({ state: c.stage.state, staged: c.stage.staged }),
        abortSignal: o.abortSignal,
      },
      history
    )
    steps += r.steps
    toolCalls += r.toolCalls
    history = r.messages
    if (committed || failed) break
  }

  if (failed) return { status: "failed", reason: failed, steps, toolCalls }
  if (!committed) {
    const inspection = await c.inspect(view.id).catch(() => null)
    const why = inspection?.problems.length
      ? `its checks still fail (${inspection.problems.map((p) => p.message).join("; ").slice(0, 200)})`
      : "the curator didn't finish it"
    return { status: "failed", reason: `This View couldn't be built: ${why}.`, steps, toolCalls }
  }
  const done = committed as { bodies: OpBody[]; review: string; label: string }
  const inspection = await inspectCommitted(o, done.bodies, view.id)
  return {
    status: "ready",
    bodies: done.bodies,
    label: done.label,
    review: done.review,
    warnings: inspection,
    steps,
    toolCalls,
  }
}

/** The warnings left on a committed View (they don't block). */
async function inspectCommitted(
  o: { state: DomainState; views: ViewReader },
  bodies: OpBody[],
  viewId: string
): Promise<string[]> {
  const s = new StagingArea(o.state)
  if (!s.stage(bodies).ok) return []
  const i = await inspectView(s.state, viewId, { views: o.views })
  return i.warnings.map((w) => w.message)
}

// --- helpers the job uses -----------------------------------------------------

/**
 * Minimal valid settings for a View that is queued but not built yet (the
 * domain validates settings on create). The curator replaces them.
 */
export function placeholderSettings(viewType: ViewTypeId): Record<string, unknown> {
  const s: Record<ViewTypeId, Record<string, unknown>> = {
    "comparison-table": { rows: {}, columns: [] },
    outline: { relationshipTypes: ["builtin:part-of"], rootTag: "topic" },
    evidence: { supports: ["builtin:supports"], challenges: ["builtin:challenges"], claimKinds: ["builtin:claim"] },
    "cause-and-effect": { mode: "mechanism", positive: [], negative: [], outcomes: [], levers: {} },
    map: {},
    timeline: { lanes: [] },
    anatomy: { roots: [], containment: ["builtin:part-of"], pins: [] },
    "learning-path": { relationshipTypes: ["builtin:prerequisite"] },
    lineage: { relationshipTypes: ["builtin:led-to"] },
    quadrant: { x: "x", y: "y" },
    rates: { group: "group", low: "low", high: "high", direction: "direction" },
  }
  const out = s[viewType]
  VIEW_TYPES[viewType].shared.parse(out)
  return out
}

/** Applies op bodies to a state (validated, all or nothing). */
export function applyBodies(state: DomainState, bodies: readonly OpBody[]): DomainState {
  const s = new StagingArea(state, { nextOpId: () => ulid(Date.now()) })
  const r = s.stage(bodies)
  if (!r.ok) throw new Error(r.error)
  return s.state
}

/**
 * The Concept set as the agent reads it: one line per Concept (id, title,
 * Kind, Tags, aliases, key Attributes, summary), then the Relationships.
 */
export function describeConcepts(state: DomainState): string {
  const cs = liveConcepts(state)
  if (!cs.length) return "(no Concepts yet)"
  const short = (id: string) => id.replace(/^builtin:/, "")
  const lines = cs.map((c) => {
    const parts = [
      `${c.id} | ${c.title} | ${short(c.kind)}`,
      c.tags.length ? `#${c.tags.join(" #")}` : "",
      c.aliases.length ? `aka ${c.aliases.join("; ")}` : "",
      c.weightPin ? `weight ${c.weightPin}` : "",
      c.date ? `date ${c.date}${c.dateEnd ? `–${c.dateEnd}` : ""}` : "",
      Object.keys(c.attributes).length
        ? Object.entries(c.attributes).map(([k, v]) => `${k}=${String(v)}`).join(", ")
        : "",
      c.summary ?? "",
    ].filter(Boolean)
    return parts.join(" | ")
  })
  const rels = liveRelationships(state).map(
    (r) => `${r.from} -${short(r.type)}-> ${r.to}${r.note ? ` (${r.note})` : ""}`
  )
  const attrs = Object.values(state.attributes)
    .filter(isLive)
    .map((a) => `${a.id}: ${a.label} (${a.type}${a.unit ? `, ${a.unit}` : ""}${a.enumValues ? `: ${a.enumValues.join(" < ")}` : ""})`)
  return [
    `Concepts (${cs.length}): id | title | Kind | Tags | aliases | … | summary`,
    ...lines,
    "",
    `Relationships (${rels.length}):`,
    ...rels,
    ...(attrs.length ? ["", `Attributes (${attrs.length}):`, ...attrs] : []),
  ].join("\n")
}

/**
 * Preview nodes for a View while it builds (spec §3.5): the Concepts its
 * staged ops touch and the ones its settings name, in that order.
 */
export function previewNodes(
  state: DomainState,
  staged: readonly OpBody[],
  limit = 24
): PreviewNode[] {
  const ids: string[] = []
  const add = (id: unknown) => {
    if (typeof id === "string" && isLive(state.concepts[id]) && !ids.includes(id)) ids.push(id)
  }
  for (const b of staged) {
    if (b.kind.startsWith("concept.")) add(b.target)
    if (b.kind === "relationship.add") {
      const [from, , to] = b.target.split("|")
      add(from)
      add(to)
    }
  }
  return ids.slice(0, limit).map((id) => {
    const c = state.concepts[id]!
    return { id, title: c.title, kind: c.kind }
  })
}

/** Concepts in a state (live), for the running counter. */
export const conceptCount = (state: DomainState) => liveConcepts(state).length

/** A ViewReader for stages that never read a View (the Concept set). */
const NO_VIEWS: ViewReader = {
  read: async () => {
    throw new Error("no Views are read while building the Concept set")
  },
}
