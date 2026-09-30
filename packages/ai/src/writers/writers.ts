// The writers (spec §5.2 step 4, WP-3.6): a summary and an overview for every
// Concept, then an article in ordered sections for each core Concept, each
// with provenance that resolves to a real segment.
//
// Like the curator's stages, each function here is a plain async function
// over a DomainState: it returns op bodies (`concept.set`, `section.create`)
// and never writes. `@seply/server` runs each batch in its own durable step
// and commits it as a Change; the "Write the article" action puts the same
// bodies in a Proposal instead.
import {
  BUILTIN_REL_TYPE_BY_ID,
  findSegments,
  isLive,
  keysAfter,
  ulid,
  type Concept,
  type DomainState,
  type OpBody,
  type Prov,
  type ProvRef,
  type SegmentsDoc,
} from "@seply/domain"
import { generateText, Output, type LanguageModel } from "ai"
import { z } from "zod"
import { liveConcepts, liveRelationships } from "../checks/common.ts"
import { playbook } from "../curator/playbook.ts"
import { renderSources, type CuratorSource } from "../curator/sources.ts"

/** Concepts per writer call (spec §5.2: batches of about 10; articles are longer). */
export const WRITER_BATCH = { overviews: 10, articles: 3 } as const

/**
 * Without pinned core Concepts, the most connected share of them is core
 * (the estimate's `coreShare`), at least `min` and at most `max`.
 */
export const CORE_FALLBACK = { share: 0.15, min: 3, max: 20 } as const

/** Output budget per call. */
const MAX_OUTPUT = { overviews: 8_000, articles: 12_000 } as const

export type WriterMode = "overviews" | "articles"

/** Which Concepts the writers still owe, in batches. */
export type WriterPlan = {
  /** Concepts without an overview, core first. */
  overviews: string[][]
  /** Core Concepts without an article. */
  articles: string[][]
}

// --- planning ---------------------------------------------------------------

/**
 * The core Concepts (spec §5.2: they get articles in the first build). The
 * curator pins them (`weightPin: "core"`, 10–20% of the set); when it pinned
 * none, the most connected Concepts stand in. Never an `aux` one.
 */
export function coreConcepts(state: DomainState): string[] {
  const concepts = liveConcepts(state)
  const pinned = concepts.filter((c) => c.weightPin === "core").map((c) => c.id)
  if (pinned.length) return pinned
  const deg = degrees(state)
  const n = Math.min(
    CORE_FALLBACK.max,
    Math.max(CORE_FALLBACK.min, Math.round(concepts.length * CORE_FALLBACK.share))
  )
  return concepts
    .filter((c) => c.weightPin !== "aux")
    .sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((c) => c.id)
}

const hasArticle = (state: DomainState, id: string) =>
  Object.values(state.sections).some((s) => isLive(s) && s.conceptId === id)

/**
 * What is left to write, in batches: every Concept without an overview (core
 * first, then the most connected, so reading can start where it matters),
 * then every core Concept without an article. A Retry plans again from the
 * logged state, so nothing written is written twice.
 */
export function planWriters(
  state: DomainState,
  size: { overviews?: number; articles?: number } = {}
): WriterPlan {
  const core = coreConcepts(state)
  const coreSet = new Set(core)
  const deg = degrees(state)
  const owed = liveConcepts(state)
    .filter((c) => !c.overview?.trim())
    .sort(
      (a, b) =>
        Number(coreSet.has(b.id)) - Number(coreSet.has(a.id)) ||
        (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) ||
        a.id.localeCompare(b.id)
    )
    .map((c) => c.id)
  return {
    overviews: chunk(owed, size.overviews ?? WRITER_BATCH.overviews),
    articles: chunk(
      core.filter((id) => !hasArticle(state, id)),
      size.articles ?? WRITER_BATCH.articles
    ),
  }
}

// --- writing ----------------------------------------------------------------

const ProvOut = z.object({
  source: z.string().describe("The Source id, exactly as in <source id=…>"),
  segment: z.string().describe("A segment id shown in that Source: t14, s3, p2, t3a"),
  quote: z.string().optional().describe("≤ 20 words, copied from that segment"),
})

