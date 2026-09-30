// A synthetic decision chat, written for these tests: a household choosing a
// 3D printer. No real people or chats. Segments as WP-3.1 will store them.
import { emptyState, type DomainState } from "@seply/domain"
import { memorySourceReader, type Segment, type ViewReader } from "../ports.ts"
import { createCuratorTools, type CuratorToolsOptions } from "../tools.ts"

export const CHAT: Segment[] = [
  {
    id: "t1",
    speaker: "user",
    text: "We want a 3D printer for the kids. It has to be enclosed, and multicolour would be nice.",
  },
  {
    id: "t2",
    speaker: "assistant",
    text: "I'd go with the Orbit P2: enclosed, and every enclosed printer here runs ABS.",
  },
  {
    id: "t3",
    speaker: "user",
    text: "OK, we ordered the Orbit P2 this morning.",
  },
  {
    id: "t4",
    speaker: "assistant",
    text: "The Kite has no enclosure; the Box S1 is enclosed but single colour.",
  },
]

/** A ViewReader stand-in: a fixed reading, with a layout verdict the test sets. */
export function stubViewReader(layout?: {
  verdict: "reads well" | "cluttered"
}): ViewReader & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async read(state, viewId) {
      calls.push(viewId)
      const v = state.views[viewId]!
      return {
        text: `${v.label} (${v.viewType})`,
        ...(layout && {
          layout: {
            shown: 4,
            edges: 4,
            crossings: layout.verdict === "cluttered" ? 3 : 0,
            edgesThroughNodes: 0,
            veryLongEdges: 0,
            overlaps: 0,
            verdict: layout.verdict,
          },
        }),
      }
    },
  }
}

/** A fresh Expedition with the chat as its Source, and tools over it. Ids are "n0", "n1", … */
export function printerTools(opts: Partial<CuratorToolsOptions> = {}) {
  const base: DomainState = {
    ...emptyState("e1", "Which printer?"),
    sources: {
      chat: {
        id: "chat",
        kind: "chat",
        title: "Printer chat",
        addedBy: "u",
        addedAt: "2026-09-01T00:00:00.000Z",
      },
    },
  }
  let n = 0
  return createCuratorTools({
    state: base,
    views: stubViewReader(),
    sources: memorySourceReader({ chat: CHAT }),
    newId: () => `n${n++}`,
    ...opts,
  })
}
