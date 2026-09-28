import { describe, expect, it } from "vitest"
import { ApplyError, applyBody } from "./apply.ts"
import { builtinId } from "./builtins.ts"
import {
  OP_KINDS,
  parseOp,
  parseOpBody,
  type OpBody,
  type OpKind,
} from "./ops.ts"
import { relKey, type DomainState } from "./state.ts"
import { EXP, IDEA, PART_OF, PREREQ, seeded } from "./test/harness.ts"

const AT = "2026-09-02T00:00:00.000Z"
const run = (state: DomainState, op: OpBody) => {
  const parsed = parseOpBody(op)
  if (!parsed.success) throw new Error(parsed.error.message)
  return applyBody(state, parsed.data, AT)
}

const covered = new Set<OpKind>()
const cases: [OpKind, string, (s: DomainState) => void | DomainState][] = []
const op = (
  kind: OpKind,
  name: string,
  fn: (s: DomainState) => void | DomainState
) => {
  covered.add(kind)
  cases.push([kind, name, fn])
}

op("expedition.set", "sets a logged Expedition field", (s) => {
  const n = run(s, {
    kind: "expedition.set",
    target: EXP,
    path: "status",
    value: "ready",
  })
  expect(n.expedition.status).toBe("ready")
  expect(s.expedition.status).toBe("draft") // the input is not mutated
})
op("expedition.tag.add", "adds an Expedition Tag once", (s) => {
  let n = run(s, { kind: "expedition.tag.add", target: EXP, value: "drinks" })
  n = run(n, { kind: "expedition.tag.add", target: EXP, value: "drinks" })
  expect(n.expedition.tags).toEqual(["drinks"])
  return n
})
op("expedition.tag.remove", "removes an Expedition Tag", (s) => {
  const n = run(
    run(s, { kind: "expedition.tag.add", target: EXP, value: "x" }),
    {
      kind: "expedition.tag.remove",
      target: EXP,
      value: "x",
    }
  )
  expect(n.expedition.tags).toEqual([])
})
op("concept.create", "creates a Concept with defaults", (s) => {
  const n = run(s, {
    kind: "concept.create",
    target: "oolong",
    value: { title: "Oolong", kind: IDEA },
  })
  expect(n.concepts.oolong).toMatchObject({
    title: "Oolong",
    aliases: [],
    tags: [],
    prov: [],
    deletedAt: null,
  })
  expect(() =>
    run(s, {
      kind: "concept.create",
      target: "x",
      value: { title: "X", kind: "nope" },
    })
  ).toThrow(ApplyError)
})
op(
  "concept.set",
  "sets fields, Attribute values, and unsets with null",
  (s) => {
    let n = run(s, {
      kind: "concept.set",
      target: "green",
      path: "title",
      value: "Sencha",
    })
    n = run(n, {
      kind: "concept.set",
      target: "green",
      path: "attributes.price",
      value: 6,
    })
    n = run(n, {
      kind: "concept.set",
      target: "green",
      path: "summary",
      value: null,
    })
    expect(n.concepts.green).toMatchObject({
      title: "Sencha",
      attributes: { price: 6 },
    })
    expect(n.concepts.green.summary).toBeUndefined()
    expect(() =>
      run(s, {
        kind: "concept.set",
        target: "green",
        path: "attributes.price",
        value: "cheap",
      })
    ).toThrow(/money/)
    expect(
      parseOpBody({
        kind: "concept.set",
        target: "green",
        path: "colour",
        value: "x",
      }).success
    ).toBe(false)
    expect(
      parseOpBody({
        kind: "concept.set",
        target: "green",
        path: "title",
        value: null,
      }).success
    ).toBe(false)
  }
)
op("concept.delete", "tombstones a Concept and its Relationships", (s) => {
  const n = run(s, { kind: "concept.delete", target: "green" })
  expect(n.concepts.green.deletedAt).toBe(AT)
  expect(n.relationships[relKey("green", PART_OF, "topic")]).toMatchObject({
    deletedAt: AT,
    deletedWith: "green",
  })
  expect(
    n.relationships[relKey("black", PART_OF, "topic")].deletedAt
  ).toBeNull()
})
op("concept.restore", "restores a Concept with its Relationships", (s) => {
  const n = run(run(s, { kind: "concept.delete", target: "green" }), {
    kind: "concept.restore",
    target: "green",
  })
  expect(n.concepts.green.deletedAt).toBeNull()
  expect(n.relationships[relKey("leaf", PREREQ, "green")].deletedAt).toBeNull()
})
op("concept.tag.add", "adds a Concept Tag", (s) => {
  expect(
    run(s, { kind: "concept.tag.add", target: "green", value: "japan" })
      .concepts.green.tags
  ).toEqual(["japan"])
})
op("concept.tag.remove", "removes a Concept Tag", (s) => {
  expect(
    run(s, { kind: "concept.tag.remove", target: "topic", value: "topic" })
      .concepts.topic.tags
  ).toEqual([])
})
op("section.create", "creates an article section", (s) => {
  const n = run(s, {
    kind: "section.create",
    target: "s1",
    value: {
      conceptId: "green",
      orderKey: "i",
      heading: "History",
      md: "Old.",
    },
  })
  expect(n.sections.s1).toMatchObject({
    conceptId: "green",
    heading: "History",
    prov: [],
    deletedAt: null,
  })
  expect(() =>
    run(s, {
      kind: "section.create",
      target: "s2",
      value: { conceptId: "nope", orderKey: "i", heading: "", md: "" },
    })
  ).toThrow(ApplyError)
  return n
})
const withSection = (s: DomainState) =>
  run(s, {
    kind: "section.create",
    target: "s1",
    value: { conceptId: "green", orderKey: "i", heading: "H", md: "M" },
  })
