// Grow (spec §5.5): the curator agent scoped to one ask. The same tools as a
// build, minus everything that builds Views or reshapes the vocabulary, and
// nothing is ever committed: after each model step, what the agent staged is
// cut into reviewable items (a new Concept with its summary and overview in
// one `concept.create`; each Relationship on its own; each existing Concept's
// changes together) and handed to `onItems`, which writes them to the ask's
// one Proposal. So items stream while the agent works, and Stop (or the
// per-ask cap) keeps what already came out.
import { isLive, type DomainState, type OpBody } from "@seply/domain"
import { z } from "zod"
import { liveConcepts, liveRelationships } from "../checks/common.ts"
import { memorySourceReader, type ViewReader } from "../ports.ts"
import { createCuratorTools, type CuratorTool } from "../tools.ts"
import { describeConcepts, type StageOptions } from "./curator.ts"
import { runLoop, type LoopTools } from "./loop.ts"
import { growInstructions } from "./playbook.ts"
import { renderSourceIndex, renderSources } from "./sources.ts"

/** The Concept actions that are Grow asks ("Write the article" is its own job). */
export const GROW_ACTIONS = ["missing", "examples", "related"] as const
export type GrowAction = (typeof GROW_ACTIONS)[number]

/** The Concept actions as the panel words them (spec §3.7). */
export const GROW_ACTION_LABELS: Record<GrowAction, string> = {
  missing: "Add what's missing to understand this",
  examples: "Add examples",
  related: "Suggest related",
}

/** One ask: free text from the Ask box, or a Concept action. */
export type GrowAsk = {
  /** The reader's words (the Ask box). */
  text?: string
  action?: GrowAction
  /** The Concept a Concept action is about. */
  conceptId?: string
  /** The View the reader is looking at. */
  viewId?: string
}

/** Step budget of one ask. */
export const GROW_MAX_STEPS = 24

/** The ask in words: what the Proposal's rationale says (spec §5.5). */
export function growRationale(ask: GrowAsk, state: DomainState): string {
  const text = ask.text?.trim()
  if (text) return text
  const title = (ask.conceptId && state.concepts[ask.conceptId]?.title) || "this"
  switch (ask.action) {
    case "examples":
      return `Add examples of ${title}`
    case "related":
      return `Suggest Concepts related to ${title}`
    default:
      return `Add what's missing to understand ${title}`
  }
}

/** One reviewable unit of a Proposal. */
export type GrowItem = { ops: OpBody[] }

/**
 * Cuts one step's staged op bodies into items: a `concept.create` takes the
 * edits of the same new Concept that follow it; each Relationship is its own
 * item; an existing Concept's edits in the step are one item.
 */
export function itemsFrom(bodies: readonly OpBody[]): GrowItem[] {
  const items: GrowItem[] = []
  const byConcept = new Map<string, GrowItem>()
  for (const b of bodies) {
    if (b.kind === "concept.create") {
      const item = { ops: [b] }
      byConcept.set(b.target, item)
      items.push(item)
    } else if (
      b.kind === "concept.set" ||
      b.kind === "concept.tag.add" ||
      b.kind === "concept.tag.remove"
    ) {
      let item = byConcept.get(b.target)
      if (!item) {
        item = { ops: [] }
        byConcept.set(b.target, item)
        items.push(item)
      }
      item.ops.push(b)
    } else items.push({ ops: [b] })
  }
  return items
}

export type GrowOptions = StageOptions & {
  /** The Expedition, with this ask's earlier suggestions applied (a resumed ask). */
  state: DomainState
  ask: GrowAsk
  /** Whole Sources in context (else their index; the agent reads with source_read). */
  whole: boolean
  /** Renders the reader's View for view_inspect (only with `ask.viewId`). */
  views?: ViewReader
  /** How many suggestions this ask made before (already in `state`). */
  earlier?: number
  /** Called after each model step with its new items; write them to the Proposal. */
  onItems: (items: GrowItem[], state: DomainState) => Promise<void>
  maxSteps?: number
}

export type GrowResult = {
  /** Items handed to `onItems` in this run. */
  items: number
  /** The agent's last words to the reader. */
  text: string
  steps: number
  toolCalls: number
}

/**
 * Runs one ask. Nothing is committed: every step's staged ops go to
 * `onItems`, including when the loop ends early (Stop, the spending cap, an
 * error), so what streamed is kept. Throws what the loop threw after that.
 */
