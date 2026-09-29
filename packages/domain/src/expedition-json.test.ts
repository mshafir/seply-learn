import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { builtinId } from "./builtins.ts"
import {
  EXPEDITION_JSON_VERSION,
  IMPORT_CHANGE_LABEL,
  ImportError,
  importExpeditionJson,
  parseExpeditionJson,
  remapConceptLinks,
  stateToExpeditionJson,
  type ExpeditionJsonInput,
  type ImportOptions,
} from "./expedition-json.ts"
import { parseOp } from "./ops.ts"
import { isLive } from "./state.ts"
import { ULID_RE, ulidSequence } from "./ulid.ts"

const read = (rel: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
  ) as Record<string, unknown> & {
    concepts: unknown[]
    relationships: unknown[]
    views: unknown[]
  }

const FIXTURES = {
  compute: {
    fixture: "../fixtures/compute.json",
    prototype: "../../../prototypes/sample-graphs/src/graphs/compute.json",
  },
  "research-doc": {
    fixture: "../fixtures/research-doc.json",
    prototype:
      "../../../prototypes/sample-graphs/src/graphs/gen-kg-learning-tools-doc.json",
  },
} as const

const AT = "2026-09-29T00:00:00.000Z"
function options(): ImportOptions {
  const next = ulidSequence(Date.parse(AT))
  return {
    expeditionId: next(),
    actor: "importer",
    changeId: next(),
    nextOpId: next,
    newId: next,
    at: AT,
  }
}
const live = <T extends { deletedAt: string | null }>(r: Record<string, T>) =>
  Object.values(r).filter(isLive)

function counts(state: ReturnType<typeof importExpeditionJson>["state"]) {
  return {
    concepts: live(state.concepts).length,
    relationships: live(state.relationships).length,
    views: live(state.views).length,
  }
}

/** A small, valid v1 file with one of everything that carries a reference. */
function tiny(): ExpeditionJsonInput {
  return {
    schemaVersion: 1,
    id: "tiny",
    title: "Tiny",
    tags: ["demo"],
    bestViewId: "v-anatomy",
    kinds: [
      { id: "builtin:idea", label: "Idea", color: "blue" },
      { id: "builtin:risk", label: "Risk", color: "red", hidden: true },
      { id: "gadget", label: "Gadget", color: "teal" },
      { id: "builtin:future", label: "Future", color: "pink" },
    ],
    relationshipTypes: [
      {
        id: "builtin:part-of",
        label: "is part of",
        inverseLabel: "has part",
        color: "violet",
      },
      {
        id: "powers",
        label: "powers",
        inverseLabel: "is powered by",
        color: "amber",
      },
    ],
    attributes: [
      { id: "size", label: "Size", type: "number", unit: "cm" },
      { id: "tier", label: "Tier", type: "enum", enumValues: ["a", "b"] },
    ],
    sources: [{ id: "src", kind: "file", title: "notes.md" }],
    concepts: [
      {
        id: "engine",
        title: "Engine",
        kind: "gadget",
        overview: "Driven by a [piston](#c/piston) and a [ghost](#c/ghost).",
        attributes: { size: 3, tier: "a" },
        prov: [
          { source: "src", segment: "s1", quote: "an engine" },
          { source: "gone", segment: "s9" },
        ],
        sections: [
          { id: "engine-lead", heading: "", md: "Lead." },
          {
            id: "engine-how",
            heading: "How",
            md: "It turns: [spark](#c/spark).",
          },
        ],
      },
      { id: "piston", title: "Piston", kind: "builtin:idea" },
      { id: "spark", title: "Spark", kind: "builtin:future" },
    ],
    relationships: [
      { from: "piston", type: "builtin:part-of", to: "engine" },
      { from: "spark", type: "powers", to: "engine", note: "ignites" },
    ],
    views: [
      {
        id: "v-anatomy",
        viewType: "anatomy",
        label: "Anatomy",
        settings: {
          roots: ["engine", "deleted-root"],
          containment: ["builtin:part-of"],
          pins: ["powers"],
          placement: { spark: "engine", ghost: "engine" },
          order: { engine: ["piston", "spark", "ghost"] },
          hide: ["piston", "ghost"],
          fold: { engine: ["spark"] },
        },
        settingsVersion: 1,
      },
      {
        id: "v-table",
        viewType: "comparison-table",
        label: "Parts",
        settings: {
          rows: { kinds: ["builtin:future", "gadget"] },
          columns: [{ attribute: "size" }, { concept: "engine" }],
        },
        settingsVersion: 1,
        status: "building",
      },
    ],
  }
}

