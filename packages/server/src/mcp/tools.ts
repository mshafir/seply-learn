// The MCP tools' handlers (spec §6.2). Their names, descriptions and input
// schemas come from `@seply/ai` (`MCP_TOOLS`), where they are built from the
// curator tools; here each one checks its scope and the agent's access, runs
// against the database, and answers in compact markdown. Every call that
// touches an Expedition renews the agent's presence in its room.
import {
  MCP_INSTRUCTIONS,
  MCP_TOOLS,
  stageFirstBuild,
  stageProposal,
  type CreateExpeditionInput,
  type McpToolName,
  type Segment,
  type SourceReader,
  type ViewReader,
} from "@seply/ai"
import {
  canPropose,
  isLive,
  makeOps,
  schema,
  segmentsDoc,
  ulid,
  type OpBody,
  type SegmentsDoc,
  type SourceKind,
} from "@seply/domain"
import { McpServer } from "@modelcontextprotocol/server"
import { and, desc, eq, isNull } from "drizzle-orm"
import type { z } from "zod"
import { expeditionAccess, type ExpeditionAccess } from "../access.ts"
import { sourceBlobKeys, type BlobStore } from "../blobs.ts"
import type { ServerConfig } from "../config.ts"
import type { Db } from "../db.ts"
import { createExpedition, libraryCards } from "../expeditions.ts"
import { loadState } from "../projection.ts"
import {
  addProposalItems,
  announceProposals,
  createProposal,
  listAuthoredProposals,
  withdrawProposal,
} from "../proposals.ts"
import { publishCommitted, type Relay } from "../relay.ts"
import { search } from "../search.ts"
import { readSegments } from "../sources/store.ts"
import { agentCaller, type Agent } from "./agent.ts"
import {
  cell,
  clip,
  conceptLegend,
  renderConcept,
  renderExpedition,
  renderViewPlain,
} from "./render.ts"

/** How long an agent shows in a room after its last call. */
export const AGENT_TTL_MS = 5 * 60_000

export type ToolContext = {
  db: Db
  agent: Agent
  relay: Relay
  config: ServerConfig
  /** The blob store; throws when there is none. */
  blobs: () => BlobStore
  /** Renders Views (`@seply/views/inspect`); without it, get_view lists and Views can't be proposed. */
  views?: ViewReader
}

/** A tool call the agent should read and correct: answered with `isError`. */
export class Refusal extends Error {}

const link = (ctx: ToolContext, expeditionId: string) =>
  `${ctx.config.baseURL}/e/${expeditionId}`

/** Shows the agent in the Expedition's room. Best effort. */
async function present(ctx: ToolContext, expeditionId: string) {
  try {
    await ctx.relay.agentPresence?.(expeditionId, {
      userId: ctx.agent.userId,
      label: ctx.agent.label,
      ttlMs: AGENT_TTL_MS,
    })
  } catch (err) {
    console.error("relay: agentPresence failed", err)
  }
}

/** The agent's access to an Expedition it may read; refuses otherwise (never saying whether it exists). */
async function readable(
  ctx: ToolContext,
  expeditionId: string
): Promise<ExpeditionAccess> {
  const a = await expeditionAccess(
    ctx.db,
    expeditionId,
    agentCaller(ctx.agent, expeditionId)
  )
  if (!a)
    throw new Refusal(
      ctx.agent.expeditions
        ? `No Expedition ${expeditionId} that this token may use. It may not exist, or the token is restricted to other Expeditions.`
        : `No Expedition ${expeditionId} that you can see. Use list_expeditions or search for ids.`
    )
  await present(ctx, expeditionId)
  return a
}

async function stateOf(ctx: ToolContext, expeditionId: string) {
  const state = await loadState(ctx.db, expeditionId)
  if (!state) throw new Refusal(`No Expedition ${expeditionId}.`)
  return state
}

/** Reads a Source's segments from the blob store, for citation checks. */
function blobSourceReader(
  ctx: ToolContext,
  expeditionId: string
): SourceReader {
  return {
    async read(sourceId, ids) {
      let got: Awaited<ReturnType<typeof readSegments>>
      try {
        got = await readSegments(ctx.db, ctx.blobs(), expeditionId, sourceId)
      } catch {
        return []
      }
      const byId = new Map(
        got?.segments.segments.map((s) => [s.id, s as Segment]) ?? []
      )
      return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    },
  }
}

type Input<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]["input"]>
type Handlers = {
  [N in McpToolName]: (ctx: ToolContext, input: Input<N>) => Promise<string>
}

