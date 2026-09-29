import {
  builtinId,
  emptyState,
  ulidSequence,
  type LoggedOp,
  type Op,
} from "@umbel/domain"
import { describe, expect, it } from "vitest"
import { OpEngine, type PendingSnapshot } from "./engine.ts"
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

describe("Changes: coalescing editing sessions", () => {
  function clocked() {
    let now = T0
    const snaps: PendingSnapshot[] = []
    const e = new OpEngine(emptyState(EXP), {
      actor: "me",
      nextOpId: ulidSequence(T0),
      now: () => now,
      onPendingChange: (s) => snaps.push(s),
    })
    e.propose([
      {
        kind: "concept.create",
        target: "c1",
        value: { title: "A", kind: IDEA },
      },
      {
        kind: "concept.create",
        target: "c2",
        value: { title: "B", kind: IDEA },
      },
    ])
    const set = (target: string, value: string, opts = {}) =>
      e.propose(
        [{ kind: "concept.set", target, path: "title", value }],
        opts
      )[0]!
    return { e, snaps, set, tick: (ms: number) => (now += ms) }
  }

  it("edits of one Concept within the window join one Change", () => {
    const { set, tick } = clocked()
    const a = set("c1", "A1")
    tick(60_000)
    const b = set("c1", "A2")
    expect(b.changeId).toBe(a.changeId)
  })

  it("another subject, a gap past the window, or coalesce: false starts a new one", () => {
    const { set, tick } = clocked()
    const a = set("c1", "A1")
    const b = set("c2", "B1")
    expect(b.changeId).not.toBe(a.changeId)
    tick(5 * 60_000 + 1)
    const c = set("c2", "B2")
    expect(c.changeId).not.toBe(b.changeId)
    const d = set("c2", "B3", { coalesce: false })
    expect(d.changeId).not.toBe(c.changeId)
  })

  it("a multi-subject edit never coalesces", () => {
    const { e, set } = clocked()
    const a = set("c1", "A1")
    const [b] = e.propose([
      { kind: "concept.set", target: "c1", path: "summary", value: "x" },
      { kind: "concept.set", target: "c2", path: "summary", value: "y" },
    ])
    expect(b!.changeId).not.toBe(a.changeId)
  })

  it("Change ids are ULIDs (unique across reloads), with labels for the push", () => {
    const { e, set } = clocked()
    const a = set("c1", "Renamed")
    expect(a.changeId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(e.changesFor([a])).toEqual([
      { id: a.changeId, origin: "human", label: "Edited Renamed" },
    ])
    const b = set("c1", "Named", { label: "Fixed a typo" })
    expect(e.changesFor([b])[0]?.label).toBe("Fixed a typo")
  })

  it("hands over every pending change synchronously; confirmed Changes are forgotten", () => {
    const { e, snaps, set } = clocked()
    const a = set("c1", "A1")
    expect(snaps.at(-1)?.ops.at(-1)?.opId).toBe(a.opId)
    e.receive(logged([...e.pending]))
    expect(snaps.at(-1)?.ops).toEqual([])
    // Only the open Change's metadata stays (the session may continue).
    expect(snaps.at(-1)?.changes.map((c) => c.id)).toEqual([a.changeId])
  })
})

describe("restore (after a reload)", () => {
  it("rebases saved ops onto confirmed state, skipping ones already confirmed", () => {
    const first = engine("me", T0)
    const create = first.e.propose([
      {
        kind: "concept.create",
        target: "c1",
        value: { title: "A", kind: IDEA },
      },
    ])
    const confirmedCreate = logged(create)
    const [edit] = first.e.propose([
      { kind: "concept.set", target: "c1", path: "title", value: "B" },
    ])
    const saved = first.e.snapshot()

    const second = engine("me", T0 + 5000)
    second.e.receive(confirmedCreate)
    second.diffs.length = 0
    second.e.restore(saved)
    expect(second.e.pending.map((op) => op.opId)).toEqual([edit!.opId])
    expect(second.e.state.concepts.c1?.title).toBe("B")
    expect(second.diffs).toHaveLength(1)
  })

  it("ignores saved ops of another user", () => {
    const first = engine("someone-else", T0)
    first.e.propose([
      {
        kind: "concept.create",
        target: "c1",
        value: { title: "A", kind: IDEA },
      },
    ])
    const second = engine("me", T0 + 5000)
    second.e.restore(first.e.snapshot())
    expect(second.e.pending).toHaveLength(0)
  })
})
