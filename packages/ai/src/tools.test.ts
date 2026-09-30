// The curator tools: staged ops over the domain schemas, view.inspect, and
// commit gating. Deterministic: no model, the tools are called directly.
import {
  applyAll,
  CONCEPT_FIELDS,
  emptyState,
  makeOps,
  ulidSequence,
  type DomainState,
} from "@seply/domain"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { ViewReader } from "./ports.ts"
import { CHAT, printerTools, stubViewReader } from "./test/printer.ts"
import { T0 } from "./test/fixtures.ts"
import { TOOL_NAMES, type CuratorCommit } from "./tools.ts"

type Made = { ok: true; id: string; viewId: string }
const made = (r: unknown) => {
  expect(r).toMatchObject({ ok: true })
  return r as Made
}

describe("the tool set", () => {
  it("names every tool so any provider accepts it, and maps it to the spec's name", () => {
    const t = printerTools({ onCommit: () => {} })
    expect(Object.keys(t.tools).sort()).toEqual(Object.keys(TOOL_NAMES).sort())
    for (const [name, tool] of Object.entries(t.tools)) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(tool.description.length).toBeGreaterThan(40)
      // Every input is a typed schema a provider can take as JSON Schema.
      expect(() =>
        z.toJSONSchema(tool.inputSchema as z.ZodType, { io: "input" })
      ).not.toThrow()
    }
    // view_commit only when there is somewhere for a commit to go.
    expect(Object.keys(printerTools().tools)).not.toContain("view_commit")
  })

  it("concept_update can set every field the domain lets a Concept set", () => {
    const t = printerTools()
    const schema = z.toJSONSchema(
      t.tools.concept_update.inputSchema as z.ZodType,
      { io: "input" }
    ) as { properties: object }
    for (const field of Object.keys(CONCEPT_FIELDS))
      expect(schema.properties).toHaveProperty(field)
  })

  it("view_build takes each View Type's own settings shape, not free-form JSON", () => {
    const t = printerTools()
    const schema = JSON.stringify(
      z.toJSONSchema(t.tools.view_build.inputSchema as z.ZodType, {
        io: "input",
      })
    )
    for (const key of [
      "outcomes",
      "relationshipTypes",
      "columns",
      "placement",
      "fold",
    ])
      expect(schema).toContain(`"${key}"`)
  })
})

