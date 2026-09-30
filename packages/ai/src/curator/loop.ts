// One run of the curator's tool loop (AI SDK 7 `ToolLoopAgent`), with prompt
// caching laid out for a long loop over a large, fixed prefix:
//
// 1. the instructions (the playbook), cached;
// 2. the first user message's first part (the Sources), cached;
// 3. a rolling breakpoint on the newest message, so each step reads the
//    loop's history from the cache the step before wrote.
//
// Three of Anthropic's four breakpoints. Other providers ignore the markers
// (OpenAI and Gemini cache prefixes on their own).
import {
  isStepCount,
  ToolLoopAgent,
  type LanguageModel,
  type ModelMessage,
  type StepResult,
  type ToolSet,
} from "ai"
import type { CuratorTool } from "../tools.ts"

const EPHEMERAL = { anthropic: { cacheControl: { type: "ephemeral" } } } as const

export type LoopTools = Record<string, CuratorTool<never, unknown>>

export type LoopOptions = {
  model: LanguageModel
  instructions: string
  /** Cached: the Sources (or their index). */
  prefix: string
  /** The task: what this run should do, after the prefix. */
  task: string
  tools: LoopTools
  /** The loop's step budget. */
  maxSteps: number
  /** Stops the loop after the step in which it turns true. */
  done?: () => boolean
  onStep?: (step: StepResult<ToolSet>) => void | Promise<void>
  abortSignal?: AbortSignal
  /** Retries per model call on transient errors (AI SDK's; default 2). */
  maxRetries?: number
  /** Output token limit per step. */
  maxOutputTokens?: number
}

export type LoopResult = {
  text: string
  steps: number
  toolCalls: number
  /** The conversation after the task, for a follow-up run. */
  messages: ModelMessage[]
}

/** The first user message: the Sources (cached), then the task. */
export function firstMessage(prefix: string, task: string): ModelMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: prefix, providerOptions: EPHEMERAL },
      { type: "text", text: task },
    ],
  }
}

/** Moves the rolling cache breakpoint to the newest message. */
export function rollCache(messages: ModelMessage[]): ModelMessage[] {
  const last = messages.length - 1
  return messages.map((m, i) => {
    const { anthropic, ...rest } = (m.providerOptions ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >
    const { cacheControl: _drop, ...keep } = anthropic ?? {}
    void _drop
    const anthropicOpts = i === last ? { ...keep, ...EPHEMERAL.anthropic } : keep
    const providerOptions = {
      ...rest,
      ...(Object.keys(anthropicOpts).length && { anthropic: anthropicOpts }),
    }
    return {
      ...m,
      providerOptions: Object.keys(providerOptions).length
        ? providerOptions
        : undefined,
    } as ModelMessage
  })
}

/**
 * Runs the loop until the model answers without tool calls, `done()` turns
 * true, or the step budget runs out. `history` continues an earlier run
 * (its `messages`) with a follow-up `task`.
 */
export async function runLoop(
  o: LoopOptions,
  history?: ModelMessage[]
): Promise<LoopResult> {
  const messages: ModelMessage[] = history
    ? [...history, { role: "user", content: o.task }]
    : [firstMessage(o.prefix, o.task)]
  let toolCalls = 0
  const agent = new ToolLoopAgent({
    model: o.model,
    instructions: {
      role: "system",
      content: o.instructions,
      providerOptions: EPHEMERAL,
    },
    tools: o.tools as unknown as ToolSet,
    stopWhen: [isStepCount(o.maxSteps), () => o.done?.() ?? false],
    prepareStep: ({ messages }) => ({ messages: rollCache(messages) }),
    maxRetries: o.maxRetries ?? 2,
    ...(o.maxOutputTokens && { maxOutputTokens: o.maxOutputTokens }),
    onStepEnd: async (step) => {
      toolCalls += step.toolCalls.length
      await o.onStep?.(step as StepResult<ToolSet>)
    },
  })
  const result = await agent.generate({
    messages,
    ...(o.abortSignal && { abortSignal: o.abortSignal }),
  })
  return {
    text: result.text,
    steps: result.steps.length,
    toolCalls,
    messages: [...messages, ...result.response.messages],
  }
}
