// The MCP tools' shared definitions: inputs are the curator tools' schemas,
// and propose_changes / create_expedition run through the curator tools.
// Deterministic: no model.
import { relKey, type DomainState, type OpBody } from "@seply/domain"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  CreateExpeditionInput,
  MCP_INSTRUCTIONS,
  MCP_TOOLS,
  ProposeChangesInput,
  stageFirstBuild,
  stageProposal,
} from "./mcp.ts"
import { CHAT, printerTools, stubViewReader } from "./test/printer.ts"

const ids = (prefix = "n") => {
  let n = 0
  return () => `${prefix}${n++}`
}

/** The printer Expedition with a hub and one option in it. */
async function printer(): Promise<DomainState> {
  const t = printerTools()
  await t.tools.concept_create.execute({
    title: "Printers",
    kind: "builtin:topic",
    tags: ["topic"],
  })
  await t.tools.concept_create.execute({
    title: "Orbit P2",
    kind: "builtin:thing",
    prov: [{ source: "chat", segment: "t2" }],
  })
  await t.tools.relationship_add.execute({
    from: "n1",
    type: "builtin:part-of",
    to: "n0",
  })
  t.stage.take()
  return t.stage.state
}

describe("the MCP tool catalog", () => {
  it("names every §6.2 tool, each with a scope and an input a client can take as JSON Schema", () => {
    expect(Object.keys(MCP_TOOLS).sort()).toEqual(
      [
        "create_expedition",
        "get_concept",
        "get_expedition",
        "get_source_segments",
        "get_view",
        "list_expeditions",
        "list_my_proposals",
        "list_sources",
        "propose_changes",
        "search",
        "withdraw_proposal",
      ].sort()
    )
    for (const [name, t] of Object.entries(MCP_TOOLS)) {
      expect(name).toMatch(/^[a-z_]{1,64}$/)
      expect(t.description.length, name).toBeGreaterThan(40)
      expect(() => z.toJSONSchema(t.input, { io: "input" }), name).not.toThrow()
    }
    expect(MCP_TOOLS.propose_changes.scope).toBe("proposals:write")
    expect(MCP_TOOLS.create_expedition.scope).toBe("expeditions:create")
    expect(MCP_TOOLS.get_view.readOnly).toBe(true)
  })

  it("takes propose_changes items exactly as the curator tools take them", () => {
    const schema = z.toJSONSchema(ProposeChangesInput, { io: "input" }) as {
      properties: { items: { items: { oneOf?: unknown[]; anyOf?: unknown[] } } }
    }
    const variants =
      schema.properties.items.items.oneOf ?? schema.properties.items.items.anyOf
    expect(variants).toHaveLength(5)
    // A positions field is refused, as by the curator's view_build.
    expect(
      ProposeChangesInput.safeParse({
        expedition: "e1",
        rationale: "r",
        items: [
          {
            tool: "view_build",
            input: {
              viewType: "outline",
              label: "O",
              settings: { relationshipTypes: [], positions: {} },
            },
          },
        ],
      }).success
    ).toBe(false)
  })

  it("mirrors the seply-learn skill as the server's instructions", () => {
    expect(MCP_INSTRUCTIONS.startsWith("# Seply Learn")).toBe(true)
    expect(MCP_INSTRUCTIONS).toContain("propose_changes")
    expect(MCP_INSTRUCTIONS).not.toContain("name: seply-learn")
  })
})

describe("stageProposal", () => {
  it("makes one item per call, resolves temp ids, and skips refused items", async () => {
    const state = await printer()
    const out = await stageProposal({
      state,
      newId: ids("k"),
      items: [
        {
          tool: "concept_create",
          ref: "new:kite",
          input: {
            title: "Kite",
            kind: "builtin:thing",
            summary: "An open-frame printer.",
            overview: "The Kite is open, unlike the [Orbit P2](#c/n1).",
            prov: [{ source: "chat", segment: "t4" }],
          },
        },
        {
          tool: "relationship_add",
          input: { from: "new:kite", type: "builtin:part-of", to: "n0" },
        },
        {
          tool: "relationship_add",
          input: { from: "new:nope", type: "builtin:part-of", to: "n0" },
        },
        {
          tool: "concept_update",
          input: {
            id: "n1",
            overview: "Enclosed, unlike the [Kite](#c/new:kite).",
            addTags: ["enclosed"],
          },
        },
        { tool: "concept_update", input: { id: "missing", addTags: ["x"] } },
      ],
    })
    expect(out.ids).toEqual({ "new:kite": "k0" })
    expect(out.results.map((r) => r.ok)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ])
    expect(out.results[2]).toMatchObject({
      ok: false,
      error: expect.stringContaining("new:nope"),
    })
    expect(out.items).toHaveLength(3)
    const create = out.items[0]!.ops[0] as Extract<
      OpBody,
      { kind: "concept.create" }
    >
    expect(create).toMatchObject({ kind: "concept.create", target: "k0" })
    expect(out.items[1]!.ops).toEqual([
      {
        kind: "relationship.add",
        target: relKey("k0", "builtin:part-of", "n0"),
        value: {},
      },
    ])
    // Overview links to temp ids become real ids too.
    expect(out.items[2]!.ops).toEqual([
      {
        kind: "concept.set",
        target: "n1",
        path: "overview",
        value: "Enclosed, unlike the [Kite](#c/k0).",
      },
      { kind: "concept.tag.add", target: "n1", value: "enclosed" },
    ])
  })

  it("takes a View only when view.inspect passes, and proposes it ready", async () => {
    const state = await printer()
    const outline = {
      tool: "view_build" as const,
      input: {
        viewType: "outline",
        label: "Printers",
        settings: { relationshipTypes: ["builtin:part-of"] },
      },
    }
    const none = await stageProposal({ state, items: [outline] })
    expect(none.results[0]).toMatchObject({
      ok: false,
      error: "Views can't be suggested here",
    })

    const ok = await stageProposal({
      state,
      items: [outline],
      views: stubViewReader(),
      newId: ids("v"),
    })
    expect(ok.results[0]).toMatchObject({ ok: true, id: "v0" })
    expect(ok.items[0]!.ops.map((o) => o.kind)).toEqual([
      "view.create",
      "view.set",
    ])
    expect(ok.items[0]!.ops[1]).toMatchObject({
      path: "status",
      value: "ready",
    })

    const cluttered = await stageProposal({
      state,
      items: [outline],
      views: stubViewReader({ verdict: "cluttered" }),
    })
    expect(cluttered.results[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining("problems"),
    })
    expect(cluttered.items).toEqual([])
  })
})

