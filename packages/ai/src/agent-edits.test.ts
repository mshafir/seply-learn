// Agent edits (issue #139): the Expedition's title, summary and Tags, a
// Concept's article, and Attributes, through the curator tools that Grow and
// MCP `propose_changes` share. Deterministic: no model.
import {
  isLive,
  waiting,
  withDependencies,
  withDependents,
  type DomainState,
} from "@seply/domain"
import { describe, expect, it } from "vitest"
import { itemsFrom } from "./curator/grow.ts"
import { stageProposal } from "./mcp.ts"
import { printerTools, stubViewReader } from "./test/printer.ts"
import { ARTICLE_MAX_CHARS } from "./tools.ts"

const ok = (r: unknown) => {
  expect(r).toMatchObject({ ok: true })
  return r as { ok: true; id: string }
}

const sectionsOf = (state: DomainState, conceptId: string) =>
  Object.values(state.sections)
    .filter((s) => isLive(s) && s.conceptId === conceptId)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))
    .map((s) => ({ heading: s.heading, md: s.md }))

describe("expedition_update", () => {
  it("changes the title, summary and Tags, and only what changes", async () => {
    const t = printerTools()
    ok(
      await t.tools.expedition_update.execute({
        title: "Choosing a printer",
        summary: "A 3D printer for the kids.",
        addTags: ["#printing", "synthetic"],
      })
    )
    expect(t.stage.state.expedition).toMatchObject({
      title: "Choosing a printer",
      summary: "A 3D printer for the kids.",
      tags: ["printing", "synthetic"],
    })
    t.stage.take()
    ok(
      await t.tools.expedition_update.execute({
        title: "Choosing a printer",
        removeTags: ["synthetic"],
        summary: null,
      })
    )
    // The unchanged title wrote nothing; the summary was cleared.
    expect(t.stage.take().map((b) => b.kind)).toEqual([
      "expedition.set",
      "expedition.tag.remove",
    ])
    expect(t.stage.state.expedition.summary).toBe("")
    expect(t.stage.state.expedition.tags).toEqual(["printing"])
  })

  it("refuses what can't apply, with the reason", async () => {
    const t = printerTools()
    expect(
      await t.tools.expedition_update.execute({ removeTags: ["nope"] })
    ).toEqual({
      ok: false,
      error: "the Expedition has no Tag #nope; its Tags: none",
    })
    expect(
      await t.tools.expedition_update.execute({ title: "Which printer?" })
    ).toEqual({
      ok: false,
      error: "nothing to change: the Expedition already reads like that",
    })
    expect(
      await t.tools.expedition_update.execute({ title: "" })
    ).toMatchObject({ ok: false, error: expect.stringContaining("title") })
    expect(
      await t.tools.expedition_update.execute({ status: "ready" } as never)
    ).toMatchObject({ ok: false, error: expect.stringContaining("status") })
    expect(t.stage.staged).toEqual([])
  })
})

describe("attribute_create and attribute_update", () => {
  it("creates an Attribute, then changes its label, unit and values but never its type", async () => {
    const t = printerTools()
    ok(
      await t.tools.attribute_create.execute({
        id: "priority",
        label: "Priority",
        type: "enum",
        enumValues: ["hard", "nice"],
      })
    )
    expect(
      await t.tools.attribute_create.execute({
        id: "priority",
        label: "Again",
        type: "text",
      })
    ).toEqual({
      ok: false,
      error:
        "Attribute priority already exists (enum); change it with attribute_update",
    })
    ok(
      await t.tools.attribute_update.execute({
        id: "priority",
        label: "How much it matters",
        enumValues: ["hard", "nice", "dropped"],
      })
    )
    expect(t.stage.state.attributes.priority).toMatchObject({
      type: "enum",
      label: "How much it matters",
      enumValues: ["hard", "nice", "dropped"],
    })
    expect(
      await t.tools.attribute_update.execute({
        id: "priority",
        type: "text",
      } as never)
    ).toEqual({
      ok: false,
      error:
        "input: an Attribute's type is fixed at creation and can't be changed",
    })
    expect(
      await t.tools.attribute_update.execute({ id: "nope", label: "x" })
    ).toEqual({
      ok: false,
      error: "Attribute nope not found; create it with attribute_create",
    })

    ok(
      await t.tools.attribute_create.execute({
        id: "price",
        label: "Price",
        type: "money",
        unit: "USD",
      })
    )
    expect(
      await t.tools.attribute_update.execute({ id: "price", enumValues: ["a"] })
    ).toEqual({
      ok: false,
      error: "Attribute price is money; only enum Attributes have values",
    })
    ok(await t.tools.attribute_update.execute({ id: "price", unit: null }))
    expect(t.stage.state.attributes.price!.unit).toBeUndefined()
    expect(
      await t.tools.attribute_create.execute({
        id: "x",
        label: "X",
        type: "enum",
      })
    ).toMatchObject({ ok: false, error: expect.stringContaining("enumValues") })
    expect(
      await t.tools.attribute_create.execute({
        id: "y",
        label: "Y",
        type: "text",
        enumValues: ["a"],
      })
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("only enum Attributes have enumValues"),
    })
  })

  it("refuses to drop an enum value a Concept still has", async () => {
    const t = printerTools()
    ok(
      await t.tools.attribute_create.execute({
        id: "priority",
        label: "Priority",
        type: "enum",
        enumValues: ["hard", "nice"],
      })
    )
    const { id } = ok(
      await t.tools.concept_create.execute({
        title: "Enclosed",
        kind: "builtin:criterion",
        attributes: { priority: "nice" },
      })
    )
    expect(
      await t.tools.attribute_update.execute({
        id: "priority",
        enumValues: ["hard"],
      })
    ).toEqual({
      ok: false,
      error: `1 Concept has a value this drops (nice): Enclosed (${id}). Change their values first.`,
    })
  })
})

