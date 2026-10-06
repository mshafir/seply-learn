// The MCP tools (spec §6.2) as definitions shared with the curator's tools
// (spec §5.3): their inputs are the curator tools' input schemas, and their
// writes run through the curator tools over a staging area, so an MCP agent
// and the in-app curator are validated by the same code and can't drift.
// The server (`packages/server/src/mcp/`) serves them over streamable HTTP and
// renders their answers; nothing here touches a database or a transport, so
// phase 2 can serve the same tools on loopback.
//
// - `stageProposal`: `propose_changes` items → one item of op bodies each.
// - `stageFirstBuild`: `create_expedition` → the first build's op bodies.
import {
  ConceptCreateValue,
  Id,
  SegmentId,
  Speaker,
  emptyState,
  isLive,
  ulid,
  type DomainState,
  type OpBody,
  type Prov,
} from "@seply/domain"
import { z } from "zod"
import {
  memorySourceReader,
  type Segment,
  type SourceReader,
  type ViewReader,
} from "./ports.ts"
import { SKILL_TEXT } from "./playbook/generated.ts"
import { createCuratorTools, type CuratorTool } from "./tools.ts"

// --- scopes ------------------------------------------------------------------

/** OAuth scopes and API token scopes (spec §6.1): coarse verbs, the role decides the rest. */
export const MCP_SCOPES = [
  "expeditions:read",
  "expeditions:create",
  "proposals:write",
] as const
export type McpScope = (typeof MCP_SCOPES)[number]
export const McpScope = z.enum(MCP_SCOPES)

/** What each scope lets an agent do, as the consent screen and Settings word it. */
export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  "expeditions:read": "Read the Expeditions you can see",
  "expeditions:create": "Create new private Expeditions",
  "proposals:write": "Suggest changes (they wait in Suggestions for you)",
}

/** The server's instructions for MCP clients: the `seply-learn` skill (spec §6.3). */
export const MCP_INSTRUCTIONS = SKILL_TEXT

// --- temp ids ------------------------------------------------------------------

/** A temp id: names something an item creates, so later items can use it. */
export const TempId = z
  .string()
  .regex(
    /^new:[^|.\s]+$/,
    'temp ids look like "new:<name>" (no "|", "." or spaces)'
  )
  .describe(
    'A temp id for what this item creates, e.g. "new:mla"; later items use it in place of an id.'
  )

const isTempId = (s: string) => s.startsWith("new:")

/**
 * Replaces temp ids with real ids: as values, as record keys, and in overview
 * links (`[MLA](#c/new:mla)`). Temp ids it doesn't know go in `unknown`.
 */
function withIds(
  value: unknown,
  ids: ReadonlyMap<string, string>,
  unknown: Set<string>
): unknown {
  const lookup = (t: string) => {
    const id = ids.get(t)
    if (id === undefined) unknown.add(t)
    return id ?? t
  }
  const swap = (s: string) =>
    isTempId(s)
      ? lookup(s)
      : s.replace(
          /(#c\/)(new:[^|.\s)]+)/g,
          (_, pre: string, t: string) => pre + lookup(t)
        )
  if (typeof value === "string") return swap(value)
  if (Array.isArray(value)) return value.map((v) => withIds(v, ids, unknown))
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [swap(k), withIds(v, ids, unknown)])
    )
  return value
}

// --- the curator's tools, as MCP inputs ----------------------------------------

const NO_VIEWS: ViewReader = {
  read: async () => {
    throw new Error("Views can't be drawn here")
  },
}

// One tool set over an empty Expedition lends its schemas and descriptions.
const CURATOR = createCuratorTools({
  state: emptyState("schemas"),
  views: NO_VIEWS,
}).tools

type Schema = z.ZodType
const input = (t: { inputSchema: unknown }) => t.inputSchema as Schema