describe("writing tools stage validated ops", () => {
  it("creates a Concept with a minted id, and refuses what the domain would", async () => {
    const t = printerTools()
    const r = made(
      await t.tools.concept_create.execute({
        title: "Kite",
        kind: "builtin:thing",
      })
    )
    expect(r.id).toBe("n0")
    expect(t.stage.state.concepts.n0).toMatchObject({
      title: "Kite",
      kind: "builtin:thing",
      prov: [],
    })
    expect(t.stage.staged).toEqual([
      {
        kind: "concept.create",
        target: "n0",
        value: { title: "Kite", kind: "builtin:thing" },
      },
    ])

    expect(
      await t.tools.concept_create.execute({ title: "Box", kind: "gadget" })
    ).toEqual({ ok: false, error: "unknown Kind gadget" })
    expect(
      await t.tools.concept_create.execute({ kind: "builtin:thing" } as never)
    ).toMatchObject({ ok: false, error: expect.stringContaining("title") })
    expect(
      await t.tools.concept_create.execute({
        title: "Box",
        kind: "builtin:thing",
        attributes: { price: 3 },
      })
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("price"),
    })
    expect(t.stage.staged).toHaveLength(1)
  })

  it("updates only what changes, and stages all of a call or none", async () => {
    const t = printerTools()
    const { id } = made(
      await t.tools.concept_create.execute({
        title: "Kite",
        kind: "builtin:thing",
        tags: ["printer"],
      })
    )
    made(
      await t.tools.attribute_define.execute({
        id: "price",
        label: "Price",
        type: "money",
      })
    )
    made(
      await t.tools.concept_update.execute({
        id,
        summary: "An open-frame printer",
        attributes: { price: 300 },
        addTags: ["cheap"],
        removeTags: ["printer"],
      })
    )
    expect(t.stage.state.concepts[id]).toMatchObject({
      summary: "An open-frame printer",
      attributes: { price: 300 },
      tags: ["cheap"],
    })
    made(await t.tools.concept_update.execute({ id, summary: null }))
    expect(t.stage.state.concepts[id]!.summary).toBeUndefined()

    const before = t.stage.staged.length
    // The title is fine, the Kind isn't: nothing of the call is staged.
    expect(
      await t.tools.concept_update.execute({
        id,
        title: "Kite 2",
        kind: "gadget",
      })
    ).toEqual({ ok: false, error: "unknown Kind gadget" })
    expect(t.stage.staged).toHaveLength(before)
    expect(t.stage.state.concepts[id]!.title).toBe("Kite")
    expect(
      await t.tools.concept_update.execute({ id: "nope", title: "x" })
    ).toEqual({ ok: false, error: "Concept nope not found" })
  })

  it("adds and removes Relationships between live Concepts", async () => {
    const t = printerTools()
    const a = made(
      await t.tools.concept_create.execute({
        title: "Attention",
        kind: "builtin:idea",
      })
    ).id
    const b = made(
      await t.tools.concept_create.execute({
        title: "KV-cache",
        kind: "builtin:idea",
      })
    ).id
    made(
      await t.tools.relationship_add.execute({
        from: a,
        type: "builtin:prerequisite",
        to: b,
        note: "caches attention keys",
      })
    )
    expect(
      t.stage.state.relationships[`${a}|builtin:prerequisite|${b}`]
    ).toMatchObject({ note: "caches attention keys", deletedAt: null })
    expect(
      await t.tools.relationship_add.execute({
        from: a,
        type: "builtin:prerequisite",
        to: "ghost",
      })
    ).toEqual({
      ok: false,
      error: "Concept ghost is missing or deleted",
    })
    made(
      await t.tools.relationship_remove.execute({
        from: a,
        type: "builtin:prerequisite",
        to: b,
      })
    )
    expect(
      await t.tools.relationship_remove.execute({
        from: a,
        type: "builtin:prerequisite",
        to: b,
      })
    ).toMatchObject({ ok: false })
  })

  it("builds a View (building, last in the rail), and changes it only within its View Type", async () => {
    const t = printerTools()
    const settings = {
      relationshipTypes: ["builtin:part-of"],
      rootTag: "topic",
    }
    const a = made(
      await t.tools.view_build.execute({
        viewType: "outline",
        label: "Outline",
        settings,
      })
    ).viewId
    const b = made(
      await t.tools.view_build.execute({
        viewType: "outline",
        label: "Second",
        question: "What's in here?",
        settings,
      })
    ).viewId
    const va = t.stage.state.views[a]!
    const vb = t.stage.state.views[b]!
    expect(va).toMatchObject({ status: "building", settingsVersion: 1 })
    expect(vb.orderKey > va.orderKey).toBe(true)
    made(
      await t.tools.view_build.execute({
        viewId: a,
        viewType: "outline",
        label: "Topics",
        settings: { ...settings, openDepth: 2 },
      })
    )
    expect(t.stage.state.views[a]).toMatchObject({
      label: "Topics",
      settings: { openDepth: 2 },
    })
    expect(
      await t.tools.view_build.execute({
        viewId: a,
        viewType: "timeline",
        label: "T",
        settings: { lanes: [] },
      })
    ).toEqual({
      ok: false,
      error: `View ${a} is a outline; build a new View for a timeline`,
    })
    // Settings outside the View Type's schema never reach the ops.
    expect(
      await t.tools.view_build.execute({
        viewType: "outline",
        label: "X",
        settings: { relationshipTypes: [], x: 1 },
      } as never)
    ).toMatchObject({ ok: false })
    // No positions anywhere: a layout is shaped through settings only.
    expect(
      await t.tools.view_build.execute({
        viewType: "outline",
        label: "X",
        settings: { ...settings, positions: {} },
      } as never)
    ).toMatchObject({ ok: false })
  })
})

