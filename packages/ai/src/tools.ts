// The curator agent's tools (spec §5.3). The agent writes only through them;
// each input is a Zod schema over the `@seply/domain` op schemas (no
// free-form JSON), and each call becomes staged ops, validated and applied
// to a working copy at once. Commit takes the staged ops as one Change, and
// is refused while any View it carries has problems.
//
// A tool is `{ description, inputSchema, execute }`: the shape AI SDK's
// `tool()` takes, so the set drops straight into a `ToolLoopAgent`.
import {
  AttributeDefineValue,
  AttributeValue,
  CONCEPT_FIELDS,
  ConceptCreateValue,
  currentSettingsVersion,
  DateEnd,
  DateString,
  Id,
  isLive,
  keysAfter,
  Prov,
  relKey,
  splitArticle,
  ulid,
  VIEW_TYPE_IDS,
  VIEW_TYPES,
  WeightPin,
  type DomainState,
  type OpBody,
  type ViewTypeId,
} from "@seply/domain"
import { z } from "zod"
import { checkExpedition, type Finding } from "./checks/index.ts"
import { inspectView, type ViewInspection } from "./inspect.ts"
import type { Segment, SourceReader, ViewReader } from "./ports.ts"
import { searchExisting, type SearchHit } from "./search.ts"
import { StagingArea } from "./stage.ts"

export type CuratorTool<I = never, O = unknown> = {
  description: string
  inputSchema: z.ZodType<I>
  execute: (input: I) => Promise<O>
}

/** What every writing tool returns: ok with what it made, or the reason it was refused. */
export type ToolResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: string }

/** A Change ready to write: the staged op bodies, in order. */
export type CuratorCommit = {
  label: string
  bodies: OpBody[]
  /** The Views this Change commits (now `ready`). */
  views: string[]
}

export type CommitResult =
  | ({ ok: true } & CuratorCommit)
  | {
      ok: false
      /** Why: the Views with problems, and Expedition-wide problems. */
      blocked: { viewId?: string; label?: string; problems: Finding[] }[]
    }

export type CuratorToolsOptions = {
  /** The Expedition as of the last commit. */
  state: DomainState
  /** Renders Views for `view.inspect` (`@seply/views/inspect`'s `readView`). */
  views: ViewReader
  /** Reads Source segments for `source.read` and for citation checks. */
  sources?: SourceReader
  /** Mints entity ids (ULIDs by default). */
  newId?: () => string
  /** Op ids for the working copy (ULIDs by default). */
  nextOpId?: () => string
  /**
   * Where a commit goes (a Change, or a Proposal in Grow). When set, the
   * agent also gets `view_commit`; the loop can always call `commit` itself.
   */
  onCommit?: (commit: CuratorCommit) => void | Promise<void>
}

/** Tool names as the model sees them (providers allow no dots), and their names in the spec. */
export const TOOL_NAMES = {
  concept_create: "concept.create",
  concept_update: "concept.update",
  relationship_add: "relationship.add",
  relationship_remove: "relationship.remove",
  attribute_define: "attribute.define",
  attribute_create: "attribute.create",
  attribute_update: "attribute.update",
  expedition_update: "expedition.update",
  view_build: "view.build",
  view_inspect: "view.inspect",
  view_commit: "view.commit",
  source_read: "source.read",
  search_existing: "search_existing",
} as const

const MAX_SEGMENTS = 40

/**
 * The longest article a tool takes, in characters (about 7,000 words): far
 * past the longest "Write the article" length, so it only stops runaway
 * output. The app's article editor has no limit of its own.
 */
export const ARTICLE_MAX_CHARS = 50_000
/** The most sections an article written through a tool splits into. */
export const ARTICLE_MAX_SECTIONS = 40