/** The curator tools an MCP agent may propose through, by name. */
export const PROPOSE_TOOLS = [
  "concept_create",
  "concept_update",
  "relationship_add",
  "relationship_remove",
  "view_build",
] as const
export type ProposeTool = (typeof PROPOSE_TOOLS)[number]

/** One item of `propose_changes`: a curator tool call (its input exactly as that tool takes it). */
export const ProposeItem = z.discriminatedUnion("tool", [
  z.strictObject({
    tool: z.literal("concept_create"),
    ref: TempId.optional(),
    input: input(CURATOR.concept_create),
  }),
  z.strictObject({
    tool: z.literal("concept_update"),
    input: input(CURATOR.concept_update),
  }),
  z.strictObject({
    tool: z.literal("relationship_add"),
    input: input(CURATOR.relationship_add),
  }),
  z.strictObject({
    tool: z.literal("relationship_remove"),
    input: input(CURATOR.relationship_remove),
  }),
  z.strictObject({
    tool: z.literal("view_build"),
    ref: TempId.optional(),
    input: input(CURATOR.view_build),
  }),
])
export type ProposeItem = { tool: ProposeTool; ref?: string; input: unknown }

export const ProposeChangesInput = z.strictObject({
  expedition: Id.describe("The Expedition's id"),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      "Why: one or two sentences the reader sees above the suggestions, e.g. what you learned in this session"
    ),
  items: z.array(ProposeItem).min(1).max(100),
})
export type ProposeChangesInput = z.infer<typeof ProposeChangesInput>

/** What became of one item. */
export type ProposeItemResult =
  | { index: number; tool: ProposeTool; ok: true; ref?: string; id?: string }
  | { index: number; tool: ProposeTool; ok: false; error: string }

export type StagedProposal = {
  results: ProposeItemResult[]
  /** The Proposal's items: one per item that was taken. */
  items: { ops: OpBody[] }[]
  /** Temp id → the id it became. */
  ids: Record<string, string>
}

/**
 * Runs `propose_changes` items through the curator tools, one at a time, over
 * the Expedition with the earlier items applied. A refused item is skipped
 * (its result says why) and the others stand. A View is taken only when
 * `view.inspect` finds no problems in it, and goes in ready.
 */
export async function stageProposal(o: {
  state: DomainState
  items: readonly ProposeItem[]
  /** Renders Views for inspection; without one, Views can't be proposed. */
  views?: ViewReader
  sources?: SourceReader
  newId?: () => string
}): Promise<StagedProposal> {
  const c = createCuratorTools({
    state: o.state,
    views: o.views ?? NO_VIEWS,
    sources: o.sources,
    newId: o.newId,
  })
  const ids = new Map<string, string>()
  const results: ProposeItemResult[] = []
  const items: { ops: OpBody[] }[] = []

  for (const [index, item] of o.items.entries()) {
    const fail = (error: string) => {
      c.stage.discard()
      results.push({ index, tool: item.tool, ok: false, error })
    }
    if (item.ref && ids.has(item.ref)) {
      fail(`temp id ${item.ref} is used twice`)
      continue
    }
    if (item.tool === "view_build" && !o.views) {
      fail("Views can't be suggested here")
      continue
    }
    const unknown = new Set<string>()
    const resolved = withIds(item.input, ids, unknown)
    if (unknown.size) {
      fail(
        `unknown temp id ${[...unknown].join(", ")}: create it in an earlier item (or it was refused)`
      )
      continue
    }
    const tool = c.tools[item.tool] as CuratorTool<unknown, unknown>
    const out = (await tool.execute(resolved)) as
      { ok: true; id?: string; viewId?: string } | { ok: false; error: string }
    if (!out.ok) {
      fail(out.error)
      continue
    }
    const id = out.id ?? out.viewId
    if (item.tool === "view_build" && out.viewId) {
      const seen = await c.inspect(out.viewId)
      if (!seen.ok) {
        fail(
          `the View has problems: ${seen.problems.map((p) => p.message).join("; ")}`
        )
        continue
      }
      if (c.stage.state.views[out.viewId]?.status !== "ready")
        c.stage.stage([
          {
            kind: "view.set",
            target: out.viewId,
            path: "status",
            value: "ready",
          },
        ])
    }
    if (item.ref && id) ids.set(item.ref, id)
    items.push({ ops: c.stage.take() })
    results.push({
      index,
      tool: item.tool,
      ok: true,
      ...(item.ref && { ref: item.ref }),
      ...(id && { id }),
    })
  }
  return { results, items, ids: Object.fromEntries(ids) }
}

