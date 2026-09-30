// The checks `view.inspect` runs (spec §5.3), ported from the prototype's
// `validate.py`. The layout metrics come from the ViewReader (see inspect.ts).
import { isLive, parseSharedSettings, type DomainState } from "@seply/domain"
import type { SourceReader } from "../ports.ts"
import { checkCauseAndEffect } from "./cause-and-effect.ts"
import { checkComparisonTable } from "./comparison-table.ts"
import { problem, type Finding } from "./common.ts"
import { checkExpedition, checkOneParent, checkRefs } from "./structure.ts"

export { type Finding } from "./common.ts"
export { checkExpedition } from "./structure.ts"
export { MIN_FILL, MIN_ROWS } from "./comparison-table.ts"

/**
 * Every structure check for one View: Expedition-wide problems (a dangling
 * Relationship breaks every View), the View's own references and one-parent
 * rule, and its View Type's rules.
 */
export async function checkView(
  s: DomainState,
  viewId: string,
  opts: { sources?: SourceReader } = {}
): Promise<Finding[]> {
  const view = s.views[viewId]
  if (!isLive(view)) return [problem("no-view", `View ${viewId} doesn't exist`)]
  const parsed = parseSharedSettings(view.viewType, view.settings)
  if (!parsed.success)
    return [
      problem(
        "settings",
        `'${view.label}' settings don't fit ${view.viewType}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      ),
    ]
  const out = [
    ...checkExpedition(s).filter((f) => f.severity === "problem"),
    ...checkRefs(s, view),
    ...checkOneParent(s, view),
  ]
  // A View whose references don't resolve can't be read further.
  if (out.some((f) => f.code === "dangling-ref")) return out
  if (view.viewType === "comparison-table")
    out.push(...(await checkComparisonTable(s, view, opts.sources)))
  if (view.viewType === "cause-and-effect")
    out.push(...(await checkCauseAndEffect(s, view, opts.sources)))
  return out
}