export function createCuratorTools(opts: CuratorToolsOptions) {
  const stage = new StagingArea(opts.state, { nextOpId: opts.nextOpId })
  const newId = opts.newId ?? (() => ulid(Date.now()))
  const ports = { views: opts.views, sources: opts.sources }

  const write = <T extends object>(bodies: OpBody[], out: T): ToolResult<T> => {
    const r = stage.stage(bodies)
    return r.ok ? { ok: true, ...out } : r
  }

  const inspect = (viewId: string): Promise<ViewInspection> =>
    inspectView(stage.state, viewId, ports)

  /**
   * Commits the staged ops as one Change, with every View they create or
   * change (and any in `views`) marked ready. Refused, with nothing taken,
   * while one of those Views, or the Expedition, has problems.
   */
  async function commit(c: {
    label: string
    views?: string[]
  }): Promise<CommitResult> {
    const touched = new Set(c.views ?? [])
    for (const b of stage.staged)
      if (
        b.kind === "view.create" ||
        b.kind === "view.set" ||
        b.kind === "view.move"
      )
        touched.add(b.target)
    const viewIds = [...touched].filter((id) => isLive(stage.state.views[id]))
    const blocked: Extract<CommitResult, { ok: false }>["blocked"] = []
    const wide = checkExpedition(stage.state).filter(
      (f) => f.severity === "problem"
    )
    if (wide.length) blocked.push({ problems: wide })
    for (const id of viewIds) {
      const i = await inspect(id)
      if (!i.ok)
        blocked.push({ viewId: id, label: i.label, problems: i.problems })
    }
    for (const id of touched)
      if (!stage.state.views[id])
        blocked.push({
          viewId: id,
          problems: [
            {
              severity: "problem",
              code: "no-view",
              message: `View ${id} doesn't exist`,
            },
          ],
        })
    if (blocked.length) return { ok: false, blocked }

    const ready: OpBody[] = viewIds
      .filter((id) => stage.state.views[id]!.status !== "ready")
      .map((id) => ({
        kind: "view.set",
        target: id,
        path: "status",
        value: "ready",
      }))
    const r = stage.stage(ready)
    if (!r.ok) throw new Error(r.error) // a ready status is always valid
    const out: CuratorCommit = {
      label: c.label,
      bodies: stage.take(),
      views: viewIds,
    }
    await opts.onCommit?.(out)
    return { ok: true, ...out }
  }

  const tools = {
    concept_create: tool({
      description:
        "Create a Concept: one well-defined chunk of knowledge. Search first (search_existing) so you don't duplicate one; if the idea exists under another name, add that name as an alias instead. Short takeaway titles; quantities are Concepts of their own. Every Concept from a Source carries prov ({source, segment, quote?}; never invent segment ids); an empty prov means background knowledge. Returns the new id.",
      inputSchema: ConceptCreateValue,
      execute: async (value) => {
        const id = newId()
        return write([{ kind: "concept.create", target: id, value }], { id })
      },
    }),

    concept_update: tool({
      description:
        "Change a Concept's fields. Send only what changes; null unsets an optional field (an Attribute value too). addTags/removeTags edit its Tags. `article` replaces the Concept's whole article with markdown: `## ` headings start its sections, the text before the first is the introduction, and [title](#c/<id>) links other Concepts; null removes the article. Never pin weightPin on a guess about one reader.",
      inputSchema: ConceptUpdateInput,
      execute: async ({
        id,
        attributes,
        addTags,
        removeTags,
        article,
        ...fields
      }) => {
        if (!isLive(stage.state.concepts[id]))
          return { ok: false, error: `Concept ${id} not found` }
        const bodies: OpBody[] = []
        for (const [path, value] of Object.entries(fields))
          if (value !== undefined)
            bodies.push({ kind: "concept.set", target: id, path, value })
        for (const [attr, value] of Object.entries(attributes ?? {}))
          bodies.push({
            kind: "concept.set",
            target: id,
            path: `attributes.${attr}`,
            value,
          })
        for (const t of addTags ?? [])
          bodies.push({ kind: "concept.tag.add", target: id, value: t })
        for (const t of removeTags ?? [])
          bodies.push({ kind: "concept.tag.remove", target: id, value: t })
        if (article !== undefined) {
          const a = articleOps(stage.state, id, article, newId)
          if (!a.ok) return a
          bodies.push(...a.bodies)
        }
        if (!bodies.length)
          return {
            ok: false,
            error: "nothing to change: send at least one field",
          }
        return write(bodies, { id })
      },
    }),

    relationship_add: tool({
      description:
        "Link two Concepts: from → to with a Relationship Type (e.g. builtin:prerequisite, A is needed to understand B; builtin:part-of, child → its one parent; builtin:meets / builtin:partly-meets / builtin:fails, option → criterion, with the evidence as the note). Adding an existing link updates its note and prov.",
      inputSchema: z.strictObject({
        from: Id,
        type: Id,
        to: Id,
        note: z.string().optional(),
        prov: Prov.optional(),
      }),
      execute: async ({ from, type, to, note, prov }) =>
        write(
          [
            {
              kind: "relationship.add",
              target: relKey(from, type, to),
              value: {
                ...(note !== undefined && { note }),
                ...(prov && { prov }),
              },
            },
          ],
          {}
        ),
    }),

    relationship_remove: tool({
      description:
        "Remove a Relationship. To move a Concept under another parent, remove its old part-of and add the new one.",
      inputSchema: z.strictObject({ from: Id, type: Id, to: Id }),
      execute: async ({ from, type, to }) => {
        const key = relKey(from, type, to)
        if (!isLive(stage.state.relationships[key]))
          return {
            ok: false,
            error: `no Relationship ${from} -${type}-> ${to}`,
          }
        return write([{ kind: "relationship.remove", target: key }], {})
      },
    }),

    attribute_define: tool({
      description:
        "Define (or redefine) an Attribute: a typed field Concepts fill in (text, number, money, bool, or enum with its values listed low → high). Put numbers in Attributes, not prose. Criteria need a priority enum (hard / nice / dropped); a table's standing is an enum (chosen / in-play / ruled-out).",
      inputSchema: z
        .strictObject({ id: Id, ...AttributeDefineValue.shape })
        .refine((v) => v.type !== "enum" || (v.enumValues?.length ?? 0) > 0, {
          message: "an enum Attribute needs enumValues",
        }),
      execute: async ({ id, ...value }) =>
        write([{ kind: "attribute.define", target: id, value }], { id }),
    }),

    attribute_create: tool({
      description:
        "Create an Attribute: a typed field Concepts fill in (text, number, money, bool, or enum with its values listed low → high), e.g. `priority`, an enum of hard / nice / dropped, for criteria. Its id is how Concepts (attributes: {<id>: value}) and View settings name it, in this batch too. The type is fixed once created. Put numbers in Attributes, not prose.",
      inputSchema: AttributeCreateInput,
      execute: async ({ id, ...value }) => {
        const prev = stage.state.attributes[id]
        if (isLive(prev))
          return {
            ok: false,
            error: `Attribute ${id} already exists (${prev.type}); change it with attribute_update`,
          }
        if (prev && prev.type !== value.type)
          return {
            ok: false,
            error: `Attribute ${id} was a ${prev.type} Attribute and was removed; pick another id`,
          }
        return write([{ kind: "attribute.define", target: id, value }], { id })
      },
    }),

    attribute_update: tool({
      description:
        "Change an Attribute's label, unit or enum values (send only what changes; unit null removes it). Its type never changes. Removing an enum value is refused while a Concept still has it: change those Concepts first.",
      inputSchema: AttributeUpdateInput,
      execute: async ({ id, label, unit, enumValues }) => {
        const prev = stage.state.attributes[id]
        if (!prev || !isLive(prev))
          return {
            ok: false,
            error: `Attribute ${id} not found; create it with attribute_create`,
          }
        if (enumValues !== undefined && prev.type !== "enum")
          return {
            ok: false,
            error: `Attribute ${id} is ${prev.type}; only enum Attributes have values`,
          }
        if (enumValues) {
          const keep = new Set(enumValues)
          const using = Object.values(stage.state.concepts).filter((c) => {
            const v = c.attributes[id]
            return isLive(c) && typeof v === "string" && !keep.has(v)
          })
          if (using.length)
            return {
              ok: false,
              error: `${using.length === 1 ? "1 Concept has" : `${using.length} Concepts have`} a value this drops (${[...new Set(using.map((c) => c.attributes[id] as string))].join(", ")}): ${using
                .slice(0, 5)
                .map((c) => `${c.title} (${c.id})`)
                .join(
                  ", "
                )}${using.length > 5 ? ", …" : ""}. Change their values first.`,
            }
        }
        const { id: _id, deletedAt: _d, unit: oldUnit, ...rest } = prev
        void _id
        void _d
        const nextUnit = unit === undefined ? oldUnit : unit
        const value = {
          ...rest,
          ...(label !== undefined && { label }),
          ...(nextUnit != null && { unit: nextUnit }),
          ...(enumValues !== undefined && { enumValues }),
        }
        const same =
          value.label === prev.label &&
          (nextUnit ?? undefined) === (prev.unit ?? undefined) &&
          JSON.stringify(value.enumValues ?? null) ===
            JSON.stringify(prev.enumValues ?? null)
        if (same)
          return { ok: false, error: `nothing to change on Attribute ${id}` }
        return write([{ kind: "attribute.define", target: id, value }], { id })
      },
    }),

    expedition_update: tool({
      description:
        'Change the Expedition itself: its title, its summary (one or two sentences on what it covers; null or "" clears it) and its Tags (addTags/removeTags, without the #). Send only what changes.',
      inputSchema: ExpeditionUpdateInput,
      execute: async ({ title, summary, ...tags }) => {
        const exp = stage.state.expedition
        const addTags = tags.addTags?.map(bareTag).filter(Boolean)
        const removeTags = tags.removeTags?.map(bareTag).filter(Boolean)
        const bodies: OpBody[] = []
        if (title !== undefined && title !== exp.title)
          bodies.push({
            kind: "expedition.set",
            target: exp.id,
            path: "title",
            value: title,
          })
        if (summary !== undefined && (summary ?? "") !== (exp.summary ?? ""))
          bodies.push({
            kind: "expedition.set",
            target: exp.id,
            path: "summary",
            value: summary ?? "",
          })
        const has = new Set(exp.tags)
        const removing = new Set(removeTags ?? [])
        const missing = [...removing].filter((t) => !has.has(t))
        if (missing.length)
          return {
            ok: false,
            error: `the Expedition has no Tag ${missing.map((t) => `#${t}`).join(", ")}; its Tags: ${exp.tags.length ? exp.tags.map((t) => `#${t}`).join(" ") : "none"}`,
          }
        const both = (addTags ?? []).filter((t) => removing.has(t))
        if (both.length)
          return {
            ok: false,
            error: `#${both[0]} is both added and removed`,
          }
        for (const t of new Set(addTags ?? []))
          if (!has.has(t))
            bodies.push({
              kind: "expedition.tag.add",
              target: exp.id,
              value: t,
            })
        for (const t of removing)
          bodies.push({
            kind: "expedition.tag.remove",
            target: exp.id,
            value: t,
          })
        if (!bodies.length)
          return {
            ok: false,
            error: "nothing to change: the Expedition already reads like that",
          }
        return write(bodies, { id: exp.id })
      },
    }),

    view_build: tool({
      description:
        "Create a View, or with viewId change one: its View Type, label, question and settings in the View Type's shape, including the per-View overrides (placement, order, hide, fold). Shape the layout through settings and structure only; there are no positions. Then run view_inspect and fix every problem before the View can be committed.",
      inputSchema: ViewBuildInput,
      execute: async ({
        viewId,
        viewType,
        label,
        question,
        settings,
      }: ViewBuildInput) => {
        const existing = viewId ? stage.state.views[viewId] : undefined
        if (viewId && !isLive(existing))
          return { ok: false, error: `View ${viewId} not found` }
        if (existing) {
          if (existing.viewType !== viewType)
            return {
              ok: false,
              error: `View ${viewId} is a ${existing.viewType}; build a new View for a ${viewType}`,
            }
          return write(
            [
              {
                kind: "view.set",
                target: existing.id,
                path: "label",
                value: label,
              },
              {
                kind: "view.set",
                target: existing.id,
                path: "question",
                value: question ?? null,
              },
              {
                kind: "view.set",
                target: existing.id,
                path: "settings",
                value: settings,
              },
            ],
            { viewId: existing.id }
          )
        }
        const id = newId()
        const last = Object.values(stage.state.views)
          .map((v) => v.orderKey)
          .sort()
          .at(-1)
        return write(
          [
            {
              kind: "view.create",
              target: id,
              value: {
                viewType,
                label,
                ...(question !== undefined && { question }),
                orderKey: keysAfter(last ?? null, 1)[0]!,
                settings,
                settingsVersion: currentSettingsVersion(viewType),
                status: "building",
              },
            },
          ],
          { viewId: id }
        )
      },
    }),

    view_inspect: tool({
      description:
        "See a View as a reader would (the table with its cells and priorities, the outline tree, the outcome with its causes and levers, the paths to targets), with its checks and, for canvas Views, its layout metrics. ok: false lists the problems that block its commit; warnings are worth a look. Fix layout by reshaping structure (targets, placement, fewer cross-topic links, one parent each), never positions.",
      inputSchema: z.strictObject({ viewId: Id }),
      execute: async ({ viewId }) => inspect(viewId),
    }),

    source_read: tool({
      description: `Read segments of a Source by id (t14 = chat turn 14, s3 = section 3), up to ${MAX_SEGMENTS} at a time: to check a fact, a verdict or a quote, or to find what the reader decided. Chat turns say who spoke: "user" is the reader.`,
      inputSchema: z.strictObject({
        source: Id,
        segments: z.array(z.string().min(1)).min(1).max(MAX_SEGMENTS),
      }),
      execute: async ({
        source,
        segments,
      }): Promise<ToolResult<{ segments: Segment[]; missing: string[] }>> => {
        if (!opts.sources)
          return { ok: false, error: "no Sources can be read here" }
        if (!stage.state.sources[source])
          return { ok: false, error: `Source ${source} not found` }
        const read = await opts.sources.read(source, segments)
        const found = new Set(read.map((s) => s.id))
        return {
          ok: true,
          segments: read,
          missing: segments.filter((id) => !found.has(id)),
        }
      },
    }),

    search_existing: tool({
      description:
        "Find existing Concepts by title or alias (case, accents, punctuation and a leading article ignored), best matches first. Use it before creating a Concept.",
      inputSchema: z.strictObject({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ query, limit }): Promise<{ hits: SearchHit[] }> => ({
        hits: searchExisting(stage.state, query, limit),
      }),
    }),
  }

  const commitTool = {
    view_commit: tool({
      description:
        "Commit a View, with everything staged since the last commit, as one Change. Refused while view_inspect reports problems; the reply lists them.",
      inputSchema: z.strictObject({
        viewId: Id,
        label: z.string().min(1).optional(),
      }),
      execute: async ({ viewId, label }) =>
        commit({
          label:
            label ?? `Built ${stage.state.views[viewId]?.label ?? "a View"}`,
          views: [viewId],
        }),
    }),
  }

  return {
    /** `view_commit` is there only with `onCommit`. */
    tools: (opts.onCommit
      ? { ...tools, ...commitTool }
      : tools) as typeof tools & Partial<typeof commitTool>,
    stage,
    inspect,
    commit,
  }
}