describe("import fixtures", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`${name}: importing yields the fixture's Concept, Relationship and View counts`, () => {
      const file = read(f.fixture)
      expect(file.schemaVersion).toBe(EXPEDITION_JSON_VERSION)
      const { state, ops, change } = importExpeditionJson(file, options())
      expect(counts(state)).toEqual({
        concepts: file.concepts.length,
        relationships: file.relationships.length,
        views: file.views.length,
      })
      for (const op of ops) expect(parseOp(op).success).toBe(true)
      expect(new Set(ops.map((o) => o.changeId))).toEqual(new Set([change.id]))
      expect(change).toMatchObject({
        origin: "import",
        label: IMPORT_CHANGE_LABEL,
        author: "importer",
      })
      expect(state.expedition.status).toBe("ready")
    })

    it(`${name}: the fixture matches its prototype (version 0, upgraded)`, () => {
      const proto = read(f.prototype)
      const upgraded = importExpeditionJson(proto, options())
      expect(counts(upgraded.state)).toEqual({
        concepts: proto.concepts.length,
        relationships: proto.relationships.length,
        views: proto.views.length,
      })
      const fromFixture = importExpeditionJson(read(f.fixture), options())
      expect(counts(fromFixture.state)).toEqual(counts(upgraded.state))
    })

    it(`${name}: export → import round-trips`, () => {
      const first = importExpeditionJson(read(f.fixture), options())
      const exported = stateToExpeditionJson(first.state)
      const second = importExpeditionJson(
        JSON.parse(JSON.stringify(exported)),
        options()
      )
      const again = stateToExpeditionJson(second.state)
      // Same content; only ids differ.
      expect(again.concepts.map((c) => c.title)).toEqual(
        exported.concepts.map((c) => c.title)
      )
      expect(again.views.map((v) => v.label)).toEqual(
        exported.views.map((v) => v.label)
      )
      expect(counts(second.state)).toEqual(counts(first.state))
    })
  }
})

describe("synthetic trip fixture", () => {
  // Hand-written (no prototype): a made-up week of public places, with a Map
  // and a Timeline View.
  it("imports with its places, dates and both Views", () => {
    const file = read("../fixtures/trip.json")
    const { state } = importExpeditionJson(file, options())
    expect(counts(state)).toEqual({
      concepts: file.concepts.length,
      relationships: file.relationships.length,
      views: file.views.length,
    })
    const concepts = Object.values(state.concepts)
    expect(concepts.filter((c) => c.lat !== undefined).length).toBeGreaterThan(8)
    expect(concepts.filter((c) => c.dateEnd).length).toBeGreaterThan(2)
    expect(concepts.filter((c) => c.dateApprox).length).toBeGreaterThan(1)
    expect(Object.values(state.views).map((v) => v.viewType).sort()).toEqual([
      "map",
      "timeline",
    ])
  })
})