describe("concept_update's article", () => {
  it("writes, replaces and removes a Concept's whole article", async () => {
    const t = printerTools()
    const { id } = ok(
      await t.tools.concept_create.execute({
        title: "Kite",
        kind: "builtin:thing",
      })
    )
    ok(
      await t.tools.concept_update.execute({
        id,
        article: "An open frame.\n\n## Price\n\nCheap.\n\n## Colour\n\nOne.",
      })
    )
    expect(sectionsOf(t.stage.state, id)).toEqual([
      { heading: "", md: "An open frame." },
      { heading: "Price", md: "Cheap." },
      { heading: "Colour", md: "One." },
    ])
    expect(
      await t.tools.concept_update.execute({
        id,
        article: "An open frame.\n\n## Price\n\nCheap.\n\n## Colour\n\nOne.",
      })
    ).toEqual({ ok: false, error: "article: unchanged" })
    ok(
      await t.tools.concept_update.execute({
        id,
        article: "## Price\n\nCheaper.",
      })
    )
    expect(sectionsOf(t.stage.state, id)).toEqual([
      { heading: "Price", md: "Cheaper." },
    ])
    ok(await t.tools.concept_update.execute({ id, article: null }))
    expect(sectionsOf(t.stage.state, id)).toEqual([])
    expect(await t.tools.concept_update.execute({ id, article: "  " })).toEqual(
      {
        ok: false,
        error: "article: empty; send null to remove the article",
      }
    )
    expect(
      await t.tools.concept_update.execute({
        id,
        article: "x".repeat(ARTICLE_MAX_CHARS + 1),
      })
    ).toMatchObject({ ok: false, error: expect.stringContaining("article") })
  })

  it("is one Grow item with the Concept's other edits", async () => {
    const t = printerTools()
    const { id } = ok(
      await t.tools.concept_create.execute({
        title: "Kite",
        kind: "builtin:thing",
      })
    )
    ok(await t.tools.concept_update.execute({ id, article: "Old." }))
    t.stage.take()
    ok(
      await t.tools.concept_update.execute({
        id,
        summary: "Open.",
        article: "New.",
      })
    )
    ok(
      await t.tools.expedition_update.execute({
        title: "Printers",
        addTags: ["kids"],
      })
    )
    ok(
      await t.tools.attribute_create.execute({
        id: "price",
        label: "Price",
        type: "money",
      })
    )
    const items = itemsFrom(t.stage.take(), t.stage.state)
    expect(items.map((i) => i.ops.map((o) => o.kind))).toEqual([
      ["concept.set", "section.delete", "section.create"],
      ["expedition.set", "expedition.tag.add"],
      ["attribute.define"],
    ])
  })
})

describe("propose_changes with the new items", () => {
  it("creates an Attribute and a Comparison View that relies on it in one Proposal", async () => {
    const t = printerTools()
    for (const title of ["Orbit P2", "Kite", "Box S1"])
      ok(await t.tools.concept_create.execute({ title, kind: "builtin:thing" }))
    t.stage.take()
    const state = t.stage.state
    let n = 0
    const out = await stageProposal({
      state,
      views: stubViewReader(),
      newId: () => `p${n++}`,
      items: [
        {
          tool: "expedition_update",
          input: { summary: "Choosing a printer.", addTags: ["printing"] },
        },
        {
          tool: "attribute_create",
          input: {
            id: "priority",
            label: "Priority",
            type: "enum",
            enumValues: ["hard", "nice", "dropped"],
          },
        },
        {
          tool: "concept_create",
          ref: "new:enclosed",
          input: {
            title: "Enclosed",
            kind: "builtin:criterion",
            summary: "It has to be enclosed.",
            attributes: { priority: "hard" },
          },
        },
        {
          tool: "view_build",
          input: {
            viewType: "comparison-table",
            label: "Which printer?",
            settings: {
              rows: { kinds: ["builtin:thing"] },
              columns: [{ criteria: "auto" }],
              priority: "priority",
            },
          },
        },
        {
          tool: "concept_update",
          input: { id: "n0", article: "## Why\n\nEnclosed." },
        },
      ],
    })
    expect(out.results.map((r) => (r.ok ? r.tool : r.error))).toEqual([
      "expedition_update",
      "attribute_create",
      "concept_create",
      "view_build",
      "concept_update",
    ])
    const pool = out.items.map((it, i) => ({ id: `i${i}`, ops: it.ops }))
    // The View and the criterion need the Attribute: accepting either brings it,
    // and alone they wait for it.
    expect(withDependencies(state, pool, ["i3"]).ids).toEqual(["i1", "i3"])
    expect([...waiting(state, pool, ["i2"]).entries()]).toEqual([
      ["i2", ["priority"]],
    ])
    expect(waiting(state, pool, ["i1", "i2"]).size).toBe(0)
    // Dismissing the Attribute dismisses what needs it.
    expect(withDependents(state, pool, ["i1"])).toEqual(["i1", "i2", "i3"])
  })

  it("proposes an Attribute's new label, keeping its type", async () => {
    const t = printerTools()
    ok(
      await t.tools.attribute_create.execute({
        id: "price",
        label: "Price",
        type: "money",
      })
    )
    t.stage.take()
    const out = await stageProposal({
      state: t.stage.state,
      items: [
        { tool: "attribute_update", input: { id: "price", label: "Cost" } },
      ],
    })
    expect(out.results[0]).toMatchObject({ ok: true })
    expect(out.items[0]!.ops).toEqual([
      {
        kind: "attribute.define",
        target: "price",
        value: { label: "Cost", type: "money" },
      },
    ])
  })
})
