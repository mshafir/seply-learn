// The curator's stages, driven by a scripted model (no provider, no spend):
// the Concept set, a View built, inspected, reviewed and committed, a View
// failed with a plain reason, the chunk plan and the deterministic merge, and
// the prompt-cache layout.
import {
  emptyState,
  keysAfter,
  VIEW_TYPE_IDS,
  VIEW_TYPES,
  type DomainState,
} from "@seply/domain"
import type { ModelMessage } from "ai"
import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { CHAT, stubViewReader } from "../test/printer.ts"
import { idsFrom, scriptedModel, type ScriptTurn } from "../testing.ts"
import {
  applyBodies,
  autoMerge,
  buildView,
  conceptSetLabel,
  describeConcepts,
  extractConcepts,
  placeholderSettings,
  previewNodes,
  understand,
} from "./curator.ts"
import { rollCache } from "./loop.ts"
import { planSources, renderSources, type CuratorSource } from "./sources.ts"

const SOURCES: CuratorSource[] = [{ id: "chat", title: "Printer chat", segments: CHAT }]

function base(): DomainState {
  return {
    ...emptyState("e1", "Which printer?"),
    sources: {
      chat: {
        id: "chat",
        kind: "chat",
        title: "Printer chat",
        addedBy: "u",
        addedAt: "2026-09-01T00:00:00.000Z",
      },
    },
  }
}

const idGen = () => {
  let n = 0
  return () => `n${n++}`
}

const prov = (segment: string) => [{ source: "chat", segment }]

/** The Concept stage's script: a hub and four Concepts, then their part-of links. */
function conceptScript(t: ScriptTurn) {
  if (t.step === 0)
    return {
      calls: [
        { tool: "concept_create", input: { title: "Choosing a printer", kind: "builtin:topic", tags: ["topic"], prov: prov("t1") } },
        { tool: "concept_create", input: { title: "Orbit P2", kind: "builtin:thing", summary: "Enclosed, runs ABS.", prov: prov("t2") } },
        { tool: "concept_create", input: { title: "Kite", kind: "builtin:thing", prov: prov("t4") } },
        { tool: "concept_create", input: { title: "Box S1", kind: "builtin:thing", prov: prov("t4") } },
        { tool: "concept_create", input: { title: "Enclosed", kind: "builtin:criterion", prov: prov("t1") } },
      ],
    }
  if (t.step === 1) {
    const [hub, ...rest] = idsFrom(t, "concept_create")
    return {
      calls: rest.map((id) => ({
        tool: "relationship_add",
        input: { from: id, type: "builtin:part-of", to: hub, prov: prov("t1") },
      })),
    }
  }
  return { text: "Found 5 Concepts." }
}

async function conceptSet() {
  const model = scriptedModel(conceptScript)
  const r = await extractConcepts({
    model,
    sources: SOURCES,
    state: base(),
    note: "They want an enclosed printer for the kids.",
    newId: idGen(),
  })
  return { r, model, state: applyBodies(base(), r.bodies) }
}

function withQueuedView(state: DomainState, viewType: "outline" | "comparison-table") {
  return applyBodies(state, [
    {
      kind: "view.create",
      target: "v1",
      value: {
        viewType,
        label: viewType === "outline" ? "Outline" : "Compare printers",
        orderKey: keysAfter(null, 1)[0]!,
        settings: placeholderSettings(viewType),
        status: "queued",
      },
    },
  ])
}

describe("the understanding note", () => {
  it("reads the whole Sources and returns the note", async () => {
    const model = scriptedModel(() => ({ text: "  They want an enclosed printer.  " }))
    const note = await understand({ model, sources: SOURCES, whole: true })
    expect(note).toBe("They want an enclosed printer.")
    expect(model.turns[0]!.user).toContain("[t3 · user]")
    expect(model.turns[0]!.tools).toEqual([])
  })
})

describe("the Concept set", () => {
  it("builds Concepts and Relationships through the tools, and commits nothing itself", async () => {
    const { r, state, model } = await conceptSet()
    expect(r.bodies.filter((b) => b.kind === "concept.create")).toHaveLength(5)
    expect(r.bodies.filter((b) => b.kind === "relationship.add")).toHaveLength(4)
    expect(Object.keys(state.concepts)).toHaveLength(5)
    expect(r.summary).toBe("Found 5 Concepts.")
    // The playbook is the instructions; the Sources and the note are the prompt.
    const first = model.turns[0]!
    expect(first.system).toContain("# The contract")
    expect(first.system).toContain("# Build the Concept set")
    expect(first.user).toContain('<source id="chat"')
    expect(first.user).toContain("They want an enclosed printer")
    expect(first.tools).toContain("concept_create")
    expect(first.tools).not.toContain("view_build")
    expect(conceptSetLabel(5, 1)).toBe("Found 5 Concepts in 1 Source")
  })

  it("asks the agent to fix a Relationship to a missing Concept before it returns", async () => {
    // The only way to leave a dangling end through the tools is a merge; here
    // the script links to an id that was never created, which the domain refuses.
    const model = scriptedModel((t) => {
      if (t.step === 0)
        return { calls: [{ tool: "relationship_add", input: { from: "nope", type: "builtin:part-of", to: "gone" } }] }
      return { text: "done" }
    })
    const r = await extractConcepts({ model, sources: SOURCES, state: base(), note: "", newId: idGen() })
    // Refused at the tool, so nothing dangles and nothing is staged.
    expect(model.turns[1]!.results[0]!.output).toMatchObject({ ok: false })
    expect(r.bodies).toEqual([])
  })
})

