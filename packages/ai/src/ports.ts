// The two things the curator tools read from outside `@seply/domain`, as
// ports the composing app fills (spec §5.3). They keep this package free of
// `@seply/views` (dependency rule) and of Source storage (WP-3.1).
import type { DomainState } from "@seply/domain"

/** One addressable piece of a Source (spec §5.2): a chat turn, a page, a section. */
export type Segment = {
  /** "t14" (chat turn 14), "s3" (document section 3), "p2" (page 2) … */
  id: string
  /** Chat turns only: who said it. The reader is "user". */
  speaker?: "user" | "assistant"
  heading?: string
  text: string
}

/** Reads a Source's normalized segments. WP-3.1's segment storage implements it. */
export type SourceReader = {
  /**
   * The segments asked for, in the order asked. Ids that don't exist are left
   * out (the tool reports them). An unknown Source reads as no segments.
   */
  read(sourceId: string, segmentIds: readonly string[]): Promise<Segment[]>
}

/** An in-memory SourceReader: tests, and anything that already holds the segments. */
export function memorySourceReader(
  sources: Record<string, readonly Segment[]>
): SourceReader {
  return {
    async read(sourceId, segmentIds) {
      const byId = new Map((sources[sourceId] ?? []).map((s) => [s.id, s]))
      return segmentIds.flatMap((id) => {
        const s = byId.get(id)
        return s ? [s] : []
      })
    },
  }
}

/**
 * Layout quality of a canvas View as a reader first sees it (spec §4.4).
 * The same shape as `@seply/views`' `LayoutMetrics`.
 */
export type LayoutReport = {
  shown: number
  edges: number
  crossings: number
  edgesThroughNodes: number
  veryLongEdges: number
  overlaps: number
  crossTopic?: number
  verdict: "reads well" | "cluttered"
}

/** What a reader would see in one View, from the real renderers. */
export type ViewReading = {
  /** The View as text: table cells with priorities, the outline tree, the outcome with its causes and levers, … */
  text: string
  /** Canvas Views only. */
  layout?: LayoutReport
}

/**
 * Renders a View the way a reader sees it. `@seply/views/inspect`'s
 * `readView` implements it; the app that runs the curator job wires it in.
 * `state` is `@seply/domain`'s `DomainState` (staged edits applied).
 */
export type ViewReader = {
  read(state: DomainState, viewId: string): Promise<ViewReading>
}
