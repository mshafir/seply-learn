import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { apply } from "./apply.ts"
import { builtinId } from "./builtins.ts"
import { mergeConcepts } from "./commands.ts"
import { restoreTo, stateAt, undoChange, type LoggedOp } from "./history.ts"
import { makeOps, parseOp } from "./ops.ts"
import { nearestPaletteColor, sampleToState, splitArticle } from "./sample.ts"
import { emptyState, isLive, relKey } from "./state.ts"
import { ulidSequence } from "./ulid.ts"

// The only committed sample graph.
const COMPUTE = fileURLToPath(
  new URL(
    "../../../prototypes/sample-graphs/src/graphs/compute.json",
    import.meta.url
  )
)
const raw = JSON.parse(readFileSync(COMPUTE, "utf8")) as {
  concepts: { id: string; article?: string }[]
  relationships: unknown[]
  views: { id: string }[]
  attributes: unknown[]
}

function load() {
  return sampleToState(raw, {
    expeditionId: "compute",
    actor: "importer",
    changeId: "import",
    nextOpId: ulidSequence(Date.parse("2026-06-17T00:00:00Z")),
    at: "2026-06-17T00:00:00.000Z",
  })
}

describe("compute sample converter", () => {
  it("loads the whole sample into domain state through valid ops", () => {
    const { state, ops, change } = load()
    for (const op of ops) expect(parseOp(op).success).toBe(true)
    expect(change).toMatchObject({ origin: "import", author: "importer" })
    expect(state.expedition).toMatchObject({
      title: "AI compute & model internals",
      status: "ready",
      bestViewId: "outline",
    })
    expect(Object.keys(state.concepts)).toHaveLength(raw.concepts.length)
    expect(Object.keys(state.relationships)).toHaveLength(
      raw.relationships.length
    )
    expect(Object.keys(state.views)).toHaveLength(raw.views.length)
    expect(Object.keys(state.attributes)).toHaveLength(raw.attributes.length)
    expect(Object.keys(state.sources)).toEqual(["compute-source"])
  })

  it("maps Kinds and Relationship Types onto the built-ins", () => {
    const { state } = load()
    expect(state.concepts["t-econ"].kind).toBe(builtinId("idea"))
    expect(Object.keys(state.kinds)).toEqual([]) // every sample Kind is a built-in
    expect(Object.keys(state.relTypes)).toEqual([])
    expect(
      Object.values(state.relationships).every((r) =>
        r.type.startsWith("builtin:")
      )
    ).toBe(true)
    expect(state.views.outline.settings).toMatchObject({
      relationshipTypes: [builtinId("part-of")],
      rootTag: "topic",
    })
    expect(state.views.evidence.settings).toMatchObject({
      claimKinds: [builtinId("claim")],
    })
    expect(state.views.rates.settings).toMatchObject({
      sourceRelationship: builtinId("reported-by"),
    })
  })

  it("turns articles into ordered sections and outline seq into the View’s order", () => {
    const { state } = load()
    const withArticle = raw.concepts.filter((c) => c.article)
    const conceptsWithSections = new Set(
      Object.values(state.sections).map((s) => s.conceptId)
    )
    expect(conceptsWithSections.size).toBe(withArticle.length)
    const first = withArticle[0]
    const sections = Object.values(state.sections)
      .filter((s) => s.conceptId === first.id)
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))
    expect(sections.map((s) => s.heading)).toEqual(
      splitArticle(first.article!).map((s) => s.heading)
    )
    expect(sections[0].heading).toBe("")
    const order = state.views.outline.settings.order as Record<string, string[]>
    expect(Object.keys(order).length).toBeGreaterThan(0)
  })

  it("supports history on real data: merge, undo, restore", () => {
    const { state, ops } = load()
    const nextOpId = ulidSequence(Date.parse("2026-06-18T00:00:00Z"))
    const log: LoggedOp[] = ops.map((op, i) => ({ ...op, serverSeq: i + 1 }))
    const importSeq = log.length
    let s = state
    const commit = (
      changeId: string,
      bodies: Parameters<typeof makeOps>[0]
    ) => {
      for (const op of makeOps(bodies, {
        expeditionId: "compute",
        actor: "ana",
        changeId,
        nextOpId,
      })) {
        s = apply(s, op)
        log.push({ ...op, serverSeq: log.length + 1 })
      }
    }
    const [survivor, loser] = ["t-econ", "capacity"]
    expect(isLive(s.concepts[loser])).toBe(true)
    commit("merge", mergeConcepts(s, survivor, loser))
    expect(s.concepts[survivor].aliases).toContain(state.concepts[loser].title)
    const undo = undoChange({
      initial: emptyState("compute"),
      log,
      changeId: "merge",
      at: "2026-06-19T00:00:00.000Z",
    })
    expect(undo.kept).toEqual([])
    commit("undo", undo.ops)
    expect(s.concepts).toEqual(state.concepts)
    commit("del", [{ kind: "concept.delete", target: "gpu-supply" }])
    expect(
      s.relationships[relKey("gpu-supply", builtinId("part-of"), "capacity")]
        .deletedAt
    ).not.toBeNull()
    commit(
      "restore",
      restoreTo({
        initial: emptyState("compute"),
        log,
        seq: importSeq,
        at: "2026-06-19T00:00:00.000Z",
      }).ops
    )
    expect(
      s.relationships[relKey("gpu-supply", builtinId("part-of"), "capacity")]
        .deletedAt
    ).toBeNull()
    expect(stateAt(emptyState("compute"), log, importSeq)).toEqual(state)
  })

  it("maps hex colours to palette names", () => {
    expect(nearestPaletteColor("#2563eb")).toBe("blue")
    expect(nearestPaletteColor("#b91c1c")).toBe("red")
    expect(nearestPaletteColor("teal")).toBe("teal")
  })
})