/** What the model answers for overviews (Output.object; the root must be an object). */
export const OverviewOutput = z.object({
  concepts: z.array(
    z.object({
      id: z.string(),
      summary: z
        .string()
        .optional()
        .describe("Only for Concepts marked `summary: (none)`: one line, ≤ 20 words"),
      overview: z.string(),
      overviewProv: z.array(ProvOut),
    })
  ),
})
export type OverviewOutput = z.infer<typeof OverviewOutput>

export const ArticleOutput = z.object({
  concepts: z.array(
    z.object({
      id: z.string(),
      article: z.array(
        z.object({
          heading: z.string(),
          md: z.string(),
          prov: z.array(ProvOut),
        })
      ),
    })
  ),
})
export type ArticleOutput = z.infer<typeof ArticleOutput>

export type WriteOptions = {
  model: LanguageModel
  state: DomainState
  sources: readonly CuratorSource[]
  /** The batch: Concept ids. */
  ids: readonly string[]
  /**
   * Whether the whole Sources fit in context (the build's source plan). If
   * not, the writer reads only the segments its batch and their neighbours cite.
   */
  whole?: boolean
  /** The understanding note, when the build has one. */
  note?: string
  goals?: readonly string[]
  /** Mints section ids (ULIDs by default). */
  newId?: () => string
  abortSignal?: AbortSignal
}

/** What a batch wrote, for the commit and for review. */
export type WriteResult = {
  bodies: OpBody[]
  /** Concepts written. */
  written: string[]
  /** Concepts of the batch the model left out (a Retry writes them). */
  missing: string[]
  /** Provenance refs changed to resolve, or dropped, with why. */
  repairs: ProvRepair[]
  /** In-text links to Concepts that don't exist, unlinked. */
  unlinked: number
}

export type ProvRepair = {
  concept: string
  where: string
  ref: { source: string; segment: string }
  action: "moved" | "dropped" | "quote-dropped" | "fallback"
}

/** A summary and an overview for each Concept of the batch. */
export async function writeOverviews(o: WriteOptions): Promise<WriteResult> {
  const out = await ask(o, "overviews", OverviewOutput)
  const fix = fixer(o)
  const bodies: OpBody[] = []
  const written: string[] = []
  for (const w of out.concepts) {
    const c = batchConcept(o, w.id, written)
    if (!c) continue
    const overview = fix.links(w.overview)
    if (!overview) continue
    written.push(c.id)
    if (!c.summary?.trim() && w.summary?.trim())
      bodies.push({ kind: "concept.set", target: c.id, path: "summary", value: w.summary.trim() })
    bodies.push({ kind: "concept.set", target: c.id, path: "overview", value: overview })
    bodies.push({
      kind: "concept.set",
      target: c.id,
      path: "overviewProv",
      value: fix.prov(c, "overview", w.overviewProv),
    })
  }
  return result(o, bodies, written, fix)
}

/** An article in ordered sections for each Concept of the batch. */
export async function writeArticles(o: WriteOptions): Promise<WriteResult> {
  const out = await ask(o, "articles", ArticleOutput)
  const fix = fixer(o)
  const newId = o.newId ?? (() => ulid(Date.now()))
  const bodies: OpBody[] = []
  const written: string[] = []
  for (const w of out.concepts) {
    const c = batchConcept(o, w.id, written)
    if (!c || hasArticle(o.state, c.id)) continue
    const sections = w.article
      .map((s) => ({ ...s, heading: s.heading.trim(), md: fix.links(s.md) }))
      .filter((s) => s.md)
    if (!sections.length) continue
    written.push(c.id)
    const keys = keysAfter(null, sections.length)
    sections.forEach((s, i) =>
      bodies.push({
        kind: "section.create",
        target: newId(),
        value: {
          conceptId: c.id,
          orderKey: keys[i]!,
          heading: s.heading,
          md: s.md,
          prov: fix.prov(c, s.heading ? `section “${s.heading}”` : "introduction", s.prov),
        },
      })
    )
  }
  return result(o, bodies, written, fix)
}

/**
 * One batch: overviews or articles, then one more call for any Concept the
 * model left out of its answer (long batches sometimes stop short).
 */