const ROLE_ORDER = { owner: 0, editor: 1, viewer: 2 } as const

export const HANDLERS: Handlers = {
  async list_expeditions(ctx) {
    const { collaborators, expeditions } = schema
    const rows = await ctx.db
      .select({
        id: expeditions.id,
        title: expeditions.title,
        summary: expeditions.summary,
        visibility: expeditions.visibility,
        status: expeditions.status,
        role: collaborators.role,
        seenAt: collaborators.seenAt,
      })
      .from(collaborators)
      .innerJoin(expeditions, eq(expeditions.id, collaborators.expeditionId))
      .where(
        and(
          eq(collaborators.userId, ctx.agent.userId),
          isNull(expeditions.deletedAt)
        )
      )
      .orderBy(desc(expeditions.id))
    const allowed = ctx.agent.expeditions
    const cards = await libraryCards(
      ctx.db,
      rows.filter((r) => !allowed || allowed.includes(r.id))
    )
    if (!cards.length)
      return allowed
        ? "This token may use no Expedition you can still see."
        : "No Expeditions yet. Create one with create_expedition."
    cards.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    const table = (list: typeof cards) => [
      "| Expedition | id | About | Your role | Visibility | Concepts | Views | Changed |",
      "|---|---|---|---|---|---|---|---|",
      ...list.map(
        (c) =>
          `| ${cell(c.title || "Untitled")} | \`${c.id}\` | ${clip(cell(c.summary ?? ""), 100)} | ${c.role} | ${c.visibility} | ${c.counts.concepts} | ${c.counts.views} | ${c.updatedAt.slice(0, 10)} |`
      ),
    ]
    const mine = cards.filter((c) => c.role === "owner")
    const shared = cards.filter((c) => c.role !== "owner")
    return [
      ...(allowed
        ? ["_This token is restricted to the Expeditions below._", ""]
        : []),
      ...(mine.length ? ["## Mine", "", ...table(mine), ""] : []),
      ...(shared.length ? ["## Shared with me", "", ...table(shared)] : []),
    ]
      .join("\n")
      .trim()
  },

  async get_expedition(ctx, { expedition }) {
    const a = await readable(ctx, expedition)
    const state = await stateOf(ctx, expedition)
    return renderExpedition(state, {
      role: a.role,
      visibility: a.visibility,
      link: link(ctx, expedition),
    })
  },

  async get_view(ctx, { expedition, view }) {
    await readable(ctx, expedition)
    const state = await stateOf(ctx, expedition)
    const v = state.views[view]
    if (!isLive(v))
      throw new Refusal(
        `No View ${view} in this Expedition. get_expedition lists its Views.`
      )
    if (!ctx.views) return renderViewPlain(state, view)!
    let reading: string
    try {
      reading = (await ctx.views.read(state, view)).text
    } catch {
      return renderViewPlain(state, view)!
    }
    // The reading opens with "<label> (<View Type>): <question>", which the
    // heading and Answers line below already say.
    const head = `${v!.label} (${v!.viewType})`
    if (reading.startsWith(head))
      reading = reading.slice(reading.indexOf("\n") + 1 || reading.length)
    const legend = conceptLegend(state, reading)
    return [
      `# ${v!.label} (\`${view}\`, ${v!.viewType})`,
      ...(v!.question ? ["", `Answers: ${v!.question}`] : []),
      "",
      reading,
      ...(legend.length ? ["", "## Concept ids", "", ...legend] : []),
    ].join("\n")
  },

  async get_concept(ctx, { expedition, concept, depth, hops }) {
    await readable(ctx, expedition)
    const state = await stateOf(ctx, expedition)
    const out = renderConcept(state, concept, depth, hops)
    if (!out)
      throw new Refusal(
        `No Concept ${concept} in this Expedition. search finds Concepts by title.`
      )
    return out
  },

  async search(ctx, { query, includePublic, limit }) {
    const res = await search(ctx.db, {
      userId: ctx.agent.userId,
      q: query,
      includePublic,
      limit,
    })
    const allowed = ctx.agent.expeditions
    const ok = (id: string) => !allowed || allowed.includes(id)
    const exps = res.expeditions.filter((e) => ok(e.id))
    const concepts = res.concepts.filter((c) => ok(c.expeditionId))
    if (!exps.length && !concepts.length) return `Nothing found for “${query}”.`
    return [
      ...(exps.length
        ? [
            "## Expeditions",
            "",
            ...exps.map(
              (e) =>
                `- ${cell(e.title || "Untitled")} (\`${e.id}\`, ${e.role ?? "public"})${e.summary ? `: ${cell(e.summary)}` : ""}`
            ),
            "",
          ]
        : []),
      ...(concepts.length
        ? [
            "## Concepts",
            "",
            ...concepts.map(
              (c) =>
                `- ${cell(c.title)} (\`${c.id}\`) in ${cell(c.expeditionTitle)} (\`${c.expeditionId}\`)${c.summary ? `: ${cell(c.summary)}` : ""}`
            ),
            "",
          ]
        : []),
      ...(res.tags.length
        ? [
            "## Tags",
            "",
            res.tags.map((t) => `#${t.tag} (${t.count})`).join(" · "),
          ]
        : []),
    ]
      .join("\n")
      .trim()
  },

  async list_sources(ctx, { expedition }) {
    await readable(ctx, expedition)
    const state = await stateOf(ctx, expedition)
    const sources = Object.values(state.sources)
    if (!sources.length)
      return "No Sources: everything here is background knowledge."
    const lines = await Promise.all(
      sources.map(async (s) => {
        let count = "segments not stored"
        try {
          const got = await readSegments(ctx.db, ctx.blobs(), expedition, s.id)
          if (got)
            count = `${got.segments.segments.length} segments (${got.segments.kind})`
        } catch {
          // No blob store here: the list still names the Sources.
        }
        return `- ${cell(s.title)} (\`${s.id}\`): ${s.kind}, ${count}, added ${s.addedAt.slice(0, 10)}`
      })
    )
    return [
      "## Sources",
      "",
      ...lines,
      "",
      "Read one with get_source_segments.",
    ].join("\n")
  },

  async get_source_segments(ctx, { expedition, source, segments, offset }) {
    await readable(ctx, expedition)
    let got: Awaited<ReturnType<typeof readSegments>>
    try {
      got = await readSegments(ctx.db, ctx.blobs(), expedition, source)
    } catch {
      throw new Refusal("Sources can't be read on this server.")
    }
    if (!got)
      throw new Refusal(
        `No Source ${source} with stored segments. list_sources names them.`
      )
    const all = got.segments.segments
    const tag = (s: (typeof all)[number]) =>
      [s.id, s.speaker, s.speaker ? undefined : s.heading]
        .filter(Boolean)
        .join(" · ")
    if (segments) {
      const byId = new Map(all.map((s) => [s.id, s]))
      const found = segments.flatMap((id) =>
        byId.has(id) ? [byId.get(id)!] : []
      )
      const missing = segments.filter((id) => !byId.has(id))
      return [
        `# ${got.source.title} (\`${source}\`)`,
        "",
        ...found.map((s) => `[${tag(s)}]\n${s.text.trim()}\n`),
        ...(missing.length
          ? [`Not in this Source: ${missing.join(", ")}`]
          : []),
      ].join("\n")
    }
    const PAGE = 60
    const page = all.slice(offset, offset + PAGE)
    return [
      `# ${got.source.title} (\`${source}\`): segments ${offset + 1}–${offset + page.length} of ${all.length}`,
      "",
      ...page.map((s) => `- ${tag(s)}: ${cell(s.text).slice(0, 120)}`),
      ...(offset + PAGE < all.length
        ? ["", `More from offset ${offset + PAGE}.`]
        : []),
    ].join("\n")
  },

  async create_expedition(ctx, input) {
    return createFromAgent(ctx, input)
  },

  async propose_changes(ctx, { expedition, rationale, items }) {
    const a = await readable(ctx, expedition)
    if (!canPropose(a.actor, a.visibility))
      throw new Refusal(
        "Only owners and editors take suggestions on this Expedition; you can read it, but not suggest changes."
      )
    const state = await stateOf(ctx, expedition)
    const staged = await stageProposal({
      state,
      items: items as Parameters<typeof stageProposal>[0]["items"],
      views: ctx.views,
      sources: blobSourceReader(ctx, expedition),
    })
    const lines = staged.results.map((r) =>
      r.ok
        ? `- ${r.index + 1}. ${r.tool}: suggested${r.id ? ` (\`${r.id}\`${r.ref ? `, was ${r.ref}` : ""})` : ""}`
        : `- ${r.index + 1}. ${r.tool}: refused: ${r.error}`
    )
    if (!staged.items.length)
      throw new Refusal(
        ["Nothing was proposed: every item was refused.", "", ...lines].join(
          "\n"
        )
      )
    const proposalId = await createProposal(ctx.db, {
      expeditionId: expedition,
      author: ctx.agent.userId,
      origin: "mcp",
      rationale,
    })
    await addProposalItems(ctx.db, {
      expeditionId: expedition,
      proposalId,
      items: staged.items,
      state,
    })
    await announceProposals(ctx.db, ctx.relay, expedition)
    const n = staged.items.length
    const refused = staged.results.length - n
    return [
      `Proposal \`${proposalId}\`: ${n === 1 ? "1 suggestion" : `${n} suggestions`} wait in Suggestions${refused ? ` (${refused} refused)` : ""}. Nothing changes until the reader accepts them.`,
      `Review: ${link(ctx, expedition)}`,
      "",
      ...lines,
    ].join("\n")
  },

  async list_my_proposals(ctx, { expedition }) {
    const allowed = ctx.agent.expeditions
    let ids: string[] | undefined
    if (expedition) {
      await readable(ctx, expedition)
      ids = [expedition]
    } else if (allowed) ids = [...allowed]
    const list = await listAuthoredProposals(ctx.db, {
      author: ctx.agent.userId,
      origin: "mcp",
      expeditionIds: ids,
    })
    // Only Expeditions the user can still read.
    const visible: typeof list = []
    for (const p of list)
      if (
        await expeditionAccess(
          ctx.db,
          p.expeditionId,
          agentCaller(ctx.agent, p.expeditionId)
        )
      )
        visible.push(p)
    if (!visible.length) return "No Proposals from your agents yet."
    return [
      "| Proposal | Expedition | Rationale | Status | Pending | Accepted | Dismissed | Made |",
      "|---|---|---|---|---|---|---|---|",
      ...visible.map(
        (p) =>
          `| \`${p.id}\` | ${cell(p.expeditionTitle)} (\`${p.expeditionId}\`) | ${cell(p.rationale).slice(0, 120)} | ${p.status} | ${p.items.pending} | ${p.items.accepted} | ${p.items.dismissed} | ${p.createdAt.slice(0, 10)} |`
      ),
    ].join("\n")
  },

  async withdraw_proposal(ctx, { expedition, proposal }) {
    await readable(ctx, expedition)
    const n = await withdrawProposal(ctx.db, {
      expeditionId: expedition,
      proposalId: proposal,
      author: ctx.agent.userId,
    })
    if (n === null)
      throw new Refusal(
        `No Proposal ${proposal} of yours in this Expedition. list_my_proposals lists them.`
      )
    await announceProposals(ctx.db, ctx.relay, expedition)
    return n
      ? `Withdrew Proposal \`${proposal}\`: ${n === 1 ? "1 suggestion" : `${n} suggestions`} left Suggestions.`
      : `Proposal \`${proposal}\` had nothing pending; it now reads withdrawn.`
  },
}