describe("stageFirstBuild", () => {
  const input = (over: Partial<z.input<typeof CreateExpeditionInput>> = {}) =>
    CreateExpeditionInput.parse({
      title: "Which printer?",
      summary: "Choosing a 3D printer for the kids.",
      tags: ["printing"],
      sources: [
        {
          ref: "new:chat",
          title: "Printer chat",
          kind: "chat",
          segments: CHAT,
        },
      ],
      concepts: [
        {
          ref: "new:printers",
          title: "Printers",
          kind: "builtin:topic",
          tags: ["topic"],
          summary: "The options.",
        },
        {
          ref: "new:orbit",
          title: "Orbit P2",
          kind: "builtin:thing",
          summary: "Enclosed, multicolour.",
          prov: [{ source: "new:chat", segment: "t2" }],
        },
      ],
      relationships: [
        {
          from: "new:orbit",
          type: "builtin:part-of",
          to: "new:printers",
          prov: [{ source: "new:chat", segment: "t2" }],
        },
      ],
      views: [
        {
          viewType: "outline",
          label: "Printers",
          settings: {
            relationshipTypes: ["builtin:part-of"],
            rootTag: "topic",
          },
        },
      ],
      ...over,
    })
  const preamble: OpBody[] = [
    {
      kind: "source.add",
      target: "src1",
      value: {
        kind: "chat",
        title: "Printer chat",
        addedBy: "u",
        addedAt: "2026-09-01T00:00:00.000Z",
      },
    },
  ]

  it("writes the Sources, the Expedition, its Concepts, Relationships and ready Views as one build", async () => {
    const out = await stageFirstBuild({
      expeditionId: "e1",
      input: input(),
      sourceIds: { "new:chat": "src1" },
      preamble,
      views: stubViewReader(),
      newId: ids(),
    })
    if (!out.ok) throw new Error(out.errors.join("\n"))
    expect(out.counts).toEqual({ concepts: 2, relationships: 1, views: 1 })
    expect(out.ids).toEqual({ "new:printers": "n0", "new:orbit": "n1" })
    expect(out.viewIds).toEqual(["n2"])
    const kinds = out.bodies.map((b) => b.kind)
    expect(kinds[0]).toBe("source.add")
    expect(out.bodies).toContainEqual({
      kind: "expedition.set",
      target: "e1",
      path: "status",
      value: "ready",
    })
    expect(out.bodies).toContainEqual({
      kind: "expedition.set",
      target: "e1",
      path: "bestViewId",
      value: "n2",
    })
    expect(out.bodies).toContainEqual({
      kind: "view.set",
      target: "n2",
      path: "status",
      value: "ready",
    })
    expect(out.bodies).toContainEqual({
      kind: "expedition.tag.add",
      target: "e1",
      value: "printing",
    })
    // prov cites the minted Source id.
    const orbit = out.bodies.find(
      (b) => b.kind === "concept.create" && b.target === "n1"
    )
    expect(orbit).toMatchObject({
      value: { prov: [{ source: "src1", segment: "t2" }] },
    })
  })

  it("refuses the whole build with every problem it finds", async () => {
    const out = await stageFirstBuild({
      expeditionId: "e1",
      input: input({
        concepts: [
          {
            ref: "new:a",
            title: "A",
            kind: "builtin:idea",
            prov: [{ source: "new:chat", segment: "t9" }],
          },
          { ref: "new:a", title: "A again", kind: "builtin:idea" },
        ],
        relationships: [
          { from: "new:a", type: "builtin:part-of", to: "new:ghost" },
        ],
      }),
      sourceIds: { "new:chat": "src1" },
      preamble,
      views: stubViewReader(),
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.errors.join("\n")).toContain("src1#t9")
    expect(out.errors.join("\n")).toContain("temp id used twice")
    expect(out.errors.join("\n")).toContain("new:ghost")
  })

  it("refuses a View with problems", async () => {
    const out = await stageFirstBuild({
      expeditionId: "e1",
      input: input(),
      sourceIds: { "new:chat": "src1" },
      preamble,
      views: stubViewReader({ verdict: "cluttered" }),
    })
    expect(out.ok).toBe(false)
  })
})