export async function writeBatch(mode: WriterMode, o: WriteOptions): Promise<WriteResult> {
  const write = mode === "overviews" ? writeOverviews : writeArticles
  const first = await write(o)
  if (!first.missing.length || !first.written.length) return first
  const again = await write({ ...o, ids: first.missing })
  return {
    bodies: [...first.bodies, ...again.bodies],
    written: [...first.written, ...again.written],
    missing: again.missing,
    repairs: [...first.repairs, ...again.repairs],
    unlinked: first.unlinked + again.unlinked,
  }
}

/** "Wrote overviews for Alder C5, Hub motor and 8 more" */
export function writerLabel(state: DomainState, mode: WriterMode, ids: readonly string[]): string {
  const titles = ids.map((id) => state.concepts[id]?.title ?? id)
  const what = mode === "overviews" ? "overviews" : ids.length === 1 ? "the article" : "articles"
  if (!titles.length) return `Wrote ${what}`
  const named =
    titles.length <= 3
      ? listOf(titles)
      : `${titles.slice(0, 2).join(", ")} and ${titles.length - 2} more`
  return `Wrote ${what} for ${named}`
}

/**
 * Checks every provenance ref in op bodies against the Sources: each must
 * name a Source the writer read and a segment `findSegments` finds there.
 * Returns the refs that don't resolve (empty when all do).
 */
export function unresolvedProv(
  bodies: readonly OpBody[],
  sources: readonly CuratorSource[]
): { target: string; ref: ProvRef }[] {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const bad: { target: string; ref: ProvRef }[] = []
  const check = (target: string, prov: unknown) => {
    for (const ref of (prov as Prov | undefined) ?? []) {
      const src = byId.get(ref.source)
      if (!src || !segmentsIn(src, ref.segment).length) bad.push({ target, ref })
    }
  }
  for (const b of bodies) {
    if (b.kind === "concept.set" && (b.path === "overviewProv" || b.path === "prov"))
      check(b.target, b.value)
    if (b.kind === "section.create") check(b.target, b.value.prov)
  }
  return bad
}

// --- the call ---------------------------------------------------------------

/** The writers' instructions: the contract, then write.md. */
export const writerInstructions = () =>
  [playbook("_contract"), playbook("write")].join("\n\n---\n\n")

async function ask<S extends z.ZodType>(
  o: WriteOptions,
  mode: WriterMode,
  schema: S
): Promise<z.infer<S>> {
  const concepts = o.ids.map((id) => o.state.concepts[id]).filter(isLive)
  if (!concepts.length) return { concepts: [] } as z.infer<S>
  const r = await generateText({
    model: o.model,
    system: writerInstructions(),
    messages: [
      {
        role: "user",
        content: [
          {
            // The same for every batch of a build: cached once, read after.
            type: "text",
            text: [
              expeditionHeader(o.state),
              conceptIndex(o.state),
              o.whole === false ? renderSources(o.sources, cited(o)) : renderSources(o.sources),
            ].join("\n\n"),
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          },
          { type: "text", text: task(o, mode, concepts) },
        ],
      },
    ],
    output: Output.object({ schema, name: mode }),
    maxOutputTokens: MAX_OUTPUT[mode],
    maxRetries: 2,
    ...(o.abortSignal && { abortSignal: o.abortSignal }),
  })
  return r.output as z.infer<S>
}

function expeditionHeader(state: DomainState): string {
  const e = state.expedition
  return [
    `<expedition title="${escapeAttr(e.title)}">`,
    e.summary || "(no summary yet)",
    `</expedition>`,
  ].join("\n")
}

/** Every Concept, one line each, so the writer can link to any of them. */
function conceptIndex(state: DomainState): string {
  const lines = liveConcepts(state)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `${c.id} | ${c.title} | ${short(c.kind)}`)
  return [`<concepts note="link as [text](#c/<id>)">`, ...lines, `</concepts>`].join("\n")
}

