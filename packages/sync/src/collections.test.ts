import { createTransaction } from "@tanstack/db"
import {
  applyAll,
  builtinId,
  emptyState,
  makeOps,
  relKey,
  ulidSequence,
  type Op,
  type OpBody,
} from "@seply/domain"
import { afterEach, describe, expect, it } from "vitest"
import {
  createEngineCollections,
  type EngineCollections,
} from "./collections.ts"
import { OpEngine } from "./engine.ts"
import { TABLES } from "./rows.ts"

const EXP = "exp1"
const T0 = Date.parse("2026-09-01T00:00:00Z")
const IDEA = builtinId("idea")
const PREREQ = builtinId("prerequisite")
const R12 = relKey("c1", PREREQ, "c2")
const EXAMPLE = builtinId("example")

function base() {
  const bodies: OpBody[] = [
    { kind: "expedition.set", target: EXP, path: "title", value: "Attention" },
    {
      kind: "concept.create",
      target: "c1",
      value: { title: "Query", kind: IDEA },
    },
    {
      kind: "concept.create",
      target: "c2",
      value: { title: "Key", kind: IDEA },
    },
    { kind: "relationship.add", target: R12, value: {} },
    {
      kind: "section.create",
      target: "s1",
      value: { conceptId: "c1", orderKey: "a", heading: "Intro", md: "Hello" },
    },
    {
      kind: "kind.define",
      target: "k1",
      value: { label: "Paper", color: "blue" },
    },
    {
      kind: "reltype.define",
      target: "r1",
      value: { label: "cites", inverseLabel: "cited by", color: "slate" },
    },
    {
      kind: "attribute.define",
      target: "a1",
      value: { label: "Year", type: "number" },
    },
    {
      kind: "view.create",
      target: "v1",
      value: {
        viewType: "timeline",
        label: "Timeline",
        orderKey: "a",
        settings: { lanes: [] },
      },
    },
    {
      kind: "source.add",
      target: "src1",
      value: {
        kind: "prompt",
        title: "A prompt",
        addedBy: "ada",
        addedAt: "2026-09-01T00:00:00.000Z",
      },
    },
  ]
  const ops = makeOps(bodies, {
    expeditionId: EXP,
    actor: "seed",
    changeId: "seed",
    nextOpId: ulidSequence(T0 - 10_000),
  })
  return applyAll(emptyState(EXP), ops)
}

let open: EngineCollections[] = []
afterEach(() => {
  for (const c of open) c.dispose()
  open = []
})

let n = 0
function setup() {
  const engine = new OpEngine(base(), {
    actor: "ada",
    nextOpId: ulidSequence(T0),
  })
  const cols = createEngineCollections(engine, { id: `cols${++n}` })
  open.push(cols)
  /** The op bodies proposed since the last call. */
  let seen = 0
  const proposed = (): Omit<
    Op,
    "opId" | "expeditionId" | "actor" | "changeId" | "clientSeq" | "schemaV"
  >[] => {
    const ops = engine.pending.slice(seen)
    seen = engine.pending.length
    return ops.map((op) => {
      const {
        opId: _a,
        expeditionId: _b,
        actor: _c,
        changeId: _d,
        clientSeq: _e,
        schemaV: _f,
        ...body
      } = op
      void [_a, _b, _c, _d, _e, _f]
      return body
    })
  }
  return { engine, cols, proposed }
}

describe("collections", () => {
  it("one collection per table, loaded from the engine", () => {
    const { cols } = setup()
    for (const t of TABLES) expect(cols[t].isReady()).toBe(true)
    expect(cols.expeditions.get(EXP)?.title).toBe("Attention")
    expect(cols.concepts.size).toBe(2)
    expect(cols.articleSections.get("s1")?.heading).toBe("Intro")
    expect(cols.relationships.get(R12)).toMatchObject({ from: "c1", to: "c2" })
    expect(cols.kindDefs.get("k1")?.label).toBe("Paper")
    expect(cols.relTypeDefs.get("r1")?.label).toBe("cites")
    expect(cols.attributeDefs.get("a1")?.type).toBe("number")
    expect(cols.views.get("v1")?.label).toBe("Timeline")
    expect(cols.sources.get("src1")?.title).toBe("A prompt")
  })
})