describe("reading tools", () => {
  it("source_read returns the segments asked for, and names the missing ones", async () => {
    const t = printerTools()
    expect(
      await t.tools.source_read.execute({
        source: "chat",
        segments: ["t3", "t9", "t1"],
      })
    ).toEqual({
      ok: true,
      segments: [CHAT[2], CHAT[0]],
      missing: ["t9"],
    })
    expect(
      await t.tools.source_read.execute({ source: "other", segments: ["t1"] })
    ).toEqual({ ok: false, error: "Source other not found" })
    expect(
      await t.tools.source_read.execute({ source: "chat", segments: [] })
    ).toMatchObject({ ok: false })
  })

  it("search_existing matches titles and aliases however they're written", async () => {
    const t = printerTools()
    const gqa = made(
      await t.tools.concept_create.execute({
        title: "Grouped-Query Attention",
        aliases: ["GQA"],
        kind: "builtin:idea",
      })
    ).id
    const mqa = made(
      await t.tools.concept_create.execute({
        title: "Multi-Query Attention",
        kind: "builtin:idea",
      })
    ).id
    made(
      await t.tools.concept_create.execute({
        title: "The attention mechanism",
        kind: "builtin:idea",
      })
    )
    const q = async (query: string) =>
      (
        (await t.tools.search_existing.execute({ query })) as {
          hits: { id: string; match: string; title: string }[]
        }
      ).hits
    expect(await q("gqa")).toMatchObject([{ id: gqa, match: "exact" }])
    expect(await q("grouped query attention")).toMatchObject([
      { id: gqa, match: "exact" },
    ])
    expect(await q("Attention Mechanism")).toMatchObject([
      { title: "The attention mechanism", match: "exact" },
    ])
    expect((await q("query attention")).map((h) => h.id)).toEqual([gqa, mqa])
    expect(await q("flash")).toEqual([])
  })
})

/** A Learning path whose layout reads well only once it has a target filter (as on the compute sample; see @seply/views tests/inspect.test.ts). */
const learningPathReader: ViewReader = {
  async read(state, viewId) {
    const v = state.views[viewId]!
    const tangle = v.viewType === "learning-path" && !v.settings.targets
    return {
      text: `${v.label}: ${tangle ? "every prerequisite at once" : "targets and shared foundations"}`,
      layout: {
        shown: 54,
        edges: 54,
        crossings: tangle ? 41 : 1,
        edgesThroughNodes: tangle ? 19 : 0,
        veryLongEdges: 6,
        overlaps: 0,
        crossTopic: 15,
        verdict: tangle ? "cluttered" : "reads well",
      },
    }
  },
}

async function learningPathBuild(onCommit?: (c: CuratorCommit) => void) {
  const t = printerTools({
    views: learningPathReader,
    ...(onCommit && { onCommit }),
  })
  const x = t.tools
  const ids: string[] = []
  for (const title of ["Tokenizer", "Embedding", "Attention", "KV-cache"])
    ids.push(
      made(
        await x.concept_create.execute({
          title,
          kind: "builtin:idea",
          tags: title === "KV-cache" ? ["technique"] : [],
        })
      ).id
    )
  for (let i = 1; i < ids.length; i++)
    made(
      await x.relationship_add.execute({
        from: ids[i - 1]!,
        type: "builtin:prerequisite",
        to: ids[i]!,
      })
    )
  const concepts = await t.commit({ label: "Found 4 Concepts in 1 Source" })
  const view = made(
    await x.view_build.execute({
      viewType: "learning-path",
      label: "Learning path",
      settings: {
        relationshipTypes: ["builtin:prerequisite"],
        minSteps: 0,
        coreShared: 1,
      },
    })
  ).viewId
  return { t, view, concepts }
}