describe("building a View", () => {
  it("builds, inspects, reviews and commits the queued View as its own Change", async () => {
    const { state } = await conceptSet()
    const s = withQueuedView(state, "outline")
    const previews: number[] = []
    const model = scriptedModel((t) => {
      if (t.step === 0)
        return {
          calls: [
            {
              tool: "view_build",
              input: { viewType: "outline", label: "What's in here", question: "What's in here?", settings: { relationshipTypes: ["builtin:part-of"], rootTag: "topic" } },
            },
          ],
        }
      if (t.step === 1) return { calls: [{ tool: "view_inspect", input: { viewId: "v1" } }] }
      if (t.step === 2)
        return { calls: [{ tool: "view_commit", input: { review: "It reads top to bottom: the hub, then the three printers and the criterion." } }] }
      throw new Error("the loop should have stopped after the commit")
    })
    const r = await buildView({
      model,
      sources: SOURCES,
      state: s,
      note: "",
      view: { id: "v1", viewType: "outline", label: "Outline", question: "What's in here?" },
      views: stubViewReader(),
      whole: true,
      newId: idGen(),
      onStep: ({ state, staged }) => void previews.push(previewNodes(state, staged).length),
    })
    expect(r.status).toBe("ready")
    if (r.status !== "ready") return
    expect(r.label).toBe("Built What's in here")
    expect(r.review).toMatch(/reads top to bottom/)
    const after = applyBodies(s, r.bodies)
    expect(after.views.v1).toMatchObject({ status: "ready", label: "What's in here" })
    // It built the queued View, never a new one.
    expect(Object.keys(after.views)).toEqual(["v1"])
    expect(model.turns[0]!.user).toContain("# Outline")
    expect(model.turns[0]!.system).toContain("# Build one View")
    expect(previews).toHaveLength(3)
  })

  it("keeps the View it was given even when the agent passes another viewId", async () => {
    const { state } = await conceptSet()
    const s = withQueuedView(state, "outline")
    const model = scriptedModel((t) =>
      t.step === 0
        ? { calls: [{ tool: "view_build", input: { viewId: "other", viewType: "outline", label: "X", settings: { relationshipTypes: [] } } }] }
        : t.step === 1
          ? { calls: [{ tool: "view_commit", input: { review: "A plain outline of the printers and the hub." } }] }
          : { text: "?" }
    )
    const r = await buildView({ model, sources: SOURCES, state: s, note: "", view: { id: "v1", viewType: "outline", label: "Outline" }, views: stubViewReader(), whole: true })
    expect(r.status).toBe("ready")
    if (r.status === "ready") expect(Object.keys(applyBodies(s, r.bodies).views)).toEqual(["v1"])
  })

  it("refuses the commit while checks fail, and fails the View with the agent's plain reason", async () => {
    const { state } = await conceptSet()
    const s = withQueuedView(state, "comparison-table")
    const model = scriptedModel((t) => {
      if (t.step === 0) return { calls: [{ tool: "view_commit", input: { review: "Committing the table as it stands, to see." } }] }
      if (t.step === 1) {
        expect(t.results[0]!.output).toMatchObject({ ok: false, error: expect.stringMatching(/^Build the View first/) })
        return { calls: [{ tool: "view_fail", input: { reason: "Only one printer has any verdicts, so there's nothing to compare." } }] }
      }
      throw new Error("the loop should have stopped after view_fail")
    })
    const r = await buildView({ model, sources: SOURCES, state: s, note: "", view: { id: "v1", viewType: "comparison-table", label: "Compare printers" }, views: stubViewReader(), whole: true })
    expect(r).toMatchObject({ status: "failed", reason: "Only one printer has any verdicts, so there's nothing to compare." })
  })

  it("nudges an agent that stops without committing, then fails with a plain reason", async () => {
    const { state } = await conceptSet()
    const s = withQueuedView(state, "comparison-table")
    const model = scriptedModel(() => ({ text: "I think it's fine." }))
    const r = await buildView({ model, sources: SOURCES, state: s, note: "", view: { id: "v1", viewType: "comparison-table", label: "Compare printers" }, views: stubViewReader(), whole: true })
    expect(model.turns).toHaveLength(3) // the task, then two nudges
    expect(model.turns[1]!.user).toContain("You stopped without committing")
    expect(r.status).toBe("failed")
    if (r.status === "failed") expect(r.reason).toMatch(/^This View couldn.t be built/)
  })
})