op("section.set", "sets a section field", (s) => {
  expect(
    run(withSection(s), {
      kind: "section.set",
      target: "s1",
      path: "md",
      value: "New",
    }).sections.s1.md
  ).toBe("New")
})
op("section.move", "moves a section by order key", (s) => {
  expect(
    run(withSection(s), { kind: "section.move", target: "s1", value: "r" })
      .sections.s1.orderKey
  ).toBe("r")
  expect(
    parseOpBody({ kind: "section.move", target: "s1", value: "a0" }).success
  ).toBe(false)
})
op("section.delete", "tombstones a section", (s) => {
  expect(
    run(withSection(s), { kind: "section.delete", target: "s1" }).sections.s1
      .deletedAt
  ).toBe(AT)
})
op("relationship.add", "adds, and re-adding updates the note", (s) => {
  const key = relKey("leaf", PART_OF, "topic")
  let n = run(s, { kind: "relationship.add", target: key, value: {} })
  n = run(n, {
    kind: "relationship.add",
    target: key,
    value: { note: "raw material" },
  })
  expect(Object.keys(n.relationships).filter((k) => k === key)).toHaveLength(1)
  expect(n.relationships[key].note).toBe("raw material")
  expect(() =>
    run(s, {
      kind: "relationship.add",
      target: relKey("leaf", "nope", "topic"),
      value: {},
    })
  ).toThrow(/Relationship Type/)
  expect(() =>
    run(s, {
      kind: "relationship.add",
      target: relKey("leaf", PART_OF, "ghost"),
      value: {},
    })
  ).toThrow(/ghost/)
})
op("relationship.set", "sets a note", (s) => {
  const key = relKey("leaf", PREREQ, "green")
  expect(
    run(s, { kind: "relationship.set", target: key, path: "note", value: null })
      .relationships[key].note
  ).toBeUndefined()
})
op("relationship.remove", "tombstones a Relationship", (s) => {
  const key = relKey("green", PART_OF, "topic")
  const n = run(s, { kind: "relationship.remove", target: key })
  expect(n.relationships[key]).toMatchObject({ deletedAt: AT })
  expect(n.relationships[key].deletedWith).toBeUndefined()
})
op("kind.define", "defines a custom Kind; built-in ids are reserved", (s) => {
  const n = run(s, {
    kind: "kind.define",
    target: "cultivar",
    value: { label: "Cultivar", color: "green" },
  })
  expect(n.kinds.cultivar).toMatchObject({
    label: "Cultivar",
    color: "green",
    hidden: false,
  })
  expect(
    parseOpBody({
      kind: "kind.define",
      target: "builtin:x",
      value: { label: "X", color: "green" },
    }).success
  ).toBe(false)
  expect(
    parseOpBody({
      kind: "kind.define",
      target: "y",
      value: { label: "Y", color: "#00ff00" },
    }).success
  ).toBe(false)
})
op("kind.hide", "hides and unhides a built-in Kind", (s) => {
  const n = run(s, {
    kind: "kind.hide",
    target: builtinId("risk"),
    value: true,
  })
  expect(n.kinds[builtinId("risk")].hidden).toBe(true)
  expect(
    run(n, { kind: "kind.hide", target: builtinId("risk"), value: false })
      .kinds[builtinId("risk")]
  ).toBeUndefined()
})
op("reltype.define", "defines a custom Relationship Type", (s) => {
  const n = run(s, {
    kind: "reltype.define",
    target: "brewed-with",
    value: { label: "is brewed with", inverseLabel: "brews", color: "teal" },
  })
  expect(n.relTypes["brewed-with"]).toMatchObject({
    inverseLabel: "brews",
    hidden: false,
  })
})
op("reltype.hide", "hides a built-in Relationship Type", (s) => {
  expect(
    run(s, { kind: "reltype.hide", target: builtinId("fails"), value: true })
      .relTypes[builtinId("fails")].hidden
  ).toBe(true)
})
op("attribute.define", "defines an Attribute; types are fixed", (s) => {
  const n = run(s, {
    kind: "attribute.define",
    target: "grade",
    value: { label: "Grade", type: "enum", enumValues: ["low", "high"] },
  })
  expect(n.attributes.grade.type).toBe("enum")
  expect(() =>
    run(n, {
      kind: "attribute.define",
      target: "grade",
      value: { label: "Grade", type: "text" },
    })
  ).toThrow(/fixed/)
  expect(
    parseOpBody({
      kind: "attribute.define",
      target: "g",
      value: { label: "G", type: "enum" },
    }).success
  ).toBe(false)
})
op(
  "attribute.delete",
  "tombstones the definition and keeps the values",
  (s) => {
    const n = run(s, { kind: "attribute.delete", target: "price" })
    expect(n.attributes.price.deletedAt).toBe(AT)
    expect(n.concepts.green.attributes.price).toBe(4)
  }
)
op("view.create", "creates a View with validated settings", (s) => {
  const n = run(s, {
    kind: "view.create",
    target: "timeline",
    value: {
      viewType: "timeline",
      label: "Timeline",
      orderKey: "r",
      settings: { lanes: [] },
    },
  })
  expect(n.views.timeline).toMatchObject({
    status: "ready",
    settingsVersion: 1,
    deletedAt: null,
  })
  expect(
    parseOpBody({
      kind: "view.create",
      target: "bad",
      value: {
        viewType: "timeline",
        label: "T",
        orderKey: "r",
        settings: { lanes: "no" },
      },
    }).success
  ).toBe(false)
})
op("view.set", "sets a field, or a settings path", (s) => {
  let n = run(s, {
    kind: "view.set",
    target: "outline",
    path: "label",
    value: "Contents",
  })
  n = run(n, {
    kind: "view.set",
    target: "outline",
    path: "settings.openDepth",
    value: 2,
  })
  expect(n.views.outline).toMatchObject({
    label: "Contents",
    settings: { openDepth: 2, rootTag: "topic" },
  })
  expect(() =>
    run(n, {
      kind: "view.set",
      target: "outline",
      path: "settings.openDepth",
      value: "deep",
    })
  ).toThrow(/settings/)
})
op("view.move", "moves a View in the rail", (s) => {
  expect(
    run(s, { kind: "view.move", target: "outline", value: "x" }).views.outline
      .orderKey
  ).toBe("x")
})
op("view.delete", "tombstones a View", (s) => {
  expect(
    run(s, { kind: "view.delete", target: "outline" }).views.outline.deletedAt
  ).toBe(AT)
})
const source: OpBody = {
  kind: "source.add",
  target: "chat1",
  value: {
    kind: "chat",
    title: "A chat about tea",
    addedBy: "ana",
    addedAt: AT,
  },
}
op("source.add", "adds a Source", (s) => {
  expect(run(s, source).sources.chat1).toMatchObject({
    kind: "chat",
    title: "A chat about tea",
  })
})
op("source.remove", "removes a Source", (s) => {
  expect(
    run(run(s, source), { kind: "source.remove", target: "chat1" }).sources
      .chat1
  ).toBeUndefined()
})

describe("op kinds", () => {
  const base = seeded().state
  it.each(cases)("%s: %s", (_kind, _name, fn) => {
    fn(base)
  })

  it("covers every op kind", () => {
    expect([...covered].sort()).toEqual([...OP_KINDS].sort())
    expect(OP_KINDS).toHaveLength(28)
  })

  it("validates the envelope", () => {
    const body = { kind: "concept.delete", target: "green" }
    const env = {
      expeditionId: EXP,
      actor: "ana",
      changeId: "c",
      clientSeq: 0,
      schemaV: 1,
    }
    expect(
      parseOp({ ...env, ...body, opId: "01K6000000000000000000000A" }).success
    ).toBe(true)
    expect(parseOp({ ...env, ...body, opId: "not-a-ulid" }).success).toBe(false)
    expect(
      parseOp({
        ...env,
        ...body,
        kind: "concept.explode",
        opId: "01K6000000000000000000000A",
      }).success
    ).toBe(false)
  })
})