// --- create_expedition ------------------------------------------------------------

const SourceInput = z
  .strictObject({
    ref: TempId.describe(
      'A temp id for this Source, e.g. "new:chat"; prov cites it as `source`'
    ),
    title: z.string().trim().min(1).max(200),
    kind: z
      .enum(["chat", "document", "prompt"])
      .default("document")
      .describe(
        "chat: a conversation (turns t1, t2…); document: text (sections s1, s2…); prompt: a request on its own"
      ),
    segments: z
      .array(
        z.strictObject({
          id: SegmentId.describe(
            "t1, t2… for chat turns; s1, s2… for sections; p1… for pages"
          ),
          text: z.string().min(1),
          speaker: Speaker.optional().describe(
            'Chat turns: "user" (the reader) or "assistant"'
          ),
          heading: z.string().optional(),
        })
      )
      .min(1)
      .max(2000)
      .describe(
        "The Source split into segments with your own ids, so prov can cite them"
      ),
  })
  .refine(
    (s) => new Set(s.segments.map((x) => x.id)).size === s.segments.length,
    {
      message: "segment ids must be unique",
    }
  )

export const CreateExpeditionInput = z.strictObject({
  title: z.string().trim().min(1).max(200),
  summary: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe("One or two sentences: what this Expedition covers"),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  sources: z.array(SourceInput).min(1).max(10),
  attributes: z.array(input(CURATOR.attribute_define)).max(50).optional(),
  concepts: z
    .array(ConceptCreateValue.extend({ ref: TempId }))
    .min(1)
    .max(500)
    .describe(
      "Each Concept with a temp id; Relationships, Views and prov use the temp ids"
    ),
  relationships: z.array(input(CURATOR.relationship_add)).max(2000).optional(),
  views: z
    .array(input(CURATOR.view_build))
    .min(1)
    .max(8)
    .describe(
      "The Views, in rail order; the first opens the Expedition. Every View must pass view.inspect"
    ),
})
export type CreateExpeditionInput = z.infer<typeof CreateExpeditionInput>
export type SourceInput = CreateExpeditionInput["sources"][number]

export type FirstBuild =
  | {
      ok: true
      bodies: OpBody[]
      counts: { concepts: number; relationships: number; views: number }
      /** Temp id → the id it became (Concepts and Views by rail order). */
      ids: Record<string, string>
      viewIds: string[]
    }
  | { ok: false; errors: string[] }

/** Prov entries that cite a Source or segment that isn't there. */
function unresolved(
  prov: Prov | undefined,
  segments: ReadonlyMap<string, ReadonlySet<string>>
): string[] {
  return (prov ?? [])
    .filter((p) => !segments.get(p.source)?.has(p.segment))
    .map((p) => `${p.source}#${p.segment}`)
}

/**
 * Validates `create_expedition` and makes the first build's op bodies (spec
 * §6.2): `preamble` (the Sources' `source.add`, made by the server, which
 * stores their segments), the Expedition's title, summary and Tags, then the
 * Attributes, Concepts, Relationships and Views through the curator tools, and
 * the commit, which every View must pass. All or nothing: any error refuses
 * the whole build, and every error found is returned.
 */