function task(o: WriteOptions, mode: WriterMode, concepts: Concept[]): string {
  const core = new Set(coreConcepts(o.state))
  const blocks = concepts.map((c) => conceptBlock(o.state, c, mode, core.has(c.id)))
  const context = [
    o.goals?.length ? `The reader's goals: ${o.goals.map((g) => (g === "learn" ? "learn it" : g)).join(", ")}.` : "",
    o.note ? `What the reader wanted, decided and left open (the curator's note):\n${o.note}` : "",
  ].filter(Boolean)
  const ask =
    mode === "overviews"
      ? `Write the **summary** (only where it says \`summary: (none)\`) and the **overview** with its \`overviewProv\` for each of these ${concepts.length} Concepts. Answer with \`{ "concepts": [ { "id", "summary"?, "overview", "overviewProv" } ] }\`, one entry per Concept, ids copied exactly.`
      : `Write the **article** for each of these ${concepts.length} Concepts: ordered sections, each with its own \`prov\`. Answer with \`{ "concepts": [ { "id", "article": [ { "heading", "md", "prov" } ] } ] }\`, one entry per Concept, ids copied exactly.`
  return [...context, ask, ...blocks].join("\n\n")
}

function conceptBlock(state: DomainState, c: Concept, mode: WriterMode, core: boolean): string {
  const lines = [
    `## ${c.title} (${c.id})`,
    `kind: ${short(c.kind)}${core ? " · core" : c.weightPin === "aux" ? " · auxiliary" : ""}`,
    c.aliases.length ? `aliases: ${c.aliases.join("; ")}` : "",
    `summary: ${c.summary?.trim() || "(none)"}`,
    ...Object.entries(c.attributes).map(
      ([k, v]) => `${state.attributes[k]?.label ?? k}: ${String(v)}${state.attributes[k]?.unit ? ` ${state.attributes[k]!.unit}` : ""}`
    ),
    c.date ? `date: ${c.date}${c.dateEnd ? ` – ${c.dateEnd}` : ""}` : "",
    `cited in: ${c.prov.length ? c.prov.map(refText).join("; ") : "(background knowledge)"}`,
    ...relationshipLines(state, c.id),
    mode === "articles" && c.overview ? `overview (already written):\n${c.overview}` : "",
  ]
  return lines.filter(Boolean).join("\n")
}

function relationshipLines(state: DomainState, id: string): string[] {
  const out: string[] = []
  for (const r of liveRelationships(state)) {
    if (r.from !== id && r.to !== id) continue
    const other = state.concepts[r.from === id ? r.to : r.from]
    if (!isLive(other)) continue
    const def = BUILTIN_REL_TYPE_BY_ID.get(r.type)
    const custom = state.relTypes[r.type]
    const phrase =
      r.from === id
        ? (custom?.label ?? def?.label ?? short(r.type))
        : (custom?.inverseLabel ?? def?.inverseLabel ?? `← ${short(r.type)}`)
    out.push(`- ${phrase} [${other!.title}](#c/${other!.id})${r.note ? ` (${r.note})` : ""}`)
  }
  return out.length ? ["relationships:", ...out.slice(0, 30)] : []
}

/** The segments a batch (and its neighbours) cite: what the writer reads when the Sources don't fit. */
function cited(o: WriteOptions): Map<string, Set<string>> {
  const ids = new Set(o.ids)
  for (const r of liveRelationships(o.state)) {
    if (o.ids.includes(r.from)) ids.add(r.to)
    if (o.ids.includes(r.to)) ids.add(r.from)
  }
  const out = new Map<string, Set<string>>()
  const add = (ref: ProvRef) => {
    const src = o.sources.find((s) => s.id === ref.source)
    if (!src) return
    const set = out.get(ref.source) ?? new Set<string>()
    for (const s of segmentsIn(src, ref.segment)) set.add(s.id)
    out.set(ref.source, set)
  }
  for (const id of ids) o.state.concepts[id]?.prov.forEach(add)
  return out
}

// --- checking what came back ---------------------------------------------------

/** One Concept of the batch, not seen before in this answer. */
function batchConcept(o: WriteOptions, id: string, seen: readonly string[]): Concept | null {
  const c = o.state.concepts[id.trim()]
  return c && isLive(c) && o.ids.includes(c.id) && !seen.includes(c.id) ? c : null
}

function result(
  o: WriteOptions,
  bodies: OpBody[],
  written: string[],
  fix: ReturnType<typeof fixer>
): WriteResult {
  return {
    bodies,
    written,
    missing: o.ids.filter((id) => isLive(o.state.concepts[id]) && !written.includes(id)),
    repairs: fix.repairs,
    unlinked: fix.unlinked(),
  }
}

