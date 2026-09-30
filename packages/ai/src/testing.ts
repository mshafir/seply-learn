// Test helpers for code that runs the curator (this package's tests and
// @seply/server's build job tests): a scripted model, so a build runs end to
// end with no provider and no spend. Exported as `@seply/ai/testing`; never
// used by production code.
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"

/** A tool call the script makes. */
export type ScriptedCall = { tool: string; input: Record<string, unknown> }

/** What the script sees for one model call. */
export type ScriptTurn = {
  /** The system prompt. */
  system: string
  /** Every user message's text, joined. */
  user: string
  /** The tools on offer, by name (empty for a plain generation). */
  tools: string[]
  /** Their input schemas as the provider gets them (JSON Schema), by name. */
  toolSchemas: Record<string, unknown>
  /** Results of the previous step's tool calls, in call order. */
  results: { tool: string; output: unknown }[]
  /** Every tool result so far in this loop. */
  allResults: { tool: string; output: unknown }[]
  /** Model steps so far in this loop (0 for the first). */
  step: number
  prompt: LanguageModelV4Prompt
}

/** A reply: tool calls, or text (ending the loop). */
export type ScriptReply = { calls: ScriptedCall[] } | { text: string }

export type Script = (turn: ScriptTurn) => ScriptReply | Promise<ScriptReply>

/**
 * A model that answers each call from a script. Usage is fixed per call
 * (`usage`), so spending caps can be tested.
 */
export function scriptedModel(
  script: Script,
  opts: {
    modelId?: string
    usage?: { input: number; output: number }
  } = {}
): MockLanguageModelV4 & { turns: ScriptTurn[] } {
  const turns: ScriptTurn[] = []
  let callN = 0
  const usage = opts.usage ?? { input: 1000, output: 100 }
  const model = new MockLanguageModelV4({
    provider: "gateway",
    modelId: opts.modelId ?? "anthropic/claude-opus-5.5",
    doGenerate: async (
      o: LanguageModelV4CallOptions
    ): Promise<LanguageModelV4GenerateResult> => {
      const turn = turnOf(o)
      turns.push(turn)
      const reply = await script(turn)
      const content: LanguageModelV4Content[] =
        "text" in reply
          ? [{ type: "text", text: reply.text }]
          : reply.calls.map((c) => ({
              type: "tool-call",
              toolCallId: `call-${callN++}`,
              toolName: c.tool,
              input: JSON.stringify(c.input),
            }))
      return {
        content,
        finishReason:
          "text" in reply
            ? { unified: "stop", raw: "end_turn" }
            : { unified: "tool-calls", raw: "tool_use" },
        usage: {
          inputTokens: {
            total: usage.input,
            noCache: usage.input,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: usage.output, text: usage.output, reasoning: 0 },
        },
        warnings: [],
      }
    },
  })
  return Object.assign(model, { turns })
}

function turnOf(o: LanguageModelV4CallOptions): ScriptTurn {
  const system: string[] = []
  const user: string[] = []
  const toolMsgs: { tool: string; output: unknown }[][] = []
  let assistantTurns = 0
  for (const m of o.prompt) {
    if (m.role === "system") system.push(m.content)
    if (m.role === "user")
      for (const p of m.content) if (p.type === "text") user.push(p.text)
    if (m.role === "assistant") assistantTurns++
    if (m.role === "tool")
      toolMsgs.push(
        m.content.flatMap((p) =>
          p.type === "tool-result"
            ? [
                {
                  tool: p.toolName,
                  output:
                    p.output.type === "json" || p.output.type === "text"
                      ? p.output.value
                      : p.output,
                },
              ]
            : []
        )
      )
  }
  return {
    system: system.join("\n"),
    user: user.join("\n"),
    tools: (o.tools ?? []).map((t) => t.name),
    toolSchemas: Object.fromEntries(
      (o.tools ?? []).flatMap((t) => (t.type === "function" ? [[t.name, t.inputSchema]] : []))
    ),
    results: toolMsgs.at(-1) ?? [],
    allResults: toolMsgs.flat(),
    step: assistantTurns,
    prompt: o.prompt,
  }
}

/** The ids the previous step's successful calls of `tool` returned, in order. */
export function idsFrom(turn: ScriptTurn, tool: string, key = "id"): string[] {
  return turn.results
    .filter((r) => r.tool === tool)
    .map((r) => (r.output as Record<string, unknown> | null)?.[key])
    .filter((id): id is string => typeof id === "string")
}

/**
 * A writer (spec §5.2 step 4) as a script: answers each overview or article
 * batch with realistic output for every Concept in the task, citing the
 * segments the task says the Concept is cited in, and linking the first
 * neighbour. `bad` adds refs that don't resolve (a made-up segment, and a
 * wrong Source id), to test the repair.
 */
export function writerScript(opts: { bad?: boolean; skip?: (id: string) => boolean } = {}): Script {
  return (turn) => {
    const task = turn.user
    const articles = task.includes("Write the **article**")
    const blocks = task.split(/\n(?=## )/).filter((b) => b.startsWith("## "))
    const concepts = blocks.flatMap((b): object[] => {
      const head = /^## (.*) \(([^)\s]+)\)$/m.exec(b)
      if (!head || opts.skip?.(head[2]!)) return []
      const [, title, id] = head
      const cited = /^cited in: (.*)$/m.exec(b)?.[1] ?? ""
      const refs = [...cited.matchAll(/(\S+) ([tsp]\d+[a-z]*)/g)].map((m) => ({
        source: m[1]!,
        segment: m[2]!,
      }))
      const link = /^- .*?(\[[^\]]+\]\(#c\/[^)]+\))/m.exec(b)?.[1]
      const prov = [
        ...refs,
        ...(opts.bad && refs[0]
          ? [
              { source: refs[0].source, segment: "t999" },
              { source: "no-such-source", segment: refs[0].segment },
            ]
          : []),
      ]
      const para = `${title} matters here because the Sources come back to it${link ? `, next to ${link}` : ""}. It is explained in plain words, with what it is, why it matters and how it connects.`
      return articles
        ? [
            {
              id,
              article: [
                { heading: "What it is", md: para, prov },
                { heading: "Why it matters", md: `More on ${title}, from what is well known.`, prov: [] },
              ],
            },
          ]
        : [{ id, summary: `${title}, in one line.`, overview: para, overviewProv: prov }]
    })
    return { text: JSON.stringify({ concepts }) }
  }
}
