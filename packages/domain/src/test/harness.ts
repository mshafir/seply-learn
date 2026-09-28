// Test harness: an in-memory op log with Changes, as the server would keep it.
import { apply } from "../apply.ts"
import { builtinId } from "../builtins.ts"
import type { ChangeOrigin } from "../common.ts"
import type { ChangeMeta, LoggedOp } from "../history.ts"
import { makeOps, parseOp, type OpBody } from "../ops.ts"
import { emptyState, relKey, type DomainState } from "../state.ts"
import { ulidSequence } from "../ulid.ts"

export const EXP = "exp1"
export const T0 = Date.parse("2026-09-01T00:00:00Z")
export const PART_OF = builtinId("part-of")
export const PREREQ = builtinId("prerequisite")
export const IDEA = builtinId("idea")

export function harness(initial: DomainState = emptyState(EXP)) {
  const nextOpId = ulidSequence(T0, 1000)
  let state = initial
  const log: LoggedOp[] = []
  const metas: ChangeMeta[] = []
  let seq = 0
  return {
    initial,
    log,
    metas,
    nextOpId,
    get state() {
      return state
    },
    get seq() {
      return seq
    },
    /** Commits op bodies as one Change; each op is validated first. */
    commit(
      actor: string,
      bodies: OpBody[],
      origin: ChangeOrigin = "human",
      label = "edit"
    ): string {
      const changeId = `ch${metas.length + 1}`
      const ops = makeOps(bodies, {
        expeditionId: initial.expedition.id,
        actor,
        changeId,
        nextOpId,
      })
      for (const op of ops) {
        const parsed = parseOp(op)
        if (!parsed.success)
          throw new Error(
            `invalid op ${JSON.stringify(op)}: ${parsed.error.message}`
          )
        state = apply(state, op)
        log.push({ ...op, serverSeq: ++seq })
      }
      metas.push({
        id: changeId,
        expeditionId: initial.expedition.id,
        author: actor,
        origin,
        label,
        at: new Date(T0).toISOString(),
      })
      return changeId
    },
  }
}

export const concept = (
  id: string,
  title: string,
  extra: Record<string, unknown> = {}
): OpBody =>
  ({
    kind: "concept.create",
    target: id,
    value: { title, kind: IDEA, ...extra },
  }) as OpBody
export const rel = (
  from: string,
  type: string,
  to: string,
  note?: string
): OpBody => ({
  kind: "relationship.add",
  target: relKey(from, type, to),
  value: note ? { note } : {},
})

/** A small synthetic Expedition: a topic with parts, a prerequisite, an Attribute and an Outline. */
export function seeded() {
  const h = harness()
  h.commit(
    "ana",
    [
      { kind: "expedition.set", target: EXP, path: "title", value: "Tea" },
      {
        kind: "attribute.define",
        target: "price",
        value: { label: "Price", type: "money", unit: "$" },
      },
      concept("topic", "Tea", { tags: ["topic"] }),
      concept("green", "Green tea", {
        summary: "Unoxidised",
        attributes: { price: 4 },
      }),
      concept("black", "Black tea", { summary: "Fully oxidised" }),
      concept("leaf", "Tea leaf"),
      rel("green", PART_OF, "topic"),
      rel("black", PART_OF, "topic"),
      rel("leaf", PREREQ, "green", "what is being processed"),
      {
        kind: "view.create",
        target: "outline",
        value: {
          viewType: "outline",
          label: "Outline",
          orderKey: "i",
          settings: { relationshipTypes: [PART_OF], rootTag: "topic" },
        },
      },
    ],
    "build",
    "Built from 1 Source"
  )
  return h
}
