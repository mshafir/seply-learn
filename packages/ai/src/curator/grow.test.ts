// Grow (spec §5.5), driven by a scripted model on the compute sample: the
// agent is scoped to its ask (no View building, no vocabulary changes, never
// a commit), its writes come out as items after each step and nowhere else,
// a new Concept needs its summary and overview, and Stop and the per-ask cap
// keep what already came out.
import { isLive, relKey, type DomainState, type OpBody } from "@seply/domain"
import { describe, expect, it } from "vitest"
import { DEFAULT_MODELS } from "../models.ts"
import { estimateAsk } from "../estimate.ts"
import { meteredModel, SpendingCapReached, SpendMeter } from "../spend.ts"
import { loadCompute } from "../test/fixtures.ts"
import { scriptedModel, type ScriptTurn } from "../testing.ts"
import { grow, growRationale, itemsFrom, type GrowItem } from "./grow.ts"

const byTitle = (state: DomainState, title: string) =>
  Object.values(state.concepts).find((c) => c.title === title)!.id

const NF4 = {
  title: "NormalFloat (NF4)",
  kind: "builtin:idea",
  summary: "A 4-bit data type for normally distributed weights.",
  overview: "NF4 spaces its 16 levels so each holds as many weights as the others; QLoRA stores its frozen base in it.",
  tags: ["technique"],
  prov: [],
}

/** The ask "What would I need to understand QLoRA?", scripted. */
function qloraScript(state: DomainState) {
  const qlora = byTitle(state, "QLoRA")
  const quant = byTitle(state, "Weight quantization")
  const hub = byTitle(state, "Training")
  return (t: ScriptTurn) => {
    if (t.step === 0)
      return { calls: [{ tool: "search_existing", input: { query: "quantization" } }] }
    if (t.step === 1)
      return {
        calls: [
          // Refused: a suggested Concept arrives with its summary and overview.
          { tool: "concept_create", input: { title: "Double quantization", kind: "builtin:idea" } },
          { tool: "concept_create", input: NF4 },
        ],
      }
    if (t.step === 2) {
      const nf4 = t.results.find((r) => r.tool === "concept_create" && (r.output as { ok: boolean }).ok)!
      const id = (nf4.output as { id: string }).id
      return {
        calls: [
          { tool: "relationship_add", input: { from: id, type: "builtin:part-of", to: qlora } },
          { tool: "relationship_add", input: { from: quant, type: "builtin:prerequisite", to: qlora } },
          { tool: "concept_update", input: { id: qlora, aliases: ["Quantized LoRA"] } },
          { tool: "concept_update", input: { id: hub, addTags: ["fine-tuning"] } },
        ],
      }
    }
    return { text: "Added NF4 and linked weight quantization as a prerequisite." }
  }
}

describe("itemsFrom", () => {
  it("makes a new Concept, each Relationship and each existing Concept's edits one item each", () => {
    const bodies: OpBody[] = [
      { kind: "concept.create", target: "n1", value: { title: "A", kind: "builtin:idea" } },
      { kind: "concept.set", target: "old", path: "summary", value: "s" },
      { kind: "concept.set", target: "n1", path: "summary", value: "a" },
      { kind: "relationship.add", target: relKey("n1", "builtin:part-of", "old"), value: {} },
      { kind: "concept.tag.add", target: "old", value: "t" },
      { kind: "relationship.add", target: relKey("old", "builtin:prerequisite", "x"), value: {} },
    ]
    const items = itemsFrom(bodies)
    expect(items.map((i) => i.ops.map((o) => `${o.kind}:${o.target}`))).toEqual([
      ["concept.create:n1", "concept.set:n1"],
      ["concept.set:old", "concept.tag.add:old"],
      [`relationship.add:${relKey("n1", "builtin:part-of", "old")}`],
      [`relationship.add:${relKey("old", "builtin:prerequisite", "x")}`],
    ])
  })
})

describe("growRationale", () => {
  it("is the reader's words, or the Concept action in words", () => {
    const { state } = loadCompute()
    const qlora = byTitle(state, "QLoRA")
    expect(growRationale({ text: "  What would I need to understand QLoRA? " }, state)).toBe(
      "What would I need to understand QLoRA?"
    )
    expect(growRationale({ action: "missing", conceptId: qlora }, state)).toBe(
      "Add what's missing to understand QLoRA"
    )
    expect(growRationale({ action: "examples", conceptId: qlora }, state)).toBe("Add examples of QLoRA")
    expect(growRationale({ action: "related", conceptId: qlora }, state)).toBe(
      "Suggest Concepts related to QLoRA"
    )
  })
})