describe("mutationFn → ops, per table", () => {
  it("Expedition: fields and tags", async () => {
    const { cols, proposed } = setup()
    await cols.expeditions.update(EXP, (d) => {
      d.summary = "How transformers attend"
      d.tags = ["ml"]
    }).isPersisted.promise
    expect(proposed()).toEqual([
      {
        kind: "expedition.set",
        target: EXP,
        path: "summary",
        value: "How transformers attend",
      },
      { kind: "expedition.tag.add", target: EXP, value: "ml" },
    ])
  })

  it("Concepts: create, set fields and attributes, tags, delete", async () => {
    const { cols, proposed, engine } = setup()
    await cols.concepts.insert({
      id: "c3",
      title: "Value",
      kind: IDEA,
      aliases: [],
      tags: [],
      attributes: {},
      overviewProv: [],
      prov: [],
      deletedAt: null,
    }).isPersisted.promise
    expect(proposed()).toEqual([
      {
        kind: "concept.create",
        target: "c3",
        value: {
          title: "Value",
          kind: IDEA,
          aliases: [],
          attributes: {},
          tags: [],
          overviewProv: [],
          prov: [],
        },
      },
    ])
    await cols.concepts.update("c1", (d) => {
      d.overview = "Q"
      d.attributes = { a1: 2017 }
      d.tags = ["core"]
      d.lat = undefined
    }).isPersisted.promise
    expect(proposed()).toEqual([
      { kind: "concept.set", target: "c1", path: "overview", value: "Q" },
      { kind: "concept.set", target: "c1", path: "attributes.a1", value: 2017 },
      { kind: "concept.tag.add", target: "c1", value: "core" },
    ])
    await cols.concepts.delete("c2").isPersisted.promise
    expect(proposed()).toEqual([{ kind: "concept.delete", target: "c2" }])
    // The delete cascades to its Relationships.
    expect(cols.relationships.size).toBe(0)
    expect(engine.state.concepts.c2?.deletedAt).not.toBeNull()
  })

  it("Article sections: create, set, move, delete", async () => {
    const { cols, proposed } = setup()
    await cols.articleSections.insert({
      id: "s2",
      conceptId: "c1",
      orderKey: "b",
      heading: "More",
      md: "",
      prov: [],
      deletedAt: null,
    }).isPersisted.promise
    expect(proposed()).toMatchObject([{ kind: "section.create", target: "s2" }])
    await cols.articleSections.update("s1", (d) => {
      d.md = "Hello, world"
      d.orderKey = "c"
    }).isPersisted.promise
    expect(proposed()).toEqual([
      { kind: "section.set", target: "s1", path: "md", value: "Hello, world" },
      { kind: "section.move", target: "s1", value: "c" },
    ])
    await cols.articleSections.delete("s2").isPersisted.promise
    expect(proposed()).toEqual([{ kind: "section.delete", target: "s2" }])
  })

  it("Relationships: add, set note, remove", async () => {
    const { cols, proposed } = setup()
    const key = relKey("c2", PREREQ, "c1")
    await cols.relationships.insert({
      key,
      from: "c2",
      type: PREREQ,
      to: "c1",
      note: "circular, on purpose",
      prov: [],
      deletedAt: null,
    }).isPersisted.promise
    expect(proposed()).toEqual([
      {
        kind: "relationship.add",
        target: key,
        value: { note: "circular, on purpose", prov: [] },
      },
    ])
    await cols.relationships.update(R12, (d) => {
      d.note = "fails: Saturday check-in only"
    }).isPersisted.promise
    expect(proposed()).toEqual([
      {
        kind: "relationship.set",
        target: R12,
        path: "note",
        value: "fails: Saturday check-in only",
      },
    ])
    await cols.relationships.delete(R12).isPersisted.promise
    expect(proposed()).toEqual([{ kind: "relationship.remove", target: R12 }])
  })

  it("Kinds and Relationship Types: define, redefine, hide", async () => {
    const { cols, proposed } = setup()
    await cols.kindDefs.update("k1", (d) => {
      d.color = "teal"
    }).isPersisted.promise
    expect(proposed()).toEqual([
      {
        kind: "kind.define",
        target: "k1",
        value: { label: "Paper", color: "teal" },
      },
    ])
    await cols.relTypeDefs.insert({ id: EXAMPLE, hidden: true }).isPersisted
      .promise
    expect(proposed()).toEqual([
      { kind: "reltype.hide", target: EXAMPLE, value: true },
    ])
    await cols.kindDefs.update("k1", (d) => {
      d.hidden = true
    }).isPersisted.promise
    expect(proposed()).toEqual([
      { kind: "kind.hide", target: "k1", value: true },
    ])
  })

  it("Attributes: define, delete", async () => {
    const { cols, proposed } = setup()
    await cols.attributeDefs.update("a1", (d) => {
      d.unit = "AD"
    }).isPersisted.promise
    expect(proposed()).toEqual([
      {
        kind: "attribute.define",
        target: "a1",
        value: { label: "Year", type: "number", unit: "AD" },
      },
    ])
    await cols.attributeDefs.delete("a1").isPersisted.promise
    expect(proposed()).toEqual([{ kind: "attribute.delete", target: "a1" }])
  })

  it("Views: create, fields, move, settings by path, delete", async () => {
    const { cols, proposed } = setup()
    await cols.views.update("v1", (d) => {
      d.label = "When"
      d.orderKey = "b"
      d.settings = { ...d.settings, placement: { c1: "c2" } }
    }).isPersisted.promise
    expect(proposed()).toEqual([
      { kind: "view.set", target: "v1", path: "label", value: "When" },
      { kind: "view.move", target: "v1", value: "b" },
      {
        kind: "view.set",
        target: "v1",
        path: "settings.placement.c1",
        value: "c2",
      },
    ])
    await cols.views.delete("v1").isPersisted.promise
    expect(proposed()).toEqual([{ kind: "view.delete", target: "v1" }])
  })

  it("Sources: add (an upsert, so also an edit), remove", async () => {
    const { cols, proposed } = setup()
    await cols.sources.update("src1", (d) => {
      d.title = "Renamed"
    }).isPersisted.promise
    expect(proposed()).toMatchObject([
      {
        kind: "source.add",
        target: "src1",
        value: { title: "Renamed", kind: "prompt" },
      },
    ])
    await cols.sources.delete("src1").isPersisted.promise
    expect(proposed()).toEqual([{ kind: "source.remove", target: "src1" }])
  })

  it("a transaction across tables is one Change", async () => {
    const { cols, engine } = setup()
    const tx = createTransaction({ mutationFn: cols.mutationFn })
    tx.mutate(() => {
      cols.concepts.update("c1", (d) => {
        d.title = "Queries"
      })
      cols.relationships.update(R12, (d) => {
        d.note = "see also"
      })
    })
    await tx.isPersisted.promise
    expect(new Set(engine.pending.map((op) => op.changeId)).size).toBe(1)
  })

  it("transaction metadata sets the Change's label", async () => {
    const { cols, engine } = setup()
    const tx = createTransaction({
      mutationFn: cols.mutationFn,
      metadata: { change: { label: "Renamed the pair" } },
    })
    tx.mutate(() => {
      cols.concepts.update("c1", (d) => {
        d.title = "Q"
      })
    })
    await tx.isPersisted.promise
    expect(engine.changesFor(engine.pending)).toMatchObject([
      { label: "Renamed the pair" },
    ])
  })
})

