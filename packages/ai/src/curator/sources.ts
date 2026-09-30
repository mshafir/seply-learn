// The Sources as the curator reads them (spec §5.2): the whole set in its
// context when it fits, else consecutive chunks of segments. Every segment is
// shown with its id, so provenance can cite it.
import type { ProviderId } from "../models.ts"
import type { Segment } from "../ports.ts"
import { estimateTokens } from "../tokens.ts"

/** One Source with its segments, as the job loads it. */
export type CuratorSource = {
  id: string
  title: string
  segments: readonly Segment[]
}

/**
 * The most Source tokens the curator reads at once. Above it the Concept set
 * is built chunk by chunk and merged. It leaves room for the playbook and the
 * tool loop in a 200k-token window, the smallest of the default curator
 * models' windows.
 */
export const WHOLE_SOURCE_MAX_TOKENS = 150_000
/** A chunk's size in chunk mode. */
export const CHUNK_TOKENS = 40_000

/** One segment as the model sees it: `[t14 · user]`, `[s3 · How it works]`. */
function segmentLine(s: Segment): string {
  const tag = [s.id, s.speaker, s.speaker ? undefined : s.heading]
    .filter(Boolean)
    .join(" · ")
  return `[${tag}]\n${s.text.trim()}`
}

/** Sources (or a part of them) as text, each in its own tagged block. */
export function renderSources(
  sources: readonly CuratorSource[],
  only?: ReadonlyMap<string, ReadonlySet<string>>
): string {
  return sources
    .map((src) => {
      const keep = only?.get(src.id)
      if (only && !keep) return null
      const segs = keep
        ? src.segments.filter((s) => keep.has(s.id))
        : src.segments
      return [
        `<source id="${src.id}" title="${escapeAttr(src.title)}">`,
        ...segs.map(segmentLine),
        `</source>`,
      ].join("\n\n")
    })
    .filter((s): s is string => s !== null)
    .join("\n\n")
}

/**
 * The Sources as an index (ids, speakers, headings and each segment's first
 * words), for Views built in chunk mode: the agent reads what it needs with
 * `source_read`.
 */
export function renderSourceIndex(sources: readonly CuratorSource[]): string {
  return sources
    .map((src) =>
      [
        `<source-index id="${src.id}" title="${escapeAttr(src.title)}">`,
        ...src.segments.map((s) => {
          const who = s.speaker ?? s.heading ?? ""
          const words = s.text.replace(/\s+/g, " ").trim().slice(0, 100)
          return `${s.id}${who ? ` · ${who}` : ""}: ${words}${s.text.length > 100 ? "…" : ""}`
        }),
        `</source-index>`,
      ].join("\n")
    )
    .join("\n\n")
}

const escapeAttr = (s: string) => s.replace(/"/g, "'")

export type SourcePlan =
  | { mode: "whole"; tokens: number }
  | {
      mode: "chunks"
      tokens: number
      /** Each chunk: consecutive segments, by Source id. */
      chunks: { source: string; segments: string[] }[][]
    }

/**
 * Whole or chunked: the whole set when its estimated tokens fit under
 * `maxTokens`, else chunks of consecutive segments of about `chunkTokens`
 * (a Source boundary may fall inside a chunk; a segment is never split).
 */
export function planSources(
  sources: readonly CuratorSource[],
  model: { provider: ProviderId | string; modelId: string },
  opts: { maxTokens?: number; chunkTokens?: number } = {}
): SourcePlan {
  const maxTokens = opts.maxTokens ?? WHOLE_SOURCE_MAX_TOKENS
  const chunkTokens = opts.chunkTokens ?? CHUNK_TOKENS
  const tokensOf = (text: string) =>
    estimateTokens(text, model.provider as ProviderId, model.modelId)
  const tokens = tokensOf(renderSources(sources))
  if (tokens <= maxTokens) return { mode: "whole", tokens }

  const chunks: { source: string; segments: string[] }[][] = []
  let chunk: { source: string; segments: string[] }[] = []
  let size = 0
  for (const src of sources) {
    for (const s of src.segments) {
      const t = tokensOf(segmentLine(s))
      if (size > 0 && size + t > chunkTokens) {
        chunks.push(chunk)
        chunk = []
        size = 0
      }
      const last = chunk.at(-1)
      if (last?.source === src.id) last.segments.push(s.id)
      else chunk.push({ source: src.id, segments: [s.id] })
      size += t
    }
  }
  if (chunk.length) chunks.push(chunk)
  return { mode: "chunks", tokens, chunks }
}

/** A chunk as the `only` filter `renderSources` takes. */
export function chunkFilter(
  chunk: readonly { source: string; segments: readonly string[] }[]
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const part of chunk) {
    const set = m.get(part.source) ?? new Set<string>()
    for (const id of part.segments) set.add(id)
    m.set(part.source, set)
  }
  return m
}