describe("grow", () => {
  it("writes only to its items, step by step, and never to the Expedition", async () => {
    const { state } = loadCompute()
    const before = structuredClone(state)
    const model = scriptedModel(qloraScript(state))
    const batches: GrowItem[][] = []
    let n = 0
    const r = await grow({
      model,
      state,
      sources: [],
      whole: true,
      ask: { text: "What would I need to understand QLoRA?" },
      newId: () => `g${n++}`,
      onItems: async (items) => void batches.push(items),
    })

    // Scoped: concept and relationship tools, no Views, no vocabulary, no commit.
    expect(model.turns[0]!.tools.sort()).toEqual(
      ["concept_create", "concept_update", "relationship_add", "search_existing"].sort()
    )
    expect(model.turns[0]!.system).toContain("# Grow: answer one ask with suggestions")
    expect(model.turns[0]!.user).toContain("“What would I need to understand QLoRA?”")
    expect(model.turns[0]!.user).toContain("background knowledge")

    // The incomplete Concept was refused with the reason; the complete one went through.
    const refused = model.turns[2]!.results.find((x) => !(x.output as { ok: boolean }).ok)
    expect((refused!.output as { error: string }).error).toMatch(/summary and overview/)

    // One batch per step that wrote something: the Concept, then the links and edits.
    expect(batches.map((b) => b.map((i) => i.ops[0]!.kind))).toEqual([
      ["concept.create"],
      ["relationship.add", "relationship.add", "concept.set", "concept.tag.add"],
    ])
    const create = batches[0]![0]!.ops[0]!
    expect(create).toMatchObject({ kind: "concept.create", value: { summary: NF4.summary, overview: NF4.overview } })
    expect(r).toMatchObject({ items: 5, text: "Added NF4 and linked weight quantization as a prerequisite." })

    // The state it was given is untouched: nothing is committed anywhere.
    expect(state).toEqual(before)
    expect(isLive(state.concepts[create.target])).toBe(false)
  })

  it("names the Concept a Concept action is about, with its Relationships", async () => {
    const { state } = loadCompute()
    const qlora = byTitle(state, "QLoRA")
    const model = scriptedModel(() => ({ text: "QLoRA already has what it needs." }))
    const r = await grow({
      model,
      state,
      sources: [],
      whole: true,
      ask: { action: "missing", conceptId: qlora },
      onItems: async () => {},
    })
    expect(r.items).toBe(0)
    const user = model.turns[0]!.user
    expect(user).toContain(`QLoRA (${qlora}), idea`)
    expect(user).toContain("-prerequisite-> QLoRA")
    expect(user).toContain("Add what's missing to understand this: Add what's missing to understand QLoRA.")
  })

  it("refuses a Concept that is gone", async () => {
    const { state } = loadCompute()
    await expect(
      grow({
        model: scriptedModel(() => ({ text: "x" })),
        state,
        sources: [],
        whole: true,
        ask: { action: "examples", conceptId: "nope" },
        onItems: async () => {},
      })
    ).rejects.toThrow("That Concept is gone")
  })

  it("stops at the per-ask cap, keeping what already came out", async () => {
    const { state } = loadCompute()
    // Each call costs $0.60 on Opus prices: over a $0.50 cap after the first.
    const meter = new SpendMeter({ kind: "ask", capUsd: 0.5 })
    const scripted = scriptedModel(
      (t) =>
        t.step === 0
          ? { calls: [{ tool: "concept_create", input: NF4 }] }
          : { calls: [{ tool: "concept_create", input: { ...NF4, title: "Paged optimizers" } }] },
      { usage: { input: 100_000, output: 10_000 } }
    )
    const model = meteredModel(scripted, meter, { provider: "gateway", modelId: "anthropic/claude-opus-5.5" })
    const kept: GrowItem[] = []
    const err = await grow({
      model,
      state,
      sources: [],
      whole: true,
      ask: { text: "What would I need to understand QLoRA?" },
      onItems: async (items) => void kept.push(...items),
    }).catch((e: unknown) => e)
    expect(capOf(err)).toBeInstanceOf(SpendingCapReached)
    expect(scripted.turns).toHaveLength(1)
    expect(kept.map((i) => (i.ops[0] as { value: { title: string } }).value.title)).toEqual(["NormalFloat (NF4)"])
    expect(meter.spentUsd).toBeCloseTo(0.6, 5)
  })

  it("stops when the asker stops it, keeping what already came out", async () => {
    const { state } = loadCompute()
    const stop = new AbortController()
    const kept: GrowItem[] = []
    const err = await grow({
      model: scriptedModel((t) => ({
        calls: [{ tool: "concept_create", input: { ...NF4, title: `Idea ${t.step}` } }],
      })),
      state,
      sources: [],
      whole: true,
      ask: { text: "Add everything" },
      abortSignal: stop.signal,
      onItems: async (items) => {
        kept.push(...items)
        stop.abort()
      },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(kept).toHaveLength(1)
  })
})

describe("estimateAsk", () => {
  it("prices one ask on the curator model, growing with the Expedition", () => {
    const { state } = loadCompute()
    const concepts = Object.values(state.concepts).length
    const relationships = Object.values(state.relationships).length
    const models = DEFAULT_MODELS.gateway
    const small = estimateAsk({ provider: "gateway", models, sourceChars: 0, concepts: 20, relationships: 30 })
    const compute = estimateAsk({ provider: "gateway", models, sourceChars: 0, concepts, relationships })
    expect(compute.model).toBe("anthropic/claude-opus-5.5")
    expect(small.usd).toBeGreaterThan(0)
    expect(compute.usd).toBeGreaterThan(small.usd)
    // Within the default per-ask cap on the compute sample.
    expect(compute.usd).toBeLessThan(0.5)
  })
})

/** The cap, unwrapped from the AI SDK's errors. */
function capOf(err: unknown): unknown {
  for (let e = err, i = 0; e && i < 5; i++) {
    if (e instanceof SpendingCapReached) return e
    e = (e as { lastError?: unknown }).lastError ?? (e as { cause?: unknown }).cause
  }
  return err
}
