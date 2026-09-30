// `view.inspect` (spec §5.3): what a reader would see in a View, plus the
// checks. A View with problems can't be committed.
import type { DomainState } from "@seply/domain"
import { checkView, type Finding } from "./checks/index.ts"
import { problem } from "./checks/common.ts"
import type { LayoutReport, SourceReader, ViewReader } from "./ports.ts"

export type ViewInspection = {
  viewId: string
  label: string
  viewType: string
  /** The View as the reader sees it (from the ViewReader). */
  reading: string
  /** Canvas Views only: the layout metrics (spec §4.4). */
  layout?: LayoutReport
  /** Must be fixed before the View can be committed. */
  problems: Finding[]
  /** Worth a look; they don't block. */
  warnings: Finding[]
  /** No problems: the View can be committed. */
  ok: boolean
}

export async function inspectView(
  state: DomainState,
  viewId: string,
  ports: { views: ViewReader; sources?: SourceReader }
): Promise<ViewInspection> {
  const view = state.views[viewId]
  const findings = await checkView(state, viewId, { sources: ports.sources })
  let reading = ""
  let layout: LayoutReport | undefined
  if (
    view &&
    !findings.some((f) => f.code === "no-view" || f.code === "settings")
  ) {
    try {
      const r = await ports.views.read(state, viewId)
      reading = r.text
      layout = r.layout
      if (layout?.verdict === "cluttered") findings.push(layoutProblem(layout))
    } catch (e) {
      // A View the renderer can't draw is a problem to fix, not a crash.
      findings.push(
        problem(
          "reading",
          `the View can't be drawn: ${e instanceof Error ? e.message : String(e)}`
        )
      )
    }
  }
  const problems = findings.filter((f) => f.severity === "problem")
  return {
    viewId,
    label: view?.label ?? "",
    viewType: view?.viewType ?? "",
    reading,
    ...(layout && { layout }),
    problems,
    warnings: findings.filter((f) => f.severity === "warning"),
    ok: problems.length === 0,
  }
}

/** Thresholds as in `@seply/views` (spec §4.4), for the message only: the verdict is the reader's. */
function layoutProblem(m: LayoutReport): Finding {
  const parts = [
    `${m.crossings} crossings of ${m.edges} edges (at most 20%)`,
    `${m.edgesThroughNodes} edges drawn through other Concepts (at most 10%)`,
    `${m.overlaps} overlapping Concepts (none)`,
    ...(m.crossTopic !== undefined
      ? [`${m.crossTopic} prerequisites cross topics`]
      : []),
  ]
  return problem(
    "layout",
    `cluttered: ${parts.join(", ")}. Reshape the structure: fewer cross-topic prerequisites, one parent each, levers aimed at one stage, placement or targets. Never positions`
  )
}