export type CuratorToolSet = ReturnType<typeof createCuratorTools>

/**
 * A tool whose input is parsed before it runs, whoever calls it (AI SDK
 * validates too; MCP and tests may not): a bad input comes back as
 * `{ ok: false, error }`, which the model reads and corrects.
 */
function tool<S extends z.ZodType, O>(t: {
  description: string
  inputSchema: S
  execute: (input: z.output<S>) => Promise<O>
}): CuratorTool<z.output<S>, O | { ok: false; error: string }> {
  return {
    description: t.description,
    inputSchema: t.inputSchema as z.ZodType<z.output<S>>,
    execute: async (input) => {
      const parsed = t.inputSchema.safeParse(input)
      if (!parsed.success)
        return {
          ok: false,
          error: parsed.error.issues
            .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
            .join("; "),
        }
      return t.execute(parsed.data)
    },
  }
}

/**
 * The ops that make `md` a Concept's whole article (null: no article): its
 * live sections are deleted and the markdown, split at `## ` headings, is
 * created as new ones (background knowledge: `prov: []`). The same article
 * again is refused as nothing to change.
 */
export function articleOps(
  state: DomainState,
  conceptId: string,
  md: string | null,
  newId: () => string
): { ok: true; bodies: OpBody[] } | { ok: false; error: string } {
  const live = Object.values(state.sections)
    .filter((s) => isLive(s) && s.conceptId === conceptId)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))
  const next = md === null ? [] : splitArticle(md)
  if (md !== null && !next.length)
    return {
      ok: false,
      error: "article: empty; send null to remove the article",
    }
  if (next.length > ARTICLE_MAX_SECTIONS)
    return {
      ok: false,
      error: `article: ${next.length} sections; at most ${ARTICLE_MAX_SECTIONS}`,
    }
  const same =
    live.length === next.length &&
    live.every((s, i) => s.heading === next[i]!.heading && s.md === next[i]!.md)
  if (same)
    return {
      ok: false,
      error:
        md === null
          ? "article: the Concept has no article"
          : "article: unchanged",
    }
  const keys = keysAfter(null, next.length)
  return {
    ok: true,
    bodies: [
      ...live.map((s): OpBody => ({ kind: "section.delete", target: s.id })),
      ...next.map((s, i): OpBody => ({
        kind: "section.create",
        target: newId(),
        value: {
          conceptId,
          orderKey: keys[i]!,
          heading: s.heading,
          md: s.md,
          prov: [],
        },
      })),
    ],
  }
}