describe("the tools a provider gets", () => {
  it("are all object schemas at the top, in every stage and for every View Type", async () => {
    const schemas: [string, unknown][] = []
    const grab = (t: ScriptTurn) => {
      schemas.push(...Object.entries(t.toolSchemas))
      return { text: "stop" }
    }
    await extractConcepts({ model: scriptedModel(grab), sources: SOURCES, state: base(), note: "" })
    for (const viewType of VIEW_TYPE_IDS) {
      const s = applyBodies(base(), [
        {
          kind: "view.create",
          target: "v1",
          value: { viewType, label: "V", orderKey: keysAfter(null, 1)[0]!, settings: placeholderSettings(viewType), status: "queued" },
        },
      ])
      await buildView({ model: scriptedModel(grab), sources: SOURCES, state: s, note: "", view: { id: "v1", viewType, label: "V" }, views: stubViewReader(), whole: true })
    }
    expect(schemas.length).toBeGreaterThan(50)
    for (const [name, schema] of schemas) expect([name, (schema as { type?: string }).type]).toEqual([name, "object"])
  })
})

describe("Sources in context", () => {
  it("reads the whole set when it fits, else plans chunks of consecutive segments", () => {
    const model = { provider: "gateway", modelId: "anthropic/claude-opus-5.5" }
    expect(planSources(SOURCES, model).mode).toBe("whole")
    const plan = planSources(SOURCES, model, { maxTokens: 10, chunkTokens: 40 })
    expect(plan.mode).toBe("chunks")
    if (plan.mode !== "chunks") return
    const ids = plan.chunks.flatMap((c) => c.flatMap((p) => p.segments))
    expect(ids).toEqual(["t1", "t2", "t3", "t4"])
    expect(plan.chunks.length).toBeGreaterThan(1)
  })

  it("tags every segment with its id and speaker", () => {
    const text = renderSources(SOURCES)
    expect(text).toContain("[t1 · user]\nWe want a 3D printer")
    expect(text).toContain("[t2 · assistant]")
  })
})

describe("the deterministic merge", () => {
  it("merges Concepts of one Kind whose normalized titles or aliases match", () => {
    const s = applyBodies(base(), [
      { kind: "concept.create", target: "a", value: { title: "The Orbit P2", kind: "builtin:thing" } },
      { kind: "concept.create", target: "b", value: { title: "orbit p2!", kind: "builtin:thing" } },
      { kind: "concept.create", target: "c", value: { title: "Orbit P2", kind: "builtin:criterion" } },
      { kind: "concept.create", target: "h", value: { title: "Hub", kind: "builtin:topic" } },
      { kind: "relationship.add", target: "b|builtin:part-of|h", value: {} },
    ])
    const after = applyBodies(s, autoMerge(s))
    // b had the Relationship, so it survives; a becomes its alias. c is another Kind.
    expect(after.concepts.a!.deletedAt).not.toBeNull()
    expect(after.concepts.b!.aliases).toContain("The Orbit P2")
    expect(after.concepts.c!.deletedAt).toBeNull()
    expect(autoMerge(after)).toEqual([])
  })
})

describe("the helpers", () => {
  it("has placeholder settings that parse for every View Type", () => {
    for (const t of VIEW_TYPE_IDS)
      expect(VIEW_TYPES[t].shared.safeParse(placeholderSettings(t)).success).toBe(true)
  })

  it("lists the Concept set with ids, Kinds and Relationships", async () => {
    const { state } = await conceptSet()
    const text = describeConcepts(state)
    expect(text).toMatch(/^Concepts \(5\)/)
    expect(text).toContain("n1 | Orbit P2 | thing | Enclosed, runs ABS.")
    expect(text).toContain("n1 -part-of-> n0")
  })

  it("keeps one rolling cache breakpoint, on the newest message", () => {
    const eph = { anthropic: { cacheControl: { type: "ephemeral" } } }
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "src", providerOptions: eph }] },
      { role: "assistant", content: "a", providerOptions: eph },
      { role: "user", content: "b" },
    ]
    const out = rollCache(msgs)
    expect(out[0]!.content).toEqual(msgs[0]!.content)
    expect(out[1]!.providerOptions).toBeUndefined()
    expect(out[2]!.providerOptions).toEqual(eph)
  })
})

describe("the playbook", () => {
  it("src/playbook.gen.ts matches playbook/ and docs/view-types/", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/build-playbook.mjs", "--check"], {
        cwd: new URL("../../", import.meta.url),
        stdio: "pipe",
      })
    ).not.toThrow()
  })
})
