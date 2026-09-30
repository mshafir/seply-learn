// The skim (spec §5.2 step 2): a fast model reads a sample of the Sources and
// proposes 4–8 Views, ranked, and names the Expedition. It runs when the
// reader clicks Next on the Sources screen, and again for "Suggest more Views"
// and "Ask for a specific View" on Choose Views. Its prompt is
// playbook/skim.md; its catalog comes from docs/view-types (both generated
// into src/playbook/generated.ts).
//
// Nothing here writes: the app saves the Views the reader chooses.
import type { LanguageModelV4 } from "@ai-sdk/provider"
import {
  VIEW_TYPE_IDS,
  type Segment,
  type SegmentsDoc,
  type SourceKind,
  type ViewTypeId,
} from "@seply/domain"
import { generateText, Output } from "ai"
import { z } from "zod"
import { SKIM_PROMPT, VIEW_TYPE_CATALOG } from "./playbook/generated.ts"
import type { CatalogEntry } from "./playbook/source.ts"
import { tokenUsage, type TokenUsage } from "./pricing.ts"

export { VIEW_TYPE_CATALOG, type CatalogEntry }

/** The goal chips on the Sources screen (spec §3.3). */
export const GOALS = ["learn", "decide", "plan"] as const
export const Goal = z.enum(GOALS)
export type Goal = z.infer<typeof Goal>
export const GOAL_LABELS: Record<Goal, string> = {
  learn: "learn it",
  decide: "decide",
  plan: "plan",
}

/** View Types the skim may propose: the catalog's (proven and experimental). */
export const SKIM_VIEW_TYPES = VIEW_TYPE_CATALOG.map((e) => e.id).filter(
  (id): id is ViewTypeId => (VIEW_TYPE_IDS as readonly string[]).includes(id)
)

/** How many Views each request returns. */
export const SKIM_COUNTS = {
  propose: { min: 4, max: 8, on: [3, 4] },
  more: { min: 2, max: 4, on: [0, 0] },
  ask: { min: 1, max: 1, on: [1, 1] },
} as const

/** What the skim is asked for. `existing`: Views already proposed, not to repeat. */
export type SkimRequest =
  | { mode: "propose" }
  | { mode: "more"; existing: readonly ExistingView[] }
  | { mode: "ask"; request: string; existing: readonly ExistingView[] }
export type ExistingView = { viewType: string; question: string }

/** One Source, as the skim reads it. */
export type SkimSource = {
  id: string
  title: string
  kind: SourceKind
  segments: SegmentsDoc
}

// ─── The sample ────────────────────────────────────────────────────────────

/** Sample limits: segments kept at each end, characters per segment, total. */
export const SKIM_SAMPLE = {
  /** The first and last few segments of each Source. */
  edge: 3,
  /** A reader's turn (their questions count most). */
  readerChars: 1200,
  /** Any other kept segment. */
  otherChars: 600,
  /** A document section in the middle: its heading and this much text. */
  headingChars: 160,
  /** The whole sample; limits shrink until it fits. */
  budgetChars: 48_000,
  /** The least a kept segment is cut to. */
  floorChars: 80,
} as const

type Item = { seg: Segment; limit: "reader" | "other" | "heading" }

function pick(doc: SegmentsDoc, kind: SourceKind): Item[] {
  const segs = doc.segments
  const { edge } = SKIM_SAMPLE
  const out: Item[] = []
  segs.forEach((seg, i) => {
    const atEdge = i < edge || i >= segs.length - edge
    if (kind === "prompt") out.push({ seg, limit: "reader" })
    else if (seg.speaker === "user") out.push({ seg, limit: "reader" })
    else if (atEdge) out.push({ seg, limit: "other" })
    else if (doc.kind === "document" && seg.heading)
      out.push({ seg, limit: "heading" })
  })
  return out
}