const Tag = z.string().trim().min(1).max(60)
/** A Tag as stored: no leading #. */
const bareTag = (t: string) => t.replace(/^#+/, "").trim()

const AttributeCreateInput = z
  .strictObject({ id: Id, ...AttributeDefineValue.shape })
  .refine((v) => v.type !== "enum" || (v.enumValues?.length ?? 0) > 0, {
    message: "an enum Attribute needs enumValues",
  })
  .refine((v) => v.type === "enum" || v.enumValues === undefined, {
    message: "only enum Attributes have enumValues",
  })

const AttributeUpdateInput = z.strictObject(
  {
    id: Id,
    label: z.string().min(1).optional(),
    unit: z.string().nullable().optional(),
    enumValues: z.array(z.string().min(1)).min(1).optional(),
  },
  {
    error: (iss) =>
      iss.code === "unrecognized_keys" && iss.keys.includes("type")
        ? "an Attribute's type is fixed at creation and can't be changed"
        : undefined,
  }
)

const ExpeditionUpdateInput = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  addTags: z.array(Tag).max(20).optional(),
  removeTags: z.array(Tag).max(20).optional(),
})

// concept.update: every settable Concept field (the domain's CONCEPT_FIELDS),
// optional; null unsets the optional ones. Attributes by id.
const unset = <S extends z.ZodType>(s: S) => s.nullable().optional()
const ConceptUpdateInput = z.strictObject({
  id: Id,
  title: CONCEPT_FIELDS.title.optional(),
  aliases: CONCEPT_FIELDS.aliases.optional(),
  kind: CONCEPT_FIELDS.kind.optional(),
  prov: CONCEPT_FIELDS.prov.optional(),
  overviewProv: CONCEPT_FIELDS.overviewProv.optional(),
  summary: unset(z.string()),
  overview: unset(z.string()),
  date: unset(DateString),
  dateEnd: unset(DateEnd),
  dateApprox: unset(z.boolean()),
  lane: unset(z.string()),
  lat: unset(z.number().min(-90).max(90)),
  lon: unset(z.number().min(-180).max(180)),
  weightPin: unset(WeightPin),
  attributes: z.record(Id, AttributeValue.nullable()).optional(),
  addTags: z.array(z.string().trim().min(1)).optional(),
  removeTags: z.array(z.string().trim().min(1)).optional(),
  article: unset(z.string().max(ARTICLE_MAX_CHARS)),
})

// view.build: one variant per View Type, each with that type's settings schema.
type ViewBuildInput = {
  viewId?: string
  viewType: ViewTypeId
  label: string
  question?: string
  settings: Record<string, unknown>
}
const ViewBuildInput = z.discriminatedUnion(
  "viewType",
  VIEW_TYPE_IDS.map((t) =>
    z.strictObject({
      viewType: z.literal(t),
      viewId: Id.optional(),
      label: z.string().min(1),
      question: z.string().optional(),
      settings: VIEW_TYPES[t].shared,
    })
  ) as unknown as [z.ZodObject, ...z.ZodObject[]]
) as unknown as z.ZodType<ViewBuildInput>
