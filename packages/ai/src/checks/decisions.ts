// "chosen only with a cited reader decision, never assistant advice"
// (spec §5.3): whether a Concept's provenance shows the reader deciding.
import { isLive, type DomainState, type ProvRef } from "@seply/domain"
import type { SourceReader } from "../ports.ts"
import { liveRelationships, named } from "./common.ts"

export type Citation = {
  ref: ProvRef
  /** Who said it: the reader, the assistant, or unknown (a document, a missing segment). */
  by: "reader" | "assistant" | "unknown"
}

/**
 * The provenance that can show a decision about a Concept: its own, and that
 * of `decision` Concepts linked to it (and those links).
 */
export function decisionRefs(s: DomainState, conceptId: string): ProvRef[] {
  const refs = [...(s.concepts[conceptId]?.prov ?? [])]
  for (const r of liveRelationships(s)) {
    if (r.from !== conceptId && r.to !== conceptId) continue
    const other = s.concepts[r.from === conceptId ? r.to : r.from]
    if (!isLive(other) || named(other.kind) !== "decision") continue
    refs.push(...r.prov, ...other.prov)
  }
  return refs
}

/**
 * Who each ref cites. A prompt Source is the reader's own words; a chat
 * segment is theirs when its speaker is "user"; anything else is unknown.
 */
export async function whoSaid(
  s: DomainState,
  refs: readonly ProvRef[],
  sources: SourceReader | undefined
): Promise<Citation[]> {
  const bySource = new Map<string, string[]>()
  for (const r of refs)
    bySource.set(r.source, [...(bySource.get(r.source) ?? []), r.segment])
  const speaker = new Map<string, "reader" | "assistant" | "unknown">()
  for (const [source, segs] of bySource) {
    const kind = s.sources[source]?.kind
    const read = sources ? await sources.read(source, [...new Set(segs)]) : []
    for (const seg of read) {
      const by =
        kind === "prompt" || seg.speaker === "user"
          ? "reader"
          : seg.speaker === "assistant"
            ? "assistant"
            : "unknown"
      speaker.set(`${source}|${seg.id}`, by)
    }
  }
  return refs.map((ref) => ({
    ref,
    by: speaker.get(`${ref.source}|${ref.segment}`) ?? "unknown",
  }))
}