export async function stageFirstBuild(o: {
  expeditionId: string
  input: CreateExpeditionInput
  /** Source temp id → the id the server minted. */
  sourceIds: Record<string, string>
  /** `source.add` bodies for those ids. */
  preamble: OpBody[]
  views: ViewReader
  newId?: () => string
}): Promise<FirstBuild> {
  const { input } = o
  const segments: Record<string, Segment[]> = {}
  for (const s of input.sources) segments[o.sourceIds[s.ref]!] = s.segments
  const segIds = new Map(
    Object.entries(segments).map(([id, segs]) => [
      id,
      new Set(segs.map((s) => s.id)),
    ])
  )

  // Every Concept's id is minted up front, so any Concept, Relationship,
  // View or overview link can name any other, in any order.
  const mint = o.newId ?? (() => ulid(Date.now()))
  let minted: string | undefined
  const c = createCuratorTools({
    state: emptyState(o.expeditionId),
    views: o.views,
    sources: memorySourceReader(segments),
    newId: () => minted ?? mint(),
  })
  const errors: string[] = []
  const ids = new Map(Object.entries(o.sourceIds))
  const conceptIds = new Map<string, string>()
  for (const { ref } of input.concepts) {
    if (ids.has(ref) || conceptIds.has(ref))
      errors.push(`concept ${ref}: temp id used twice`)
    else conceptIds.set(ref, mint())
  }
  for (const [ref, id] of conceptIds) ids.set(ref, id)

  const staged = c.stage.stage(o.preamble)
  if (!staged.ok) return { ok: false, errors: [staged.error] }
  const exp = o.expeditionId
  const head: OpBody[] = [
    { kind: "expedition.set", target: exp, path: "title", value: input.title },
  ]
  if (input.summary)
    head.push({
      kind: "expedition.set",
      target: exp,
      path: "summary",
      value: input.summary,
    })
  for (const t of new Set(input.tags ?? []))
    head.push({ kind: "expedition.tag.add", target: exp, value: t })
  const h = c.stage.stage(head)
  if (!h.ok) errors.push(h.error)

  const run = async (
    what: string,
    tool: CuratorTool<unknown, unknown>,
    raw: unknown
  ) => {
    const unknown = new Set<string>()
    const resolved = withIds(raw, ids, unknown)
    if (unknown.size) {
      errors.push(`${what}: unknown temp id ${[...unknown].join(", ")}`)
      return null
    }
    const out = (await tool.execute(resolved)) as
      { ok: true; id?: string; viewId?: string } | { ok: false; error: string }
    if (!out.ok) {
      errors.push(`${what}: ${out.error}`)
      return null
    }
    return out
  }

  for (const a of input.attributes ?? [])
    await run(
      `attribute ${(a as { id?: string }).id ?? ""}`,
      CURATOR_OF(c).attribute_define,
      a
    )

  const created = new Set<string>()
  for (const { ref, ...value } of input.concepts) {
    if (created.has(ref) || !conceptIds.has(ref)) continue
    created.add(ref)
    const unknown = new Set<string>()
    const resolved = withIds(value, ids, unknown) as typeof value
    const bad = [
      ...unresolved(resolved.prov, segIds),
      ...unresolved(resolved.overviewProv, segIds),
    ]
    if (bad.length)
      errors.push(
        `concept ${ref}: prov cites no such segment: ${bad.join(", ")}`
      )
    minted = conceptIds.get(ref)
    await run(`concept ${ref}`, CURATOR_OF(c).concept_create, value)
    minted = undefined
  }

  for (const r of input.relationships ?? []) {
    const rel = r as { from: string; type: string; to: string; prov?: Prov }
    const what = `relationship ${rel.from} -${rel.type}-> ${rel.to}`
    const unknown = new Set<string>()
    const bad = unresolved(
      withIds(rel.prov, ids, unknown) as Prov | undefined,
      segIds
    )
    if (bad.length)
      errors.push(`${what}: prov cites no such segment: ${bad.join(", ")}`)
    await run(what, CURATOR_OF(c).relationship_add, r)
  }

  const viewIds: string[] = []
  for (const [i, v] of input.views.entries()) {
    const out = await run(
      `view ${i + 1} (${(v as { label?: string }).label ?? ""})`,
      CURATOR_OF(c).view_build,
      v
    )
    if (out?.viewId) viewIds.push(out.viewId)
  }
  if (errors.length) return { ok: false, errors }

  if (viewIds[0]) {
    const tail = c.stage.stage([
      {
        kind: "expedition.set",
        target: exp,
        path: "bestViewId",
        value: viewIds[0],
      },
      { kind: "expedition.set", target: exp, path: "status", value: "ready" },
    ])
    if (!tail.ok) return { ok: false, errors: [tail.error] }
  }
  const done = await c.commit({ label: "Built from MCP", views: viewIds })
  if (!done.ok)
    return {
      ok: false,
      errors: done.blocked.flatMap((b) =>
        b.problems.map((p) =>
          b.label ? `View '${b.label}': ${p.message}` : p.message
        )
      ),
    }
  const state = c.stage.state
  const live = (r: Record<string, { deletedAt: string | null }>) =>
    Object.values(r).filter(isLive).length
  return {
    ok: true,
    bodies: done.bodies,
    counts: {
      concepts: live(state.concepts),
      relationships: live(state.relationships),
      views: viewIds.length,
    },
    ids: Object.fromEntries(conceptIds),
    viewIds,
  }
}