export async function grow(o: GrowOptions): Promise<GrowResult> {
  const focus = o.ask.conceptId ? o.state.concepts[o.ask.conceptId] : undefined
  if (o.ask.conceptId && !isLive(focus)) throw new Error("That Concept is gone")
  const viewRow = o.ask.viewId ? o.state.views[o.ask.viewId] : undefined
  const view = viewRow && isLive(viewRow) ? viewRow : undefined

  const c = createCuratorTools({
    state: o.state,
    views: o.views ?? NO_VIEWS,
    sources: memorySourceReader(
      Object.fromEntries(o.sources.map((s) => [s.id, s.segments]))
    ),
    newId: o.newId,
  })
  const base = c.tools

  // New Concepts arrive complete (spec §5.5): summary and overview in the one create.
  const conceptCreate: CuratorTool<never, unknown> = {
    description: `${base.concept_create.description} In Grow every new Concept needs its summary (one line) and its overview (one paragraph) in this same call.`,
    inputSchema: base.concept_create.inputSchema as never,
    execute: async (input: unknown) => {
      const v = input as { summary?: unknown; overview?: unknown }
      const missing = [
        !nonEmpty(v?.summary) && "summary",
        !nonEmpty(v?.overview) && "overview",
      ].filter(Boolean)
      if (missing.length)
        return {
          ok: false,
          error: `A suggested Concept needs its ${missing.join(" and ")}: send them in the same concept_create.`,
        }
      return base.concept_create.execute(input as never)
    },
  }

  const tools: LoopTools = {
    concept_create: conceptCreate,
    concept_update: base.concept_update,
    relationship_add: base.relationship_add,
    search_existing: base.search_existing,
    ...(o.sources.length && { source_read: base.source_read }),
    ...(o.views && view && { view_inspect: viewInspect(base.view_inspect, view.id) }),
  } as unknown as LoopTools

  let count = 0
  const flush = async () => {
    const bodies = c.stage.take()
    if (!bodies.length) return
    const items = itemsFrom(bodies)
    count += items.length
    await o.onItems(items, c.stage.state)
  }

  const prefix = o.sources.length
    ? o.whole
      ? renderSources(o.sources)
      : renderSourceIndex(o.sources)
    : "(This Expedition has no Source text to read: everything you suggest is background knowledge, with `prov: []`.)"
  const task = growTask(o, focus ? focus.id : undefined, view?.id)

  let r: Awaited<ReturnType<typeof runLoop>>
  try {
    r = await runLoop({
      model: o.model,
      instructions: growInstructions(),
      prefix,
      task,
      tools,
      maxSteps: o.maxSteps ?? GROW_MAX_STEPS,
      onStep: async () => {
        await flush()
        await o.onStep?.({ state: c.stage.state, staged: c.stage.staged })
      },
      abortSignal: o.abortSignal,
    })
  } finally {
    // Stop, the cap or an error: what the agent made is still a suggestion.
    await flush()
  }
  return { items: count, text: r.text.trim(), steps: r.steps, toolCalls: r.toolCalls }
}

const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0

/** view_inspect, on the reader's View only. */
function viewInspect(t: CuratorTool<{ viewId: string }, unknown>, viewId: string): CuratorTool<never, unknown> {
  return {
    description: `${t.description} Here it shows the reader's View (${viewId}) with your suggestions in it.`,
    inputSchema: z.strictObject({}) as never,
    execute: async () => t.execute({ viewId }),
  }
}

function growTask(o: GrowOptions, focusId: string | undefined, viewId: string | undefined): string {
  const { state, ask } = o
  const parts = [`## The Concept set\n\n${describeConcepts(state)}`]
  if (focusId) parts.push(`## The Concept it is about\n\n${neighbourhood(state, focusId)}`)
  if (viewId) {
    const v = state.views[viewId]!
    parts.push(
      `## The reader's View\n\n${v.label} (${v.viewType}, id ${v.id})${v.question ? `: “${v.question}”` : ""}`
    )
  }
  if (o.earlier)
    parts.push(
      `## Already suggested\n\nThis ask was interrupted after ${o.earlier} suggestion${o.earlier === 1 ? "" : "s"}; they are in the Concept set above. Carry on from there; don't repeat them.`
    )
  const said = ask.text?.trim()
  parts.push(
    `## The ask\n\n${
      said
        ? `“${said}”`
        : `${GROW_ACTION_LABELS[ask.action ?? "missing"]}: ${growRationale(ask, state)}.`
    }`,
    `Source ids: ${o.sources.length ? o.sources.map((s) => `${s.id} (${s.title})`).join(", ") : "none"}. Answer it following the playbook: search, then create complete Concepts and link them, then one short sentence and no tool calls.`
  )
  return parts.join("\n\n")
}

/** One Concept with its summary, overview and every Relationship, both ways. */
function neighbourhood(state: DomainState, id: string): string {
  const c = state.concepts[id]!
  const title = (x: string) => state.concepts[x]?.title ?? x
  const short = (t: string) => t.replace(/^builtin:/, "")
  const out = liveRelationships(state)
    .filter((r) => r.from === id)
    .map((r) => `- ${c.title} -${short(r.type)}-> ${title(r.to)} (${r.to})`)
  const into = liveRelationships(state)
    .filter((r) => r.to === id)
    .map((r) => `- ${title(r.from)} (${r.from}) -${short(r.type)}-> ${c.title}`)
  return [
    `${c.title} (${c.id}), ${short(c.kind)}${c.aliases.length ? `, aka ${c.aliases.join("; ")}` : ""}`,
    c.summary ? `Summary: ${c.summary}` : "",
    c.overview ? `Overview: ${c.overview}` : "",
    `Relationships (${out.length + into.length}):`,
    ...(out.length || into.length ? [...out, ...into] : ["- none"]),
  ]
    .filter(Boolean)
    .join("\n")
}

/** Live Concepts and Relationships, for an estimate's size. */
export function growSize(state: DomainState): { concepts: number; relationships: number } {
  return { concepts: liveConcepts(state).length, relationships: liveRelationships(state).length }
}

const NO_VIEWS: ViewReader = {
  read: async () => {
    throw new Error("no View is read in this ask")
  },
}