describe("edits no op can express are refused", () => {
  const refused: Array<
    [
      string,
      (c: EngineCollections) => { isPersisted: { promise: Promise<unknown> } },
    ]
  > = [
    [
      "a hand-set tombstone",
      (c) =>
        c.concepts.update(
          "c1",
          (d) => void (d.deletedAt = "2026-09-02T00:00:00.000Z")
        ),
    ],
    [
      "a Relationship's endpoint",
      (c) => c.relationships.update(R12, (d) => void (d.to = "c1")),
    ],
    ["deleting a Kind (hide it instead)", (c) => c.kindDefs.delete("k1")],
    [
      "a View's type",
      (c) => c.views.update("v1", (d) => void (d.viewType = "outline")),
    ],
    [
      "a section's Concept",
      (c) => c.articleSections.update("s1", (d) => void (d.conceptId = "c2")),
    ],
    [
      "an unknown Kind",
      (c) => c.concepts.update("c1", (d) => void (d.kind = "nope")),
    ],
    [
      "an Attribute value of the wrong type",
      (c) => c.concepts.update("c1", (d) => void (d.attributes = { a1: "x" })),
    ],
    ["deleting the Expedition row", (c) => c.expeditions.delete(EXP)],
  ]
  it.each(refused)("%s", async (_name, edit) => {
    const { cols, engine } = setup()
    const before = engine.state
    await expect(edit(cols).isPersisted.promise).rejects.toThrow(
      /no op for this edit/
    )
    expect(engine.pending).toHaveLength(0)
    expect(engine.state).toBe(before)
    expect(cols.concepts.get("c1")?.deletedAt).toBeNull()
  })
})
