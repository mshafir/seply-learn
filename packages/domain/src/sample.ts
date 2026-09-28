// Converter from the prototype sample-graph format
// (prototypes/sample-graphs/src/lib/types.ts) into domain ops, one import
// Change. Pure: the caller reads the JSON.
import { z } from "zod"
import { applyAll } from "./apply.ts"
import {
  BUILTIN_KIND_BY_ID,
  BUILTIN_REL_TYPE_BY_ID,
  builtinId,
} from "./builtins.ts"
import { PALETTE, type PaletteColor } from "./common.ts"
import type { ChangeMeta } from "./history.ts"
import { makeOps, type Op, type OpBody } from "./ops.ts"
import { keysAfter } from "./order-key.ts"
import { emptyState, relKey, type DomainState } from "./state.ts"
import { VIEW_TYPES, ViewTypeId } from "./view-types.ts"

const SampleProv = z.array(
  z.object({
    source: z.string(),
    segment: z.string(),
    quote: z.string().optional(),
  })
)

export const SampleGraph = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  source: z.object({
    kind: z.enum(["claude-chat", "doc"]),
    url: z.string().optional(),
    dates: z.string().optional(),
  }),
  kinds: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      color: z.string(),
      icon: z.string().optional(),
    })
  ),
  relationshipTypes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      inverseLabel: z.string().optional(),
      color: z.string(),
      dashed: z.boolean().optional(),
    })
  ),
  attributes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        type: z.enum(["text", "number", "money", "bool", "enum"]),
        unit: z.string().optional(),
        values: z.array(z.string()).optional(),
      })
    )
    .optional(),
  concepts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.string(),
      aliases: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      summary: z.string().optional(),
      body: z.string().optional(),
      overview: z.string().optional(),
      article: z.string().optional(),
      date: z.string().optional(),
      dateEnd: z.string().optional(),
      dateApprox: z.boolean().optional(),
      lane: z.string().optional(),
      order: z.number().optional(),
      seq: z.number().optional(),
      weight: z.enum(["core", "aux"]).optional(),
      attributes: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
      geo: z.tuple([z.number(), z.number()]).optional(),
      prov: SampleProv.optional(),
    })
  ),
  relationships: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string(),
      note: z.string().optional(),
      prov: SampleProv.optional(),
    })
  ),
  views: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      viewType: ViewTypeId,
      description: z.string().optional(),
      question: z.string().optional(),
      settings: z.record(z.string(), z.unknown()),
    })
  ),
})
export type SampleGraph = z.infer<typeof SampleGraph>

// Tailwind-600-ish anchors for mapping the prototype's hex colours to palette names.
const PALETTE_HEX: Record<PaletteColor, string> = {
  blue: "#2563eb",
  teal: "#0d9488",
  green: "#16a34a",
  amber: "#d97706",
  orange: "#ea580c",
  red: "#dc2626",
  pink: "#db2777",
  violet: "#7c3aed",
  indigo: "#4f46e5",
  slate: "#64748b",
  brown: "#92400e",
  olive: "#65a30d",
}
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** The nearest palette name to a hex colour (palette names pass through). */
export function nearestPaletteColor(color: string): PaletteColor {
  if ((PALETTE as readonly string[]).includes(color))
    return color as PaletteColor
  const [r, g, b] = rgb(color)
  let best: PaletteColor = "slate"
  let bestD = Infinity
  for (const name of PALETTE) {
    const [pr, pg, pb] = rgb(PALETTE_HEX[name])
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (d < bestD) [best, bestD] = [name, d]
  }
  return best
}

/** Splits a markdown article into sections at `## ` headings (the lead has no heading). */
export function splitArticle(md: string): { heading: string; md: string }[] {
  const out: { heading: string; md: string }[] = []
  let cur = { heading: "", lines: [] as string[] }
  const flush = () => {
    const text = cur.lines.join("\n").trim()
    if (text || cur.heading) out.push({ heading: cur.heading, md: text })
  }
  for (const line of md.split("\n")) {
    const m = /^## (.*)$/.exec(line)
    if (m) {
      flush()
      cur = { heading: m[1].trim(), lines: [] }
    } else cur.lines.push(line)
  }
  flush()
  return out
}