describe("id re-minting", () => {
  it("gives every entity a fresh ULID and remaps references", () => {
    const opts = options()
    const { state, ids, ops } = importExpeditionJson(tiny(), opts)
    const engine = ids.concepts.get("engine")!
    const piston = ids.concepts.get("piston")!
    const spark = ids.concepts.get("spark")!

    // Every entity id is fresh.
    for (const map of [ids.concepts, ids.sections, ids.views, ids.sources])
      for (const [old, id] of map) {
        expect(id).toMatch(ULID_RE)
        expect(id).not.toBe(old)
      }
    expect(state.expedition.id).toBe(opts.expeditionId)
    const oldIds = ["tiny", "engine", "piston", "spark", "src", "v-anatomy"]
    const text = JSON.stringify(ops)
    for (const old of oldIds) expect(text).not.toContain(`"${old}"`)

    // Relationships, sections, provenance and the best View follow.
    expect(Object.keys(state.relationships).sort()).toEqual(
      [
        `${piston}|builtin:part-of|${engine}`,
        `${spark}|powers|${engine}`,
      ].sort()
    )
    const sections = Object.values(state.sections).sort((a, b) =>
      a.orderKey < b.orderKey ? -1 : 1
    )
    expect(sections.map((s) => [s.conceptId, s.heading])).toEqual([
      [engine, ""],
      [engine, "How"],
    ])
    // In-text links follow their Concept; dangling ones are left alone.
    expect(state.concepts[engine].overview).toBe(
      `Driven by a [piston](#c/${piston}) and a [ghost](#c/ghost).`
    )
    expect(sections[1].md).toBe(`It turns: [spark](#c/${spark}).`)
    expect(state.concepts[engine].prov).toEqual([
      { source: ids.sources.get("src"), segment: "s1", quote: "an engine" },
    ])
    expect(state.expedition.bestViewId).toBe(ids.views.get("v-anatomy"))
    expect(state.expedition.tags).toEqual(["demo"])
    expect(state.sources[ids.sources.get("src")!].addedBy).toBe("importer")

    // View settings: Concept refs and overrides remapped, dangling ones dropped.
    expect(state.views[ids.views.get("v-anatomy")!].settings).toEqual({
      roots: [engine],
      containment: ["builtin:part-of"],
      pins: ["powers"],
      placement: { [spark]: engine },
      order: { [engine]: [piston, spark] },
      hide: [piston],
      fold: { [engine]: [spark] },
    })
    const table = state.views[ids.views.get("v-table")!]
    expect(table.settings).toEqual({
      rows: { kinds: ["future", "gadget"] },
      columns: [{ attribute: "size" }, { concept: engine }],
    })
    // A build under way when exported can't finish here.
    expect(table.status).toBe("failed")
  })

  it("keeps vocabulary ids; unknown built-ins become custom definitions", () => {
    const { state, ids } = importExpeditionJson(tiny(), options())
    expect(state.kinds.gadget).toMatchObject({ label: "Gadget", color: "teal" })
    expect(state.kinds.future).toMatchObject({ label: "Future", color: "pink" })
    expect(state.kinds[builtinId("risk")]).toMatchObject({ hidden: true })
    expect(state.concepts[ids.concepts.get("spark")!].kind).toBe("future")
    expect(state.relTypes.powers).toMatchObject({ label: "powers" })
    expect(state.attributes.size).toMatchObject({ type: "number", unit: "cm" })
    expect(state.concepts[ids.concepts.get("engine")!].attributes).toEqual({
      size: 3,
      tier: "a",
    })
  })

  it("mints different ids on every import of the same file", () => {
    const a = importExpeditionJson(tiny(), options())
    const next = ulidSequence(Date.parse(AT) + 10_000)
    const b = importExpeditionJson(tiny(), {
      ...options(),
      expeditionId: next(),
      newId: next,
    })
    const aIds = new Set(a.ids.concepts.values())
    for (const id of b.ids.concepts.values()) expect(aIds.has(id)).toBe(false)
  })
})

