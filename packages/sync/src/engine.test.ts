import {
  builtinId,
  emptyState,
  ulidSequence,
  type LoggedOp,
  type Op,
} from "@umbel/domain"
import { describe, expect, it } from "vitest"
import { OpEngine } from "./engine.ts"
import type { RowDiff } from "./rows.ts"

const EXP = "exp1"
const T0 = Date.parse("2026-09-01T00:00:00Z")
const IDEA = builtinId("idea")

function engine(actor = "me", start = T0) {
  const diffs: RowDiff[] = []
  const dropped: Op[] = []
  const e = new OpEngine(emptyState(EXP), {
    actor,
    nextOpId: ulidSequence(start),
    onDropped: (ops) => dropped.push(...ops),
  })
  e.subscribe((d) => diffs.push(d))
  return { e, diffs, dropped }
}
let seq = 0
const logged = (ops: Op[]): LoggedOp[] =>
  ops.map((op) => ({ ...op, serverSeq: ++seq }))

describe("OpEngine", () => {
  it("applies local ops as pending and emits the row diff synchronously", () => {
    const { e, diffs } = engine()
    e.propose([
      {
        kind: "concept.create",
        target: "c1",
        value: { title: "A", kind: IDEA },
      },
    ])
    expect(e.pending).toHaveLength(1)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject([
      { table: "concepts", type: "insert", key: "c1" },
    ])
  })

  it("an echo acknowledges pending ops without emitting a diff", () => {
    const { e, diffs } = engine()
    const ops = e.propose([
      {
        kind: "concept.create",
        target: "c1",
        value: { title: "A", kind: IDEA },
      },
    ])
    diffs.length = 0
    const echo = logged(ops)
    e.receive(echo)
    e.receive(echo) // redelivery is ignored
    expect(e.pending).toHaveLength(0)
    expect(e.headSeq).toBe(echo[0]!.serverSeq)
    expect(diffs).toEqual([])
  })

  it("rebases pending ops over newer confirmed ops (ours stays on top)", () => {
    const me = engine("me", T0)
    const them = engine("them", T0 + 1000)
    const create = logged(
      them.e.propose([
        {
          kind: "concept.create",
          target: "c1",
          value: { title: "A", kind: IDEA },
        },
      ])
    )
    me.e.receive(create)
    me.e.propose([
      { kind: "concept.set", target: "c1", path: "title", value: "mine" },
    ])
    const theirs = them.e.propose([
      { kind: "concept.set", target: "c1", path: "title", value: "theirs" },
      { kind: "concept.set", target: "c1", path: "summary", value: "s" },
    ])
    me.diffs.length = 0
    me.e.receive(logged(theirs))
    expect(me.e.state.concepts.c1).toMatchObject({
      title: "mine",
      summary: "s",
    })
    expect(me.e.pending).toHaveLength(1)
    expect(me.diffs).toHaveLength(1) // the summary only
  })

  it("drops pending ops that no longer apply after a rebase", () => {
    const { e, dropped } = engine()
    const [create] = e.propose([
      {
        kind: "concept.create",
        target: "c1",
        value: { title: "A", kind: IDEA },
      },
    ])
    e.propose([
      { kind: "concept.set", target: "c1", path: "title", value: "B" },
    ])
    e.reject([create!.opId])
    expect(e.pending).toHaveLength(0)
    expect(dropped).toHaveLength(1)
    expect(e.state.concepts.c1).toBeUndefined()
  })

  it("a local op that doesn't apply throws and changes nothing", () => {
    const { e, diffs } = engine()
    expect(() =>
      e.propose([
        { kind: "concept.set", target: "c9", path: "title", value: "x" },
      ])
    ).toThrow()
    expect(e.pending).toHaveLength(0)
    expect(diffs).toEqual([])
  })
})
