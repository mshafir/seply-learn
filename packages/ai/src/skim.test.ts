import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { segmentsDoc, VIEW_TYPE_IDS } from "@seply/domain"
import { MockLanguageModelV4 } from "ai/test"
import { describe, expect, it } from "vitest"
import { modelFor } from "./setup.ts"
import {
  normalizeSkim,
  ProposedView,
  runSkim,
  SKIM_SAMPLE,
  skimPrompt,
  skimSample,
  skimSystem,
  type SkimOutput,
  type SkimSource,
} from "./skim.ts"
import { skimFixtures } from "./skim-fixtures.ts"
import { SpendMeter, meteredModel } from "./spend.ts"

const view = (over: Partial<SkimOutput["views"][number]> = {}): SkimOutput["views"][number] => ({
  id: "v-learning-path",
  viewType: "learning-path",
  label: "Path to a good loaf",
  question: "What do I need to understand first?",
  why: "You kept asking 'what is…'",
  on: true,
  confidence: "high",
  ...over,
})

const answer: SkimOutput = {
  title: "Sourdough, from starter to oven.",
  summary: "How a sourdough loaf rises, and why yours come out dense.",
  views: [
    view(),
    view({ id: "v-anatomy", viewType: "anatomy", label: "What's in a loaf", question: "What is a loaf made of?" }),
    view({ id: "v-outline", viewType: "outline", label: "The whole process", question: "What are the stages?", on: true }),
    view({ id: "v-fixes", viewType: "cause-and-effect", label: "Why it's dense", question: "What makes a loaf dense?", on: false, confidence: "medium" }),
    view({ id: "v-timeline", viewType: "timeline", label: "A bake day", question: "When does each step happen?", on: false, confidence: "medium" }),
  ],
}

function generated(output: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 12_000, noCache: 12_000, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 900, text: 900, reasoning: 0 },
    },
    warnings: [],
  }
}

const chat = (turns: number): SkimSource => ({
  id: "src-1",
  title: "A long chat",
  kind: "chat",
  segments: segmentsDoc(
    "chat",
    "chat-paste",
    Array.from({ length: turns }, (_, i) => ({
      id: `t${i + 1}`,
      speaker: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `${i % 2 === 0 ? "Question" : "Answer"} ${i + 1}: ${"words ".repeat(300)}`,
    }))
  ),
})

describe("skimSample", () => {
  it("keeps every reader turn and the first and last few segments, labelled", () => {
    const { text } = skimSample([chat(20)])
    expect(text).toContain('<source id="src-1" title="A long chat" kind="chat" segments="20">')
    for (let i = 1; i <= 20; i += 2) expect(text).toContain(`[t${i} reader]`)
    for (const id of ["t2", "t18", "t20"]) expect(text).toContain(`[${id} assistant]`)
    // A middle assistant turn is skipped, and the gap is marked.
    expect(text).not.toContain("[t10 assistant]")
    expect(text).toContain("segments not shown")
  })

  it("keeps a document's headings in the middle, with a little text", () => {
    const doc: SkimSource = {
      id: "d",
      title: "Doc",
      kind: "file",
      segments: segmentsDoc(
        "document",
        "markdown",
        Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, heading: `Heading ${i + 1}`, text: "x ".repeat(500) }))
      ),
    }
    const { text } = skimSample([doc])
    for (let i = 1; i <= 12; i++) expect(text).toContain(`[s${i}] ## Heading ${i}`)
    const middle = text.split("\n").find((l) => l.startsWith("[s6]"))!
    expect(middle.length).toBeLessThan(SKIM_SAMPLE.headingChars + 40)
  })

  it("fits the budget however long the Sources are", () => {
    const { text } = skimSample([chat(2000), chat(600)])
    expect(text.length).toBeLessThanOrEqual(SKIM_SAMPLE.budgetChars)
    expect(text).toContain("[t1 reader]")
    expect(text).toContain("[t2000 assistant]")
  })

  it("stays small on the fixtures", () => {
    for (const f of skimFixtures()) {
      const { text, segments } = skimSample(f.sources)
      expect(segments, f.name).toBeGreaterThan(3)
      expect(text.length, f.name).toBeLessThanOrEqual(SKIM_SAMPLE.budgetChars)
    }
  })
})