const CURATOR_OF = (c: ReturnType<typeof createCuratorTools>) =>
  c.tools as unknown as Record<string, CuratorTool<unknown, unknown>>

// --- the tool catalog ------------------------------------------------------------------

const ExpeditionRef = Id.describe(
  "The Expedition's id (from list_expeditions or search)"
)

/** One MCP tool: what the client sees, and the scope it needs. */
export type McpToolDef = {
  title: string
  description: string
  scope: McpScope
  /** Reads only (MCP's readOnlyHint). */
  readOnly: boolean
  input: z.ZodObject
}

const def = <I extends z.ZodObject>(
  d: Omit<McpToolDef, "input"> & { input: I }
) => d

/**
 * Every MCP tool (spec §6.2), with its input schema and description. The
 * server registers each with a handler; the descriptions carry the
 * skill's core guidance for clients that don't load skills.
 */
export const MCP_TOOLS = {
  list_expeditions: def({
    title: "List Expeditions",
    description:
      "The Expeditions you own or collaborate on (mine first, then shared with you), with ids, your role, Visibility and counts. Start here.",
    scope: "expeditions:read",
    readOnly: true,
    input: z.strictObject({}),
  }),
  get_expedition: def({
    title: "Get an Expedition",
    description:
      "One Expedition: its summary, Views (with ids and the question each answers), Concept Kinds, Relationship Types, Attributes, Sources and counts. Read it before you propose changes to it.",
    scope: "expeditions:read",
    readOnly: true,
    input: z.strictObject({ expedition: ExpeditionRef }),
  }),
  get_view: def({
    title: "Read a View",
    description:
      "A View as a reader sees it, in its own shape (the outline tree, the table with its cells, the path to a target, the timeline…), with the Concept ids it shows.",
    scope: "expeditions:read",
    readOnly: true,
    input: z.strictObject({
      expedition: ExpeditionRef,
      view: Id.describe("The View's id (from get_expedition)"),
    }),
  }),
  get_concept: def({
    title: "Read a Concept",
    description:
      "One Concept at a chosen depth (summary, overview, or the full article), with its Kind, Tags, Attributes and provenance, and its neighbours up to `hops` Relationships away.",
    scope: "expeditions:read",
    readOnly: true,
    input: z.strictObject({
      expedition: ExpeditionRef,
      concept: Id.describe("The Concept's id"),
      depth: z.enum(["summary", "overview", "article"]).default("overview"),
      hops: z.number().int().min(0).max(3).default(1),
    }),
  }),
  search: def({
    title: "Search",
    description:
      "Search the Expeditions you can see: free text over titles, aliases and summaries, and #tags. Returns Expeditions, Concepts (with their Expedition) and Tags.",
    scope: "expeditions:read",
    readOnly: true,
    input: z.strictObject({
      query: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('Words and #tags, e.g. "attention #gpu"'),
      includePublic: z
        .boolean()
        .default(false)
        .describe("Also search public Expeditions"),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  }),
  list_sources: def({
    title: "List Sources",
    description:
      "The Sources an Expedition was built from, with ids, kinds and segment counts.",
    scope: "expeditions:read",
    readOnly: true,
    input: z.strictObject({ expedition: ExpeditionRef }),
  }),
  get_source_segments: def({
    title: "Read Source segments",
    description:
      "Read a Source by segment (t14 = chat turn 14, s3 = section 3, p2 = page 2), to check a fact or find what to cite in prov. Without `segments`, lists them (id and first line) from `offset`.",
    scope: "expeditions:read",
    readOnly: true,
    input: z.strictObject({
      expedition: ExpeditionRef,
      source: Id.describe("The Source's id (from list_sources)"),
      segments: z.array(z.string().min(1)).min(1).max(40).optional(),
      offset: z.number().int().min(0).default(0),
    }),
  }),
  create_expedition: def({
    title: "Create an Expedition",
    description: [
      "Create a new private Expedition you own from Sources and what you extracted from them with your own model: Concepts, Relationships, Attributes and at least one View. It is written directly as its first build (not a suggestion), so make it complete and right-sized.",
      "Give each Source as segments with ids (t1… chat turns, s1… sections) and cite them in prov ({source: <Source temp id>, segment}); empty prov means background knowledge.",
      'Use temp ids ("new:…") for Sources and Concepts; Relationships, View settings and prov refer to them.',
      "Every View must pass the same checks as the in-app curator's; a refusal lists every problem, so fix them and call again.",
      `Concepts: ${CURATOR.concept_create.description}`,
      `Relationships: ${CURATOR.relationship_add.description}`,
      `Views: ${CURATOR.view_build.description}`,
    ].join("\n\n"),
    scope: "expeditions:create",
    readOnly: false,
    input: CreateExpeditionInput,
  }),
  propose_changes: def({
    title: "Propose changes",
    description: [
      "Suggest changes to an Expedition as ONE Proposal: it waits in the reader's Suggestions until they accept or dismiss it, item by item. You never change an Expedition directly.",
      'Each item is one curator tool call: concept_create (give it a temp id `ref` like "new:qlora" that later items use), concept_update, relationship_add, relationship_remove, view_build. A refused item is skipped and the reply says why; the rest are proposed. Keep a batch small and coherent, with a rationale.',
      "New Concepts need a summary (one line) and an overview (one paragraph). Link each new Concept to the Concepts already there.",
      `concept_create: ${CURATOR.concept_create.description}`,
      `concept_update: ${CURATOR.concept_update.description}`,
      `relationship_add: ${CURATOR.relationship_add.description}`,
      `relationship_remove: ${CURATOR.relationship_remove.description}`,
      `view_build: ${CURATOR.view_build.description}`,
    ].join("\n\n"),
    scope: "proposals:write",
    readOnly: false,
    input: ProposeChangesInput,
  }),
  list_my_proposals: def({
    title: "List my Proposals",
    description:
      "Your Proposals (made through MCP), newest first, with what is still pending, accepted or dismissed.",
    scope: "expeditions:read",
    readOnly: true,
    input: z.strictObject({
      expedition: ExpeditionRef.optional().describe("Only this Expedition's"),
    }),
  }),
  withdraw_proposal: def({
    title: "Withdraw a Proposal",
    description:
      "Withdraw one of your Proposals: its pending items leave Suggestions. Items already accepted stay.",
    scope: "proposals:write",
    readOnly: false,
    input: z.strictObject({
      expedition: ExpeditionRef,
      proposal: Id.describe("The Proposal's id"),
    }),
  }),
} satisfies Record<string, McpToolDef>
export type McpToolName = keyof typeof MCP_TOOLS