// --- create_expedition --------------------------------------------------------------

const SOURCE_KIND: Record<
  CreateExpeditionInput["sources"][number]["kind"],
  SourceKind
> = {
  chat: "chat",
  document: "file",
  prompt: "prompt",
}

/**
 * create_expedition (spec §6.2): stores the Sources' segments, validates the
 * agent's extraction through the curator tools, and logs it all as the new
 * Expedition's first build, one Change (origin `mcp`). Private and owned by
 * the user. Nothing is written when it is refused.
 */
async function createFromAgent(
  ctx: ToolContext,
  input: CreateExpeditionInput
): Promise<string> {
  if (!ctx.views)
    throw new Refusal(
      "Expeditions can't be created here: this server can't check Views."
    )
  let blobs: BlobStore
  try {
    blobs = ctx.blobs()
  } catch {
    throw new Refusal(
      "Expeditions can't be created here: this server has no file storage for Sources."
    )
  }
  const now = Date.now()
  const at = new Date(now).toISOString()
  const mint = () => ulid(Date.now())
  const expeditionId = mint()
  const sourceIds: Record<string, string> = {}
  const preamble: OpBody[] = []
  const stored: {
    keys: ReturnType<typeof sourceBlobKeys>
    doc: SegmentsDoc
    raw: string
    mime: string
  }[] = []
  for (const s of input.sources) {
    if (sourceIds[s.ref])
      throw new Refusal(`Source temp id ${s.ref} is used twice.`)
    const id = mint()
    sourceIds[s.ref] = id
    const keys = sourceBlobKeys(expeditionId, id)
    const chat = s.kind === "chat"
    const doc = segmentsDoc(
      chat ? "chat" : "document",
      chat ? "chat-paste" : s.kind === "prompt" ? "prompt" : "markdown",
      s.segments
    )
    const raw = s.segments
      .map((seg) =>
        chat
          ? `${seg.speaker === "assistant" ? "Assistant" : "User"}: ${seg.text}`
          : seg.heading
            ? `## ${seg.heading}\n\n${seg.text}`
            : seg.text
      )
      .join("\n\n")
    const mime =
      chat || s.kind === "prompt"
        ? "text/plain; charset=utf-8"
        : "text/markdown; charset=utf-8"
    stored.push({ keys, doc, raw, mime })
    preamble.push({
      kind: "source.add",
      target: id,
      value: {
        kind: SOURCE_KIND[s.kind],
        title: s.title,
        blobKey: keys.raw,
        segmentsKey: keys.segments,
        mime,
        size: new TextEncoder().encode(raw).byteLength,
        addedBy: ctx.agent.userId,
        addedAt: at,
      },
    })
  }

  const built = await stageFirstBuild({
    expeditionId,
    input,
    sourceIds,
    preamble,
    views: ctx.views,
    newId: mint,
  })
  if (!built.ok)
    throw new Refusal(
      [
        `The Expedition wasn't created: ${built.errors.length === 1 ? "1 problem" : `${built.errors.length} problems`}. Fix them and call again.`,
        "",
        ...built.errors.slice(0, 60).map((e) => `- ${e}`),
      ].join("\n")
    )

  for (const s of stored) {
    await blobs.put(s.keys.raw, new TextEncoder().encode(s.raw), {
      contentType: s.mime,
    })
    await blobs.put(s.keys.segments, JSON.stringify(s.doc), {
      contentType: "application/json",
    })
  }
  const changeId = mint()
  const n = input.sources.length
  let logged
  try {
    ;({ logged } = await ctx.db.transaction((tx) =>
      createExpedition(tx, {
        id: expeditionId,
        userId: ctx.agent.userId,
        ops: makeOps(built.bodies, {
          expeditionId,
          actor: ctx.agent.userId,
          changeId,
          nextOpId: mint,
        }),
        change: {
          id: changeId,
          label: `Built from ${n === 1 ? "1 Source" : `${n} Sources`} by ${ctx.agent.label}`,
          origin: "mcp",
        },
      })
    ))
  } catch (err) {
    await Promise.allSettled(
      stored.flatMap((s) => [
        blobs.delete(s.keys.raw),
        blobs.delete(s.keys.segments),
      ])
    )
    throw err
  }
  await publishCommitted(ctx.relay, expeditionId, logged)
  const { concepts, relationships, views } = built.counts
  return [
    `Created the Expedition “${input.title}” (\`${expeditionId}\`): ${concepts} Concepts, ${relationships} Relationships, ${views === 1 ? "1 View" : `${views} Views`}. It is private and yours.`,
    `Open it: ${link(ctx, expeditionId)}`,
    "",
    "Ids:",
    ...Object.entries(built.ids).map(([ref, id]) => `- ${ref} → \`${id}\``),
    ...Object.entries(sourceIds).map(
      ([ref, id]) => `- ${ref} → \`${id}\` (Source)`
    ),
  ].join("\n")
}

