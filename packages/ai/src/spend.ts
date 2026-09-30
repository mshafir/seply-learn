// Spending cap accounting per build and per ask (spec §5.5, §5.6).
//
// A SpendMeter counts what one build or one ask has spent. Models wrapped with
// `meteredModel` record every call's cost on it and refuse to start a call once
// the cap is reached (throwing SpendingCapReached): a build job pauses with
// Continue or Stop, an ask stops and keeps what already streamed. A call that
// is already running finishes, so a cap can be passed by at most one call.
// The meter's state is plain JSON, so a job can checkpoint and resume it.
import type {
  LanguageModelV4,
  LanguageModelV4Middleware,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider"
import { wrapLanguageModel } from "ai"
import type { ProviderId } from "./models.ts"
import {
  addUsage,
  costOfCall,
  priceOf,
  tokenUsage,
  ZERO_USAGE,
  type TokenUsage,
} from "./pricing.ts"

export type SpendKind = "build" | "ask"

export type SpendState = {
  kind: SpendKind
  capUsd: number
  spentUsd: number
  usage: TokenUsage
  calls: number
  /** Calls priced with the fallback price (model not in the table, no gateway cost). */
  estimatedCalls: number
}

export class SpendingCapReached extends Error {
  readonly kind: SpendKind
  readonly capUsd: number
  readonly spentUsd: number
  constructor(state: SpendState) {
    super(
      `spending cap reached: $${state.spentUsd.toFixed(2)} of $${state.capUsd.toFixed(2)} (${state.kind})`
    )
    this.name = "SpendingCapReached"
    this.kind = state.kind
    this.capUsd = state.capUsd
    this.spentUsd = state.spentUsd
  }
}

export class SpendMeter {
  private state: SpendState

  constructor(init: Pick<SpendState, "kind" | "capUsd"> & Partial<SpendState>) {
    if (!(init.capUsd > 0)) throw new RangeError("capUsd must be positive")
    this.state = {
      spentUsd: 0,
      usage: ZERO_USAGE,
      calls: 0,
      estimatedCalls: 0,
      ...init,
    }
  }

  /** Resumes a meter from `toJSON()` (e.g. a job's checkpoint). */
  static from(state: SpendState): SpendMeter {
    return new SpendMeter(state)
  }

  get kind() {
    return this.state.kind
  }
  get capUsd() {
    return this.state.capUsd
  }
  get spentUsd() {
    return this.state.spentUsd
  }
  get remainingUsd() {
    return Math.max(0, this.state.capUsd - this.state.spentUsd)
  }
  get reached() {
    return this.state.spentUsd >= this.state.capUsd
  }

  /** Throws SpendingCapReached when the cap is reached. */
  check() {
    if (this.reached) throw new SpendingCapReached(this.state)
  }

  /** Records one call; returns its cost in USD. */
  record(call: {
    provider: ProviderId
    modelId: string
    usage: TokenUsage
    providerMetadata?: unknown
  }): number {
    const { price, known } = priceOf(call.provider, call.modelId)
    const cost = costOfCall(call.usage, price, call.providerMetadata)
    const gatewayPriced =
      (call.providerMetadata as { gateway?: { cost?: unknown } } | undefined)
        ?.gateway?.cost !== undefined
    this.state = {
      ...this.state,
      spentUsd: this.state.spentUsd + cost,
      usage: addUsage(this.state.usage, call.usage),
      calls: this.state.calls + 1,
      estimatedCalls:
        this.state.estimatedCalls + (known || gatewayPriced ? 0 : 1),
    }
    return cost
  }

  /** Continue after a pause: allow `byUsd` more (default: the cap again). */
  raise(byUsd = this.state.capUsd) {
    if (!(byUsd > 0)) throw new RangeError("byUsd must be positive")
    this.state = { ...this.state, capUsd: this.state.capUsd + byUsd }
  }

  toJSON(): SpendState {
    return { ...this.state }
  }
}

/**
 * Wraps `model` so each call is checked against, and recorded on, `meter`.
 * `provider` and `modelId` pick the price (the gateway's reported cost wins).
 */
export function meteredModel(
  model: LanguageModelV4,
  meter: SpendMeter,
  priceKey: { provider: ProviderId; modelId: string }
): LanguageModelV4 {
  const middleware: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      meter.check()
      const result = await doGenerate()
      meter.record({
        ...priceKey,
        usage: tokenUsage(result.usage),
        providerMetadata: result.providerMetadata,
      })
      return result
    },
    wrapStream: async ({ doStream }) => {
      meter.check()
      const result = await doStream()
      const record = new TransformStream<
        LanguageModelV4StreamPart,
        LanguageModelV4StreamPart
      >({
        transform(part, controller) {
          if (part.type === "finish")
            meter.record({
              ...priceKey,
              usage: tokenUsage(part.usage),
              providerMetadata: part.providerMetadata,
            })
          controller.enqueue(part)
        },
      })
      return { ...result, stream: result.stream.pipeThrough(record) }
    },
  }
  return wrapLanguageModel({ model, middleware })
}