function mapPath(
  obj: Record<string, unknown>,
  path: string,
  fn: (id: string) => string
) {
  const segs = path.split(".")
  let cur: Record<string, unknown> | undefined = obj
  for (const s of segs.slice(0, -1))
    cur = cur?.[s] as Record<string, unknown> | undefined
  const last = segs[segs.length - 1]
  if (!cur || cur[last] === undefined) return
  const v = cur[last]
  cur[last] = Array.isArray(v) ? v.map((x) => fn(String(x))) : fn(String(v))
}

export type ConvertOptions = {
  expeditionId: string
  actor: string
  changeId: string
  /** ULID source for op ids. */
  nextOpId: () => string
  /** ISO time the import happened. */
  at: string
}

/** The op bodies that build a sample graph as a first build. */
export function sampleToOpBodies(
  input: unknown,
  opts: Pick<ConvertOptions, "expeditionId" | "actor" | "at">
): OpBody[] {
  const g = SampleGraph.parse(input)
  const ops: OpBody[] = []
  const exp = opts.expeditionId

  ops.push({
    kind: "expedition.set",
    target: exp,
    path: "title",
    value: g.title,
  })
  ops.push({
    kind: "expedition.set",
    target: exp,
    path: "summary",
    value: g.summary,
  })

  const sourceId = `${g.id}-source`
  ops.push({
    kind: "source.add",
    target: sourceId,
    value: {
      kind: g.source.kind === "claude-chat" ? "chat" : "file",
      title: g.source.url ?? g.title,
      addedBy: opts.actor,
      addedAt: opts.at,
    },
  })

  const kindId = new Map<string, string>()
  for (const k of g.kinds) {
    if (BUILTIN_KIND_BY_ID.has(builtinId(k.id)))
      kindId.set(k.id, builtinId(k.id))
    else {
      kindId.set(k.id, k.id)
      ops.push({
        kind: "kind.define",
        target: k.id,
        value: {
          label: k.label,
          color: nearestPaletteColor(k.color),
          ...(k.icon ? { icon: k.icon } : {}),
        },
      })
    }
  }
  const relTypeId = new Map<string, string>()
  for (const t of g.relationshipTypes) {
    if (BUILTIN_REL_TYPE_BY_ID.has(builtinId(t.id)))
      relTypeId.set(t.id, builtinId(t.id))
    else {
      relTypeId.set(t.id, t.id)
      ops.push({
        kind: "reltype.define",
        target: t.id,
        value: {
          label: t.label,
          inverseLabel: t.inverseLabel ?? t.label,
          color: nearestPaletteColor(t.color),
          dashed: t.dashed ?? false,
        },
      })
    }
  }
  const mapKind = (id: string) =>
    kindId.get(id) ??
    (BUILTIN_KIND_BY_ID.has(builtinId(id)) ? builtinId(id) : id)
  const mapRelType = (id: string) =>
    relTypeId.get(id) ??
    (BUILTIN_REL_TYPE_BY_ID.has(builtinId(id)) ? builtinId(id) : id)

  for (const a of g.attributes ?? []) {
    ops.push({
      kind: "attribute.define",
      target: a.id,
      value: {
        label: a.label,
        type: a.type,
        ...(a.unit ? { unit: a.unit } : {}),
        ...(a.values ? { enumValues: a.values } : {}),
      },
    })
  }

  for (const c of g.concepts) {
    const overview = c.overview ?? c.body
    ops.push({
      kind: "concept.create",
      target: c.id,
      value: {
        title: c.title,
        kind: mapKind(c.kind),
        ...(c.aliases ? { aliases: c.aliases } : {}),
        ...(c.tags ? { tags: c.tags } : {}),
        ...(c.summary !== undefined ? { summary: c.summary } : {}),
        ...(overview !== undefined ? { overview } : {}),
        ...(c.attributes ? { attributes: c.attributes } : {}),
        ...(c.date ? { date: c.date } : {}),
        ...(c.dateEnd ? { dateEnd: c.dateEnd } : {}),
        ...(c.dateApprox !== undefined ? { dateApprox: c.dateApprox } : {}),
        ...(c.lane ? { lane: c.lane } : {}),
        ...(c.geo ? { lat: c.geo[0], lon: c.geo[1] } : {}),
        ...(c.weight ? { weightPin: c.weight } : {}),
        prov: c.prov ?? [],
      },
    })
    if (c.article) {
      const sections = splitArticle(c.article)
      const keys = keysAfter(null, sections.length)
      sections.forEach((s, i) =>
        ops.push({
          kind: "section.create",
          target: `${c.id}~s${i}`,
          value: {
            conceptId: c.id,
            orderKey: keys[i],
            heading: s.heading,
            md: s.md,
            prov: [],
          },
        })
      )
    }
  }

  for (const r of g.relationships) {
    ops.push({
      kind: "relationship.add",
      target: relKey(r.from, mapRelType(r.type), r.to),
      value: { ...(r.note ? { note: r.note } : {}), prov: r.prov ?? [] },
    })
  }

  const viewKeys = keysAfter(null, g.views.length)
  g.views.forEach((v, i) => {
    const settings = structuredClone(v.settings)
    const refs = VIEW_TYPES[v.viewType].refs
    for (const p of refs.relTypes) mapPath(settings, p, mapRelType)
    for (const p of refs.kinds) mapPath(settings, p, mapKind)

    // The prototype's fold-by-Relationship-Type becomes the explicit fold map.
    if (v.viewType === "cause-and-effect" && Array.isArray(settings.fold)) {
      const types = new Set((settings.fold as string[]).map(String))
      const fold: Record<string, string[]> = {}
      for (const r of g.relationships)
        if (types.has(r.type)) (fold[r.to] ??= []).push(r.from)
      settings.fold = fold
    }
    // An outline's sibling order comes from `seq`; order is per View now.
    if (v.viewType === "outline") {
      const types = new Set(settings.relationshipTypes as string[])
      const seq = new Map(
        g.concepts.filter((c) => c.seq !== undefined).map((c) => [c.id, c.seq!])
      )
      const children = new Map<string, string[]>()
      for (const r of g.relationships) {
        if (types.has(mapRelType(r.type)) && seq.has(r.from)) {
          if (!children.has(r.to)) children.set(r.to, [])
          children.get(r.to)!.push(r.from)
        }
      }
      const order: Record<string, string[]> = {}
      for (const [parent, kids] of children) {
        if (kids.length > 1)
          order[parent] = [...kids].sort((a, b) => seq.get(a)! - seq.get(b)!)
      }
      if (Object.keys(order).length) settings.order = order
    }

    const question = v.question ?? v.description
    ops.push({
      kind: "view.create",
      target: v.id,
      value: {
        viewType: v.viewType,
        label: v.label,
        ...(question ? { question } : {}),
        orderKey: viewKeys[i],
        settings,
        settingsVersion: VIEW_TYPES[v.viewType].version,
        status: "ready",
      },
    })
  })

  if (g.views.length)
    ops.push({
      kind: "expedition.set",
      target: exp,
      path: "bestViewId",
      value: g.views[0].id,
    })
  ops.push({
    kind: "expedition.set",
    target: exp,
    path: "status",
    value: "ready",
  })
  return ops
}

/** Converts a sample graph into one import Change and the state it builds. */
export function sampleToState(
  input: unknown,
  opts: ConvertOptions
): { state: DomainState; ops: Op[]; change: ChangeMeta } {
  const bodies = sampleToOpBodies(input, opts)
  const ops = makeOps(bodies, opts)
  const state = applyAll(emptyState(opts.expeditionId), ops)
  const change: ChangeMeta = {
    id: opts.changeId,
    expeditionId: opts.expeditionId,
    author: opts.actor,
    origin: "import",
    label: "Imported from file",
    at: opts.at,
  }
  return { state, ops, change }
}