// --- the server ---------------------------------------------------------------------

/** One MCP server for one request (stateless): every tool, answering as `ctx.agent`. */
export function mcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "seply-learn", title: "Seply Learn", version: "1.0.0" },
    { instructions: MCP_INSTRUCTIONS }
  )
  for (const name of Object.keys(MCP_TOOLS) as McpToolName[]) {
    const def = MCP_TOOLS[name]
    server.registerTool(
      name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: {
          title: def.title,
          readOnlyHint: def.readOnly,
          destructiveHint: false,
          idempotentHint: def.readOnly,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        const text = await runTool(ctx, name, args)
        return text.ok
          ? { content: [{ type: "text" as const, text: text.text }] }
          : {
              content: [{ type: "text" as const, text: text.text }],
              isError: true,
            }
      }
    )
  }
  return server
}

/** Runs one tool as the agent: its scope first, then the handler. */
export async function runTool(
  ctx: ToolContext,
  name: McpToolName,
  args: unknown
): Promise<{ ok: boolean; text: string }> {
  const def = MCP_TOOLS[name]
  if (!ctx.agent.scopes.has(def.scope))
    return {
      ok: false,
      text: `This ${ctx.agent.via === "token" ? "API token" : "connection"} doesn't have the ${def.scope} scope, which ${name} needs. The user can grant it in Seply Learn's Settings, under Connected agents.`,
    }
  try {
    const handler = HANDLERS[name] as (
      ctx: ToolContext,
      input: unknown
    ) => Promise<string>
    return { ok: true, text: await handler(ctx, args) }
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, text: err.message }
    throw err
  }
}