function cut(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

function attr(s: string): string {
  return s.replace(/[\n\r"]/g, " ").trim()
}

function render(
  sources: readonly SkimSource[],
  picks: Item[][],
  scale: number
): string {
  const limit = (l: Item["limit"]) =>
    Math.max(
      SKIM_SAMPLE.floorChars,
      Math.round(
        scale *
          (l === "reader"
            ? SKIM_SAMPLE.readerChars
            : l === "other"
              ? SKIM_SAMPLE.otherChars
              : SKIM_SAMPLE.headingChars)
      )
    )
  return sources
    .map((src, k) => {
      const items = picks[k]!
      const lines: string[] = []
      let last = -1
      const index = new Map(src.segments.segments.map((s, i) => [s, i]))
      for (const { seg, limit: l } of items) {
        const i = index.get(seg)!
        if (i > last + 1) lines.push(`[… ${i - last - 1} segments not shown …]`)
        last = i
        const who = seg.speaker === "user" ? " reader" : seg.speaker ? " assistant" : ""
        const head = seg.heading ? ` ## ${cut(seg.heading, 120)}` : ""
        lines.push(`[${seg.id}${who}]${head} ${cut(seg.text, limit(l))}`)
      }
      const total = src.segments.segments.length
      if (last < total - 1) lines.push(`[… ${total - last - 1} segments not shown …]`)
      return [
        `<source id="${attr(src.id)}" title="${attr(src.title)}" kind="${src.kind === "prompt" ? "prompt" : src.segments.kind}" segments="${total}">`,
        ...lines,
        "</source>",
      ].join("\n")
    })
    .join("\n\n")
}

/**
 * The sample the skim reads (spec §5.2): the first and last few segments of
 * each Source, every reader turn of a chat, and the headings of documents
 * (with a little text), in order, labelled with Source and segment ids. The
 * per-segment limits shrink until the whole fits `SKIM_SAMPLE.budgetChars`.
 */
export function skimSample(sources: readonly SkimSource[]): {
  text: string
  segments: number
} {
  const picks = sources.map((s) => pick(s.segments, s.kind))
  let scale = 1
  let text = render(sources, picks, scale)
  while (text.length > SKIM_SAMPLE.budgetChars && scale > 0.05) {
    scale *= 0.8
    text = render(sources, picks, scale)
  }
  // Still over (thousands of turns): keep an even spread of each Source's picks.
  while (text.length > SKIM_SAMPLE.budgetChars) {
    const k = picks.reduce((m, p, i) => (p.length > picks[m]!.length ? i : m), 0)
    const p = picks[k]!
    if (p.length <= 2 * SKIM_SAMPLE.edge) break
    picks[k] = p.filter((_, i) => i < SKIM_SAMPLE.edge || i >= p.length - SKIM_SAMPLE.edge || i % 2 === 0)
    text = render(sources, picks, scale)
  }
  return { text, segments: picks.reduce((n, p) => n + p.length, 0) }
}

// ─── The prompt ────────────────────────────────────────────────────────────

function catalogText(catalog: readonly CatalogEntry[]): string {
  return catalog
    .map((e) =>
      [
        `### ${e.id}: ${e.name} (${e.status})`,
        `Answers: "${e.answers}"`,
        "",
        "Draws on:",
        e.drawsOn,
        "",
        "Building it from a source:",
        e.fromSource,
      ].join("\n")
    )
    .join("\n\n")
}

/** The system prompt: the playbook's skim.md, then the catalog. Stable, so providers can cache it. */
export function skimSystem(catalog: readonly CatalogEntry[] = VIEW_TYPE_CATALOG): string {
  return `${SKIM_PROMPT}\n\n# The View Type catalog\n\n${catalogText(catalog)}`
}

function taskText(req: SkimRequest): string {
  const existing =
    req.mode === "propose" || req.existing.length === 0
      ? []
      : [
          "",
          "Views already proposed (don't repeat them):",
          ...req.existing.map((v) => `- ${v.viewType}: "${v.question}"`),
        ]
  switch (req.mode) {
    case "propose":
      return "Propose: 4–8 Views, ranked, 3–4 of them on, and name the Expedition."
    case "more":
      return [
        "Suggest more: 2–4 more Views, answering questions the Views below don't. All off. Name the Expedition as before.",
        ...existing,
      ].join("\n")
    case "ask":
      return [
        "A specific request: exactly 1 View answering the reader's request below, on. Name the Expedition as before.",
        "",
        `The reader asked for: "${req.request.replace(/\s+/g, " ").trim()}"`,
        ...existing,
      ].join("\n")
  }
}

/** The user message: the task, the goals and the sample. */
export function skimPrompt(args: {
  sample: string
  goals?: readonly Goal[]
  request?: SkimRequest
}): string {
  const goals = args.goals?.length
    ? args.goals.map((g) => GOAL_LABELS[g]).join(", ")
    : "none picked"
  return [
    "# Task",
    taskText(args.request ?? { mode: "propose" }),
    "",
    "# The reader's goals",
    goals,
    "",
    "# The sample",
    args.sample,
  ].join("\n")
}

// ─── The answer ────────────────────────────────────────────────────────────

/** What the model must return (loose; `normalizeSkim` settles counts and ids). */
export const SkimOutput = z.object({
  title: z.string(),
  summary: z.string(),
  views: z.array(
    z.object({
      id: z.string(),
      // A string, not an enum: one View Type outside the catalog shouldn't
      // fail the whole answer. normalizeSkim drops it.
      viewType: z.string().describe(`One of: ${SKIM_VIEW_TYPES.join(", ")}`),
      label: z.string(),
      question: z.string(),
      why: z.string(),
      on: z.boolean(),
      confidence: z.enum(["high", "medium"]),
    })
  ),
})
export type SkimOutput = z.infer<typeof SkimOutput>

/** A proposed View, as Choose Views shows it. */
export const ProposedView = z.strictObject({
  /** `v-` plus a kebab name, unique in one answer. Not a View id: saving mints those. */
  id: z.string().regex(/^v-[a-z0-9]+(-[a-z0-9]+)*$/),
  viewType: z.enum(VIEW_TYPE_IDS),
  label: z.string().min(1).max(60),
  question: z.string().min(1),
  why: z.string(),
  on: z.boolean(),
  confidence: z.enum(["high", "medium"]),
})
export type ProposedView = z.infer<typeof ProposedView>

export const SkimResult = z.strictObject({
  title: z.string().min(1),
  summary: z.string(),
  /** Ranked: the first is the proposed best View. */
  views: z.array(ProposedView),
})
export type SkimResult = z.infer<typeof SkimResult>

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/^v-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")

const sameQuestion = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
  b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

function words(s: string, max: number): string {
  const w = s.replace(/\s+/g, " ").trim().replace(/[.!?:;,]+$/, "").split(" ")
  return w.slice(0, max).join(" ")
}

/**
 * Settles the model's answer: View Types in the catalog only, `v-` kebab ids
 * made unique (also against `takenIds`), no repeats of `existing`, at most the
 * mode's count, and the mode's number of Views on (the first ones, by rank,
 * when the model chose too few or too many). Titles are cut to 6 words.
 */
export function normalizeSkim(
  raw: SkimOutput,
  request: SkimRequest = { mode: "propose" },
  takenIds: Iterable<string> = []
): SkimResult {
  const counts = SKIM_COUNTS[request.mode]
  const existing = request.mode === "propose" ? [] : request.existing
  const allowed = new Set<string>(SKIM_VIEW_TYPES)
  const isAllowed = (t: string): t is ViewTypeId => allowed.has(t)
  const taken = new Set(takenIds)
  const views: ProposedView[] = []
  for (const v of raw.views) {
    const viewType = v.viewType.trim()
    if (!isAllowed(viewType)) continue
    const question = v.question.replace(/\s+/g, " ").trim()
    if (!question) continue
    const dupe = [...existing, ...views].some(
      (e) => e.viewType === viewType && sameQuestion(e.question, question)
    )
    if (dupe) continue
    const base = kebab(v.id) || kebab(v.label) || viewType
    let id = `v-${base}`
    for (let n = 2; taken.has(id); n++) id = `v-${base}-${n}`
    taken.add(id)
    views.push({
      id,
      viewType,
      label: words(v.label, 6).slice(0, 60) || words(question, 4),
      question,
      why: v.why.replace(/\s+/g, " ").trim(),
      on: v.on,
      confidence: v.confidence,
    })
    if (views.length === counts.max) break
  }
  const [minOn, maxOn] = counts.on
  const on = views.filter((v) => v.on).length
  if (on < minOn || on > maxOn) {
    const want = Math.min(views.length, on < minOn ? minOn : maxOn)
    views.forEach((v, i) => (v.on = i < want))
  }
  return {
    title: words(raw.title, 6) || "Untitled Expedition",
    summary: raw.summary.replace(/\s+/g, " ").trim(),
    views,
  }
}

export type SkimRun = {
  result: SkimResult
  usage: TokenUsage
  /** Wall-clock time of the model call, in ms. */
  ms: number
  /** What the sample held. */
  sample: { segments: number; chars: number }
}

/**
 * Runs the skim on `model` (the setup's `skim` stage, metered: see
 * `modelFor`). Throws when the model fails or returns something unusable
 * (NoObjectGeneratedError), or `SpendingCapReached` from a metered model.
 */
export async function runSkim(args: {
  model: LanguageModelV4
  sources: readonly SkimSource[]
  goals?: readonly Goal[]
  request?: SkimRequest
  /** Ids already on the page, so new proposals don't reuse them. */
  takenIds?: Iterable<string>
  abortSignal?: AbortSignal
  now?: () => number
}): Promise<SkimRun> {
  const now = args.now ?? Date.now
  const request = args.request ?? { mode: "propose" }
  const sample = skimSample(args.sources)
  const started = now()
  const res = await generateText({
    model: args.model,
    system: skimSystem(),
    prompt: skimPrompt({ sample: sample.text, goals: args.goals, request }),
    output: Output.object({ schema: SkimOutput, name: "skim" }),
    maxOutputTokens: 3000,
    maxRetries: 1,
    abortSignal: args.abortSignal,
  })
  const ms = now() - started
  return {
    result: normalizeSkim(res.output, request, args.takenIds),
    usage: tokenUsage(res.usage),
    ms,
    sample: { segments: sample.segments, chars: sample.text.length },
  }
}