describe("view.inspect and commit", () => {
  it("commits the Concept set as one Change, with nothing to inspect", async () => {
    const { concepts } = await learningPathBuild()
    expect(concepts).toMatchObject({
      ok: true,
      label: "Found 4 Concepts in 1 Source",
      views: [],
    })
    expect(concepts.ok && concepts.bodies.map((b) => b.kind)).toEqual([
      ...Array(4).fill("concept.create"),
      ...Array(3).fill("relationship.add"),
    ])
  })

  it("inspect returns the reading, the layout metrics and the checks; a cluttered layout is a problem", async () => {
    const { t, view } = await learningPathBuild()
    const i = (await t.tools.view_inspect.execute({ viewId: view })) as Awaited<
      ReturnType<typeof t.inspect>
    >
    expect(i).toMatchObject({
      viewId: view,
      viewType: "learning-path",
      reading: "Learning path: every prerequisite at once",
      ok: false,
    })
    expect(i.layout?.verdict).toBe("cluttered")
    expect(i.problems).toEqual([
      {
        severity: "problem",
        code: "layout",
        message:
          "cluttered: 41 crossings of 54 edges (at most 20%), 19 edges drawn through other Concepts (at most 10%), 0 overlapping Concepts (none), 15 prerequisites cross topics. Reshape the structure: fewer cross-topic prerequisites, one parent each, levers aimed at one stage, placement or targets. Never positions",
      },
    ])
  })

  it("refuses to commit a View with problems, keeping what's staged, then commits it once fixed", async () => {
    const commits: CuratorCommit[] = []
    const { t, view } = await learningPathBuild((c) => void commits.push(c))
    const base = t.stage.base
    const blocked = await t.tools.view_commit!.execute({ viewId: view })
    expect(blocked).toMatchObject({
      ok: false,
      blocked: [
        {
          viewId: view,
          label: "Learning path",
          problems: [{ code: "layout" }],
        },
      ],
    })
    expect(t.stage.staged).toHaveLength(1)
    expect(commits.map((c) => c.label)).toEqual([
      "Found 4 Concepts in 1 Source",
    ])

    // Reshape through settings: targets, not positions.
    made(
      await t.tools.view_build.execute({
        viewId: view,
        viewType: "learning-path",
        label: "Learning path",
        settings: {
          relationshipTypes: ["builtin:prerequisite"],
          targets: { tags: ["technique"] },
          minSteps: 2,
        },
      })
    )
    const done = await t.tools.view_commit!.execute({
      viewId: view,
      label: "Built the Learning path",
    })
    expect(done).toMatchObject({
      ok: true,
      label: "Built the Learning path",
      views: [view],
    })
    expect(commits).toHaveLength(2)
    expect(t.stage.staged).toEqual([])
    expect(t.stage.state.views[view]!.status).toBe("ready")

    // The committed bodies, as ops of one Change, rebuild the same state from the last commit.
    const replay = applyAll(
      base,
      makeOps(commits[1]!.bodies, {
        expeditionId: "e1",
        actor: "curator",
        changeId: "c3",
        nextOpId: ulidSequence(T0),
      })
    )
    expect(stripTimes(replay)).toEqual(stripTimes(t.stage.state))
  })

  it("blocks a commit on a structure problem as well as layout", async () => {
    const t = printerTools({ views: stubViewReader({ verdict: "reads well" }) })
    const v = made(
      await t.tools.view_build.execute({
        viewType: "cause-and-effect",
        label: "Air",
        settings: {
          mode: "risk",
          positive: ["builtin:raises"],
          negative: ["builtin:lowers"],
          outcomes: ["nothing"],
          levers: {},
        },
      })
    ).viewId
    expect(await t.commit({ label: "Built Air" })).toMatchObject({
      ok: false,
      blocked: [
        {
          viewId: v,
          problems: [
            {
              code: "dangling-ref",
              message:
                "settings.outcomes names Concepts that don't exist: nothing",
            },
          ],
        },
      ],
    })
  })

  it("doesn't ask the reader to draw a View whose settings don't resolve", async () => {
    const reader = stubViewReader()
    const t = printerTools({ views: reader })
    const v = made(
      await t.tools.view_build.execute({
        viewType: "outline",
        label: "O",
        settings: { relationshipTypes: ["builtin:part-of"] },
      })
    ).viewId
    expect(await t.inspect("missing")).toMatchObject({
      ok: false,
      problems: [{ code: "no-view" }],
    })
    expect((await t.inspect(v)).ok).toBe(true)
    expect(reader.calls).toEqual([v])
  })
})

describe("Stage", () => {
  it("discard drops staged ops and returns to the last commit", async () => {
    const t = printerTools()
    made(
      await t.tools.concept_create.execute({
        title: "Kite",
        kind: "builtin:thing",
      })
    )
    t.stage.discard()
    expect(t.stage.staged).toEqual([])
    expect(t.stage.state).toBe(t.stage.base)
    expect(emptyState("e1").concepts).toEqual(t.stage.state.concepts)
  })
})

/** Tombstone times come from op ids, which differ between a replay and the stage. */
function stripTimes(s: DomainState) {
  return JSON.parse(
    JSON.stringify(s, (k, v) => (k === "deletedAt" && v ? "t" : v))
  )
}