/**
 * Makes the writer's output safe to commit.
 *
 * - **Provenance:** every ref must resolve (`findSegments`) in a Source the
 *   writer read. A ref with a wrong Source id but a segment id that exists in
 *   exactly one Source moves there; a ref whose quote is found in one segment
 *   moves to it; anything else is dropped. A quote not in its segment is
 *   dropped (the ref stays). If every ref was dropped, the Concept's own
 *   resolving refs stand in: the writer meant "from the Sources", and they
 *   are what it was shown for this Concept.
 * - **Links:** `#c/<id>` links to Concepts that don't exist become plain text.
 */
function fixer(o: WriteOptions) {
  const repairs: ProvRepair[] = []
  const byId = new Map(o.sources.map((s) => [s.id, s]))
  const resolves = (ref: { source: string; segment: string }) => {
    const src = byId.get(ref.source)
    return !!src && segmentsIn(src, ref.segment).length > 0
  }
  let unlinked = 0

  const one = (c: Concept, where: string, raw: z.infer<typeof ProvOut>): ProvRef | null => {
    const segment = raw.segment.trim().replace(/^\[|\]$/g, "")
    let ref: ProvRef = { source: raw.source.trim(), segment }
    const quote = raw.quote?.trim() && norm(raw.quote) ? raw.quote.trim() : undefined
    if (!resolves(ref)) {
      const bySegment = o.sources.filter((s) => segmentsIn(s, segment).length)
      const byQuote = quote
        ? o.sources.flatMap((s) =>
            s.segments.filter((g) => norm(g.text).includes(norm(quote))).map((g) => ({ source: s.id, segment: g.id }))
          )
        : []
      const moved =
        bySegment.length === 1
          ? { source: bySegment[0]!.id, segment }
          : byQuote.length === 1
            ? byQuote[0]!
            : null
      repairs.push({ concept: c.id, where, ref: { source: raw.source, segment: raw.segment }, action: moved ? "moved" : "dropped" })
      if (!moved) return null
      ref = moved
    }
    if (quote) {
      const texts = segmentsIn(byId.get(ref.source)!, ref.segment).map((s) => norm(s.text))
      if (texts.some((t) => t.includes(norm(quote)))) ref.quote = quote
      else repairs.push({ concept: c.id, where, ref, action: "quote-dropped" })
    }
    return ref
  }

  return {
    repairs,
    unlinked: () => unlinked,
    prov(c: Concept, where: string, raw: readonly z.infer<typeof ProvOut>[]): Prov {
      const out: ProvRef[] = []
      for (const r of raw) {
        const ref = one(c, where, r)
        if (ref && !out.some((x) => x.source === ref.source && x.segment === ref.segment)) out.push(ref)
      }
      if (out.length || !raw.length) return out
      const fallback = c.prov.filter(resolves).map((r) => ({ source: r.source, segment: r.segment }))
      if (fallback.length) repairs.push({ concept: c.id, where, ref: fallback[0]!, action: "fallback" })
      return fallback
    },
    links(md: string): string {
      return md.trim().replace(/\[([^\]]*)\]\(#c\/([^)\s]+)\)/g, (all, text: string, id: string) => {
        if (isLive(o.state.concepts[decodeURIComponent(id)])) return all
        unlinked++
        return text
      })
    },
  }
}

// --- helpers ------------------------------------------------------------------

/** A ref's segments in a Source (`findSegments`: the exact id, else all its parts). */
const segmentsIn = (src: CuratorSource, id: string) =>
  findSegments(src as unknown as Pick<SegmentsDoc, "segments">, id)

function degrees(state: DomainState): Map<string, number> {
  const deg = new Map<string, number>()
  for (const r of liveRelationships(state)) {
    deg.set(r.from, (deg.get(r.from) ?? 0) + 1)
    deg.set(r.to, (deg.get(r.to) ?? 0) + 1)
  }
  return deg
}

function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

const short = (id: string) => id.replace(/^builtin:/, "")
const refText = (r: ProvRef) => `${r.source} ${r.segment}${r.quote ? ` “${r.quote}”` : ""}`
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
const listOf = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`
