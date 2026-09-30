// Comparison Table checks (spec §5.3; the prototype's validate.py, and the
// build-view playbook's "fill before you filter", `priority` and `standing`
// rules).
import type { DomainState, SharedSettings, View } from "@seply/domain"
import type { SourceReader } from "../ports.ts"
import {
  liveConcepts,
  liveRelationships,
  matchesFilter,
  named,
  PART_OF,
  problem,
  quoted,
  titleOf,
  warning,
  type Finding,
} from "./common.ts"
import { decisionRefs, whoSaid } from "./decisions.ts"

/** A column counts as filled at this share of rows, after filling (spec §5.3). */
export const MIN_FILL = 0.7
/** Fewer rows than this isn't a comparison. */
export const MIN_ROWS = 3

const VERDICTS = new Set(["meets", "partly-meets", "partly", "fails"])
export const isVerdict = (type: string) => VERDICTS.has(named(type))
/** Relationship Types that make a Concept a member of a class ("P1S" part-of "Enclosed printers"). */
const MEMBERSHIP = new Set([PART_OF, "example"])

export async function checkComparisonTable(
  s: DomainState,
  view: View,
  sources: SourceReader | undefined
): Promise<Finding[]> {
  const st = view.settings as SharedSettings<"comparison-table">
  const name = `'${view.label}'`
  const out: Finding[] = []
  const concepts = liveConcepts(s)
  const rels = liveRelationships(s)
  const rows = concepts.filter((c) => matchesFilter(c, st.rows))
  const rowIds = new Set(rows.map((c) => c.id))
  if (rows.length < MIN_ROWS)
    out.push(
      problem(
        "table-rows",
        `${name} has only ${rows.length} row(s); a table compares at least ${MIN_ROWS} options`
      )
    )

  const linked = new Set(rels.map((r) => `${r.from}|${r.to}`))
  const priorityOf = (id: string) =>
    st.priority ? s.concepts[id]?.attributes[st.priority] : undefined
  const isCriterion = (id: string) =>
    named(s.concepts[id]?.kind ?? "") === "criterion"

  // The columns as the table draws them. `criteria: auto` is every criterion
  // the rows have a verdict on.
  type Col = { label: string; attribute?: string; concept?: string }
  const cols: Col[] = st.columns.flatMap((col): Col[] => {
    if ("attribute" in col)
      return [
        {
          label: s.attributes[col.attribute]?.label ?? col.attribute,
          attribute: col.attribute,
        },
      ]
    if ("concept" in col)
      return s.concepts[col.concept]
        ? [{ label: titleOf(s, col.concept), concept: col.concept }]
        : []
    const judged = new Set(
      rels
        .filter((r) => rowIds.has(r.from) && isVerdict(r.type))
        .map((r) => r.to)
    )
    return concepts
      .filter((c) => judged.has(c.id) && named(c.kind) === "criterion")
      .map((c) => ({ label: c.title, concept: c.id }))
  })

  for (const col of cols) {
    const crit =
      col.concept && isCriterion(col.concept) ? col.concept : undefined
    const prio = crit ? priorityOf(crit) : undefined
    if (crit && prio === "dropped") continue // listed under the table, not a column

    // A priority on every criterion column.
    if (crit && prio === undefined)
      out.push(
        problem(
          "criterion-priority",
          st.priority
            ? `${name}: criterion column '${col.label}' has no ${st.priority} (hard / nice / dropped)`
            : `${name}: criterion column '${col.label}' has no priority; set settings.priority to a hard / nice / dropped Attribute and fill it`,
          [crit]
        )
      )

    // Fill before you filter: a statement about a class applies to every row in it.
    if (col.concept) {
      const classes = rels.filter(
        (r) => r.to === col.concept && isVerdict(r.type) && !rowIds.has(r.from)
      )
      for (const cls of classes) {
        const missing = rels
          .filter(
            (m) =>
              m.to === cls.from &&
              MEMBERSHIP.has(named(m.type)) &&
              rowIds.has(m.from) &&
              !linked.has(`${m.from}|${col.concept}`)
          )
          .map((m) => m.from)
        if (missing.length)
          out.push(
            problem(
              "class-statement",
              `${name}: '${titleOf(s, cls.from)} ${named(cls.type)} ${col.label}' applies to its members, but ${quoted(missing.map((id) => titleOf(s, id)))} ha${missing.length === 1 ? "s" : "ve"} no verdict on '${col.label}'`,
              missing
            )
          )
      }
    }

    // At least ~70% filled.
    if (!rows.length) continue
    const filled = rows.filter((r) =>
      col.attribute !== undefined
        ? r.attributes[col.attribute] !== undefined
        : linked.has(`${r.id}|${col.concept}`)
    ).length
    if (filled / rows.length >= MIN_FILL) continue
    const msg = `${name}: column '${col.label}' is filled ${filled}/${rows.length}`
    // A criterion the reader must have stays, even with gaps: a missing
    // answer on something that matters is itself useful.
    if (prio === "hard" || prio === "must")
      out.push(warning("column-fill", `${msg} (kept: it's a must-have)`))
    else
      out.push(
        problem(
          "column-fill",
          `${msg}; fill it from the Sources (class statements included), or drop it to the summaries`
        )
      )
  }

  // `chosen` records the reader's decision, never the assistant's advice.
  if (st.standing) {
    for (const row of rows) {
      if (row.attributes[st.standing] !== "chosen") continue
      const cites = await whoSaid(s, decisionRefs(s, row.id), sources)
      if (cites.some((c) => c.by === "reader")) continue
      const advice = cites
        .filter((c) => c.by === "assistant")
        .map((c) => c.ref.segment)
      out.push(
        problem(
          "chosen-uncited",
          advice.length
            ? `${name}: '${row.title}' is chosen, but cites only the assistant's advice (${advice.join(", ")}); set chosen only where the reader decides or acts, and cite that turn. A recommendation gets a rank or priority`
            : `${name}: '${row.title}' is chosen, but cites no reader decision; cite the segment where the reader decides or acts, or leave standing unset`,
          [row.id]
        )
      )
    }
  }
  return out
}
