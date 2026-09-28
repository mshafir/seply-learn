import { describe, expect, it } from "vitest"
import { applyBody } from "./apply.ts"
import { flattenState, diffKeys } from "./fields.ts"
import {
  changeSubject,
  groupChanges,
  restoreTo,
  shouldCoalesce,
  stateAt,
  undoChange,
} from "./history.ts"
import { relKey } from "./state.ts"
import { EXP, PART_OF, PREREQ, concept, rel, seeded } from "./test/harness.ts"

const AT = "2026-09-03T00:00:00.000Z"

/** Undo a Change and commit the result as a new Change, like the app would. */
function undoAndCommit(
  h: ReturnType<typeof seeded>,
  changeId: string,
  actor = "ana"
) {
  const r = undoChange({ initial: h.initial, log: h.log, changeId, at: AT })
  h.commit(actor, r.ops, "human", `Undid ${changeId}`)
  return r
}

describe("Changes", () => {
  it("groups the log into Changes", () => {
    const h = seeded()
    h.commit("ben", [
      { kind: "concept.set", target: "green", path: "title", value: "Sencha" },
    ])
    const changes = groupChanges(h.log, h.metas)
    expect(changes.map((c) => [c.id, c.author, c.ops.length])).toEqual([
      ["ch1", "ana", 10],
      ["ch2", "ben", 1],
    ])
    expect(changes[1]).toMatchObject({ firstSeq: 11, lastSeq: 11 })
  })

  it("coalesces a human editing session on one Concept within the window", () => {
    const h = seeded()
    const s = h.state
    const subject = changeSubject(s, [
      { kind: "concept.set", target: "green", path: "title", value: "Sencha" },
      {
        kind: "section.create",
        target: "s1",
        value: { conceptId: "green", orderKey: "i", heading: "", md: "" },
      },
    ])
    expect(subject).toBe("concept:green")
    const prev = {
      author: "ana",
      origin: "human" as const,
      subject,
      lastAt: "2026-09-01T10:00:00Z",
    }
    expect(shouldCoalesce(prev, { ...prev, at: "2026-09-01T10:04:00Z" })).toBe(
      true
    )
    expect(shouldCoalesce(prev, { ...prev, at: "2026-09-01T10:06:00Z" })).toBe(
      false
    )
    expect(
      shouldCoalesce(prev, {
        ...prev,
        author: "ben",
        at: "2026-09-01T10:01:00Z",
      })
    ).toBe(false)
    expect(
      shouldCoalesce(prev, {
        ...prev,
        subject: "concept:black",
        at: "2026-09-01T10:01:00Z",
      })
    ).toBe(false)
    expect(
      shouldCoalesce(
        { ...prev, origin: "ai" },
        { ...prev, at: "2026-09-01T10:01:00Z" }
      )
    ).toBe(false)
    expect(changeSubject(s, [rel("leaf", PART_OF, "topic")])).toBeNull()
  })

  it("views the Expedition as of any point", () => {
    const h = seeded()
    const seq = h.seq
    h.commit("ben", [
      { kind: "concept.set", target: "green", path: "title", value: "Sencha" },
    ])
    expect(stateAt(h.initial, h.log, seq).concepts.green.title).toBe(
      "Green tea"
    )
    expect(stateAt(h.initial, h.log).concepts.green.title).toBe("Sencha")
  })
})

describe("undo", () => {
  it("reverts a Change", () => {
    const h = seeded()
    const before = h.state
    const c = h.commit("ana", [
      { kind: "concept.set", target: "green", path: "title", value: "Sencha" },
      { kind: "concept.tag.add", target: "green", value: "japan" },
      {
        kind: "concept.set",
        target: "green",
        path: "attributes.price",
        value: null,
      },
    ])
    const r = undoAndCommit(h, c)
    expect(r.kept).toEqual([])
    expect(diffKeys(flattenState(h.state), flattenState(before)).size).toBe(0)
  })

  it("keeps fields changed since, and reports who changed them", () => {
    const h = seeded()
    const c = h.commit("ana", [
      { kind: "concept.set", target: "green", path: "title", value: "Sencha" },
      {
        kind: "concept.set",
        target: "green",
        path: "summary",
        value: "Steamed",
      },
    ])
    h.commit("ben", [
      { kind: "concept.set", target: "green", path: "title", value: "Gyokuro" },
    ])
    const r = undoAndCommit(h, c)
    expect(h.state.concepts.green.title).toBe("Gyokuro") // kept
    expect(h.state.concepts.green.summary).toBe("Unoxidised") // reverted
    expect(r.kept).toEqual([
      {
        entity: "concept",
        id: "green",
        field: "title",
        current: "Gyokuro",
        by: expect.objectContaining({ actor: "ben" }),
      },
    ])
  })

  it("undoes a first build by tombstoning what it created", () => {
    const h = seeded()
    undoAndCommit(h, "ch1")
    expect(
      Object.values(h.state.concepts).every((c) => c.deletedAt !== null)
    ).toBe(true)
    expect(
      Object.values(h.state.relationships).every((r) => r.deletedAt !== null)
    ).toBe(true)
    expect(h.state.views.outline.deletedAt).not.toBeNull()
    expect(h.state.expedition.title).toBe("")
  })

  it("undoes a Source removal and a View delete, which have no restore op", () => {
    const h = seeded()
    h.commit("ana", [
      {
        kind: "source.add",
        target: "chat1",
        value: { kind: "chat", title: "Tea chat", addedBy: "ana", addedAt: AT },
      },
    ])
    const c = h.commit("ana", [
      { kind: "source.remove", target: "chat1" },
      { kind: "view.delete", target: "outline" },
      { kind: "attribute.delete", target: "price" },
    ])
    undoAndCommit(h, c)
    expect(h.state.sources.chat1.title).toBe("Tea chat")
    expect(h.state.views.outline.deletedAt).toBeNull()
    expect(h.state.attributes.price.deletedAt).toBeNull()
  })

  it("undoes path-level settings edits without touching other paths", () => {
    const h = seeded()
    const c = h.commit("ana", [
      {
        kind: "view.set",
        target: "outline",
        path: "settings.placement.leaf",
        value: "green",
      },
    ])
    h.commit("ben", [
      {
        kind: "view.set",
        target: "outline",
        path: "settings.placement.black",
        value: "green",
      },
    ])
    const r = undoAndCommit(h, c)
    expect(r.ops).toEqual([
      {
        kind: "view.set",
        target: "outline",
        path: "settings.placement.leaf",
        value: null,
      },
    ])
    expect(h.state.views.outline.settings.placement).toEqual({ black: "green" })
  })
})