describe("the prompt", () => {
  it("carries the playbook and the catalog in the system prompt", () => {
    const system = skimSystem()
    expect(system).toContain("# Skim: propose Views")
    for (const id of VIEW_TYPE_IDS) expect(system).toContain(`### ${id}: `)
    expect(system).toContain("Building it from a source:")
  })

  it("names the task, the goals and what's already proposed", () => {
    const p = skimPrompt({
      sample: "SAMPLE",
      goals: ["learn", "plan"],
      request: { mode: "ask", request: "a timeline\nof bakes", existing: [{ viewType: "outline", question: "What are the stages?" }] },
    })
    expect(p).toContain('The reader asked for: "a timeline of bakes"')
    expect(p).toContain('- outline: "What are the stages?"')
    expect(p).toContain("learn it, plan")
    expect(p).toContain("SAMPLE")
  })
})

describe("normalizeSkim", () => {
  it("keeps a good answer, with 3–4 on, ranked", () => {
    const r = normalizeSkim(answer)
    expect(r.title).toBe("Sourdough, from starter to oven")
    expect(r.views.map((v) => v.id)).toEqual(["v-learning-path", "v-anatomy", "v-outline", "v-fixes", "v-timeline"])
    expect(r.views.filter((v) => v.on)).toHaveLength(3)
    for (const v of r.views) expect(ProposedView.safeParse(v).success).toBe(true)
  })

  it("makes ids unique kebab v- ids and caps the count at 8", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      view({ id: i < 3 ? "Learning Path!" : `v-x-${i}`, question: `Question ${i}?` })
    )
    const r = normalizeSkim({ ...answer, views: many }, { mode: "propose" }, ["v-learning-path"])
    expect(r.views).toHaveLength(8)
    expect(r.views.slice(0, 3).map((v) => v.id)).toEqual(["v-learning-path-2", "v-learning-path-3", "v-learning-path-4"])
    expect(r.views.filter((v) => v.on)).toHaveLength(4)
  })

  it("turns the first ones on when none are, and drops repeats", () => {
    const off = answer.views.map((v) => ({ ...v, on: false }))
    const r = normalizeSkim({ ...answer, views: [...off, off[0]!] })
    expect(r.views).toHaveLength(5)
    expect(r.views.map((v) => v.on)).toEqual([true, true, true, false, false])
  })

  it("suggest more: 2–4, none on, none repeating what's there", () => {
    const r = normalizeSkim(answer, {
      mode: "more",
      existing: [{ viewType: "learning-path", question: "what do I need to understand first" }],
    })
    expect(r.views.map((v) => v.viewType)).toEqual(["anatomy", "outline", "cause-and-effect", "timeline"])
    expect(r.views.every((v) => !v.on)).toBe(true)
  })

  it("a specific request: exactly one, on", () => {
    const r = normalizeSkim(answer, { mode: "ask", request: "a timeline", existing: [] })
    expect(r.views).toHaveLength(1)
    expect(r.views[0]!.on).toBe(true)
  })
})

describe("runSkim", () => {
  it("calls the model with the sample and returns the settled answer, tokens and time", async () => {
    let call: LanguageModelV4CallOptions | undefined
    const mock = new MockLanguageModelV4({
      doGenerate: async (options) => {
        call = options
        return generated(answer)
      },
    })
    const meter = new SpendMeter({ kind: "build", capUsd: 5 })
    const model = meteredModel(mock, meter, { provider: "gateway", modelId: "anthropic/claude-haiku-4.5" })
    let t = 1000
    const run = await runSkim({
      model,
      sources: skimFixtures()[0]!.sources,
      goals: ["learn"],
      now: () => (t += 4200),
    })
    expect(run.result.views).toHaveLength(5)
    expect(run.ms).toBe(4200)
    expect(run.usage.output).toBe(900)
    expect(meter.spentUsd).toBeGreaterThan(0)
    expect(call?.responseFormat?.type).toBe("json")
    const prompt = JSON.stringify(call?.prompt)
    expect(prompt).toContain("[t1 reader]")
    expect(prompt).toContain("learn it")
  })

  it("throws when the model answers with something that isn't the shape", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generated({ nope: true }) })
    await expect(runSkim({ model, sources: skimFixtures()[0]!.sources })).rejects.toThrow()
  })

  it("works through modelFor (a setup's skim stage)", () => {
    const model = modelFor(
      { keySource: "instance", credentials: { provider: "anthropic", apiKey: "sk-test" }, models: { skim: "claude-haiku-4-5", curator: "x", writer: "y" } },
      "skim"
    )
    expect(model.modelId).toBe("claude-haiku-4-5")
  })
})
