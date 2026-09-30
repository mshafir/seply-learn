// Cause & Effect checks (spec §5.3; the prototype's validate.py, and the
// build-view playbook: the outcome in the reader's words, no lever→lever
// links, build steps folded explicitly).
import type { DomainState, SharedSettings, View } from "@seply/domain"
import type { SourceReader } from "../ports.ts"
import {
  isType,
  liveConcepts,
  liveRelationships,
  matchesFilter,
  PART_OF,
  problem,
  quoted,
  titleOf,
  warning,
  type Finding,
} from "./common.ts"
import { whoSaid } from "./decisions.ts"

export async function checkCauseAndEffect(
  s: DomainState,
  view: View,
  sources: SourceReader | undefined
): Promise<Finding[]> {
  const st = view.settings as SharedSettings<"cause-and-effect">
  const name = `'${view.label}'`
  const out: Finding[] = []
  const rels = liveRelationships(s)
  const types = new Set([...st.positive, ...st.negative])
  const outcomes = st.outcomes.filter((o) => s.concepts[o]?.deletedAt === null)
  const levers = new Set(
    liveConcepts(s)
      .filter((c) => matchesFilter(c, st.levers))
      .map((c) => c.id)
  )

  if (!st.outcomes.length)
    out.push(
      problem(
        "outcome",
        `${name} has no outcome; anchor it on what the reader cares about`
      )
    )

  // Levers act on causes or the outcome, never on each other.
  const leverLinks = rels.filter(
    (r) => types.has(r.type) && levers.has(r.from) && levers.has(r.to)
  )
  if (leverLinks.length)
    out.push(
      problem(
        "lever-to-lever",
        `${name}: levers link to other levers (${quoted(leverLinks.map((r) => `${titleOf(s, r.from)} → ${titleOf(s, r.to)}`))}); aim each lever at the cause or outcome it acts on`,
        [...new Set(leverLinks.flatMap((r) => [r.from, r.to]))]
      )
    )

  // Build steps are part-of their lever and folded into it, not levers of their own.
  const fold = st.fold ?? {}
  for (const lever of levers) {
    const steps = rels
      .filter((r) => r.to === lever && isType(r.type, PART_OF))
      .map((r) => r.from)
      .filter((id) => !(fold[lever] ?? []).includes(id))
    if (steps.length)
      out.push(
        problem(
          "unfolded-steps",
          `${name}: ${quoted(steps.map((id) => titleOf(s, id)))} ${steps.length === 1 ? "is a step" : "are steps"} of lever '${titleOf(s, lever)}' but not folded; list ${steps.length === 1 ? "it" : "them"} in settings.fold['${lever}']`,
          steps
        )
      )
  }

  // The outcome is the reader's concern, in their words. Only a person can
  // judge the words; the check asks for a reader citation and says what it sees.
  for (const o of outcomes) {
    const cites = await whoSaid(s, s.concepts[o]!.prov, sources)
    if (!cites.some((c) => c.by === "reader"))
      out.push(
        warning(
          "outcome-words",
          `${name}: outcome '${titleOf(s, o)}' cites no reader turn; check it is what the reader cares about, named in their words, not an intermediate quantity`,
          [o]
        )
      )
  }
  const into = rels.filter(
    (r) => outcomes.includes(r.to) && types.has(r.type)
  ).length
  if (outcomes.length && !into)
    out.push(
      problem(
        "outcome-links",
        `${name}: nothing raises or lowers the outcome ${quoted(outcomes.map((o) => titleOf(s, o)))}`
      )
    )
  return out
}