describe("delete and restore cascade", () => {
  it("deleting a Concept tombstones its Relationships; undo brings them back together", () => {
    const h = seeded()
    const c = h.commit("ana", [{ kind: "concept.delete", target: "green" }])
    const gone = [
      relKey("green", PART_OF, "topic"),
      relKey("leaf", PREREQ, "green"),
    ]
    for (const k of gone)
      expect(h.state.relationships[k].deletedAt).not.toBeNull()
    const r = undoAndCommit(h, c)
    expect(r.ops).toEqual([{ kind: "concept.restore", target: "green" }])
    for (const k of gone) expect(h.state.relationships[k].deletedAt).toBeNull()
  })

  it("does not bring back a Relationship removed on its own before the delete", () => {
    const h = seeded()
    h.commit("ana", [
      { kind: "relationship.remove", target: relKey("leaf", PREREQ, "green") },
    ])
    h.commit("ana", [
      { kind: "concept.delete", target: "green" },
      { kind: "concept.restore", target: "green" },
    ])
    expect(
      h.state.relationships[relKey("leaf", PREREQ, "green")].deletedAt
    ).not.toBeNull()
    expect(
      h.state.relationships[relKey("green", PART_OF, "topic")].deletedAt
    ).toBeNull()
  })

  it("a Relationship between two deleted Concepts comes back only when both are restored", () => {
    const h = seeded()
    const key = relKey("leaf", PREREQ, "green")
    h.commit("ana", [{ kind: "concept.delete", target: "green" }])
    h.commit("ana", [{ kind: "concept.delete", target: "leaf" }])
    h.commit("ana", [{ kind: "concept.restore", target: "green" }])
    expect(h.state.relationships[key]).toMatchObject({ deletedWith: "leaf" })
    expect(h.state.relationships[key].deletedAt).not.toBeNull()
    h.commit("ana", [{ kind: "concept.restore", target: "leaf" }])
    expect(h.state.relationships[key].deletedAt).toBeNull()
  })
})

describe("restore to a point", () => {
  it("appends inverse ops that bring the latest state back, as a new Change", () => {
    const h = seeded()
    const seq = h.seq
    const target = h.state
    h.commit("ben", [
      { kind: "concept.set", target: "green", path: "title", value: "Sencha" },
      concept("oolong", "Oolong"),
      rel("oolong", PART_OF, "topic"),
      { kind: "concept.delete", target: "black" },
      {
        kind: "view.set",
        target: "outline",
        path: "settings.hide",
        value: ["leaf"],
      },
      { kind: "expedition.tag.add", target: EXP, value: "drinks" },
      {
        kind: "kind.define",
        target: "cultivar",
        value: { label: "Cultivar", color: "green" },
      },
    ])
    const logLength = h.log.length
    const r = restoreTo({ initial: h.initial, log: h.log, seq, at: AT })
    expect(h.log).toHaveLength(logLength) // the log is never rewound
    h.commit("ana", r.ops, "restore", "Restored")
    const now = h.state
    // Everything matches except what can only be tombstoned or hidden.
    expect(now.concepts.green.title).toBe("Green tea")
    expect(now.concepts.black.deletedAt).toBeNull()
    expect(
      now.relationships[relKey("black", PART_OF, "topic")].deletedAt
    ).toBeNull()
    expect(now.concepts.oolong.deletedAt).not.toBeNull()
    expect(
      now.relationships[relKey("oolong", PART_OF, "topic")].deletedAt
    ).not.toBeNull()
    expect(now.views.outline.settings).toEqual(target.views.outline.settings)
    expect(now.expedition.tags).toEqual([])
    expect(now.kinds.cultivar.hidden).toBe(true)
    // A second restore to the same point is a no-op.
    expect(
      restoreTo({ initial: h.initial, log: h.log, seq, at: AT }).ops
    ).toEqual([])
  })

  it("inverse ops are valid ops", () => {
    const h = seeded()
    h.commit("ben", [{ kind: "concept.delete", target: "green" }])
    const r = restoreTo({ initial: h.initial, log: h.log, seq: 0, at: AT })
    // Replaying the ops on the latest state reproduces the returned state.
    const replayed = r.ops.reduce(
      (s, op) => applyBody(s, op, AT),
      stateAt(h.initial, h.log)
    )
    expect(replayed).toEqual(r.state)
  })
})