describe("validation", () => {
  const rejects = (input: unknown, match: RegExp | string) => {
    let err: unknown
    try {
      importExpeditionJson(input, options())
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ImportError)
    const e = err as ImportError
    expect(
      [e.message, ...e.issues.map((i) => `${i.path}: ${i.message}`)].join("\n")
    ).toMatch(match)
    return e
  }
  const edit = (fn: (d: ReturnType<typeof tiny>) => void) => {
    const d = tiny()
    fn(d)
    return d
  }

  it("accepts the tiny file", () => {
    expect(() => importExpeditionJson(tiny(), options())).not.toThrow()
  })
  it("rejects what isn't an object", () => {
    rejects([], /expected a JSON object/)
    rejects("hello", /expected a JSON object/)
  })
  it("rejects a newer or malformed schemaVersion", () => {
    rejects(
      edit((d) => Object.assign(d, { schemaVersion: 2 })),
      /newer/
    )
    rejects(
      edit((d) => Object.assign(d, { schemaVersion: "1" })),
      /bad schemaVersion/
    )
  })
  it("rejects a version 0 file that isn't a sample graph", () => {
    rejects({ title: "no version, no concepts" }, /version 0/)
  })
  it("rejects missing and mistyped fields", () => {
    rejects(
      edit((d) => {
        delete (d as Partial<typeof d>).concepts
      }),
      /concepts/
    )
    rejects(
      edit((d) => Object.assign(d.concepts[0], { title: "" })),
      /concepts\.0\.title/
    )
    rejects(
      edit((d) => Object.assign(d, { surprise: true })),
      /surprise/
    )
  })
  it("rejects dangling references", () => {
    rejects(
      edit((d) =>
        d.relationships!.push({ from: "nope", type: "powers", to: "engine" })
      ),
      /relationships\.2\.from: unknown Concept nope/
    )
    rejects(
      edit((d) => Object.assign(d.concepts[1], { kind: "builtin:nothing" })),
      /unknown Kind builtin:nothing/
    )
    rejects(
      edit((d) => Object.assign(d.relationships![0], { type: "zaps" })),
      /unknown Relationship Type zaps/
    )
    rejects(
      edit((d) => Object.assign(d.concepts[0], { attributes: { weight: 1 } })),
      /unknown Attribute weight/
    )
    rejects(
      edit((d) => Object.assign(d.concepts[0], { attributes: { tier: "z" } })),
      /does not fit enum Attribute tier/
    )
    rejects(
      edit((d) => {
        ;(d.views![0].settings as { pins: string[] }).pins = ["zaps"]
      }),
      /views\.0\.settings\.pins: unknown Relationship Type zaps/
    )
  })
  it("rejects duplicate ids", () => {
    rejects(
      edit((d) =>
        d.concepts.push({ id: "engine", title: "Again", kind: "gadget" })
      ),
      /duplicate Concept id engine/
    )
    rejects(
      edit(
        (d) =>
          (d.concepts[1].sections = [
            { id: "engine-lead", heading: "", md: "x" },
          ])
      ),
      /duplicate section id engine-lead/
    )
    rejects(
      edit((d) => d.relationships!.push({ ...d.relationships![0] })),
      /duplicate Relationship/
    )
  })
  it("rejects invalid View settings and newer settings versions", () => {
    rejects(
      edit((d) => Object.assign(d.views![0].settings, { roots: "engine" })),
      /views\.0\.settings\.roots/
    )
    rejects(
      edit((d) => Object.assign(d.views![0], { settingsVersion: 9 })),
      /newer than this server/
    )
  })
  it("parses without importing", () => {
    const doc = parseExpeditionJson(tiny())
    expect(doc.concepts[1]).toMatchObject({
      aliases: [],
      tags: [],
      sections: [],
    })
  })
})

describe("remapConceptLinks", () => {
  const map = new Map([
    ["kv-cache", "01K"],
    ["mha", "01M"],
  ])
  it("rewrites #c/ links through the map and leaves others", () => {
    expect(
      remapConceptLinks(
        "See [the cache](#c/kv-cache), [MHA](#c/mha). Also <#c/mha>, [x](#c/nope) and [web](https://example.com/#c/mha-ish).",
        map
      )
    ).toBe(
      "See [the cache](#c/01K), [MHA](#c/01M). Also <#c/01M>, [x](#c/nope) and [web](https://example.com/#c/mha-ish)."
    )
  })
})
