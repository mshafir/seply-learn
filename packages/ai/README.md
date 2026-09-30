# @seply/ai

**Lane:** E: AI

## Contract

The curator agent (AI SDK 7 ToolLoopAgent), its tools and view.inspect checks, the skim, writers, the playbook, BYOK/instance providers and cost accounting. Spec: docs/spec/v1/05-ai.md.

Today (WP-3.3, providers, keys and cost; `ai` 7.x with `@ai-sdk/anthropic`, `openai`, `google`, `openai-compatible`, and the gateway provider from `ai`):

| Export | What it is |
|---|---|
| `STAGES`, `Stage` | `skim` (fast model), `curator` (strong: builds and Grow asks), `writer` (mid-tier). `STAGE_TIER` maps them. |
| `PROVIDERS`, `ProviderId` | `gateway` (Vercel AI Gateway), `anthropic`, `openai`, `google`, `openai-compatible`. `BYOK_PROVIDERS`: the four a reader can add a key for (not `openai-compatible`, which needs a base URL). |
| `DEFAULT_MODELS[provider][stage]` | The defaults: Claude Haiku 4.5 / Opus 5.5 / Sonnet 5.5 for skim / curator / writer, on the gateway (`anthropic/claude-opus-5.5`) and on Anthropic (`claude-opus-5-5`). OpenAI (`gpt-6-luna` / `gpt-6-astra` / `gpt-6.1-sol`) and Google (`gemini-3.5-flash-lite` / `gemini-3.1-pro-preview` / `gemini-3.8-flash`) are matched by price tier and not yet tried on a real build. |
| `stageModels(provider, overrides?)` | The model per stage: the override, else the default. Throws for a stage with neither (an OpenAI-compatible endpoint names its own). `ModelOverrides`, `ModelId`: their Zod schemas. |
| `Credentials`, `languageModel(creds, modelId, { fetch }?)` | A provider created for this call only, with this key. Nothing reads keys from env, and the AI SDK's default global `gateway` is never used. |
| `testKey(creds, { fetch }?)` | Checks a key without spending: lists the provider's models (the gateway: reads the credit balance). `{ ok: true }` or `{ ok: false, reason: "rejected" \| "unreachable" \| "error" }`. The key goes in a header, never the URL. |
| `ApiKey`, `last4` | What a stored key must look like, and the only part of it ever shown again. |
| `PRICES`, `priceOf(provider, modelId)`, `canonicalModelId` | USD per million tokens (input, output, cache read, cache write), keyed by the gateway's `creator/model` id; Anthropic's `claude-opus-5-5` maps to `anthropic/claude-opus-5.5`. An unknown model gets `FALLBACK_PRICE` (Opus-class, so caps stop early) and `known: false`. |
| `TokenUsage`, `tokenUsage(aiSdkUsage)`, `costOf`, `costOfCall`, `gatewayCost` | A call's tokens (uncached input, cache read, cache write, output), and its cost: the gateway's reported `cost` when there is one, else the price table. |
| `estimateTokens(text, provider, modelId)`, `tokensForChars`, `tokenizerFamily`, `CHARS_PER_TOKEN` | Token estimates without a tokenizer, by family (Claude's newer tokenizer on Opus 4.7+/Sonnet 5+, the older one on Haiku 4.5, OpenAI, Gemini). |
| `estimateBuild({ provider, models, sourceChars, views? })` → `BuildEstimate` | The estimate shown before Create: per stage (`skim`, `curator` with prompt caching and its tool loop, `writer`) the model, tokens and USD; `usd`, `capUsd` (2×, `BUILD_CAP_MULTIPLIER`), `sourceTokens`, `concepts`, and `overCap` (over `SOURCE_TOKEN_CAP`, 500k tokens). The step shapes are in `STEP`. |
| `SpendMeter`, `SpendingCapReached` | Spending cap accounting for one build (`kind: "build"`, cap = `capUsd` of the estimate) or one ask (`kind: "ask"`, `DEFAULT_ASK_CAP_USD` = $0.50 or the reader's setting). `record(call)`, `check()` (throws at the cap), `raise(by?)` (Continue: adds the cap again by default), `spentUsd`, `remainingUsd`, `reached`, and `toJSON()` / `SpendMeter.from(state)` for a job's checkpoint. |
| `meteredModel(model, meter, { provider, modelId })` | Wraps a model: each call first checks the cap (throwing `SpendingCapReached` before it starts), and its cost is recorded when it finishes (generate, or a stream's `finish` part). A call already running completes, so a cap is passed by at most one call. |
| `AiSetup`, `modelFor(setup, stage, meter?)`, `estimateFor(setup, sourceChars, views?)` | How later stages get a model. `@seply/server`'s `resolveAi` returns the setup (whose key, which provider and models); the stage asks for its model, metered with its build's or ask's meter. |

### How the next stages use it

```ts
// In a request or job (server side):
const ai = await resolveAi(db, env, userId)        // @seply/server
if (!ai.ok) return fail(ai.reason)                 // "no-key" | "not-configured"
const estimate = estimateFor(ai.setup, sourceChars) // shown before Create
const meter = new SpendMeter({ kind: "build", capUsd: estimate.capUsd })
// (an ask: new SpendMeter({ kind: "ask", capUsd: ai.askCapUsd }))
const agent = new ToolLoopAgent({ model: modelFor(ai.setup, "curator", meter), … })
// SpendingCapReached → pause the job (Continue: meter.raise(); Stop), or end the ask.
// Checkpoint meter.toJSON() with the job; resume with SpendMeter.from(state).
```

The setup holds the key in the clear: keep it inside the request or job, never in a job's persisted state (persist the user id and re-resolve).

### The estimate's accuracy

`src/estimate.test.ts` checks the estimate against real calls on the committed fixtures (the research doc, and the compute sample's prose standing in for its chat; `src/fixture-sources.ts`), recorded in `src/estimate-actuals.json` by `scripts/measure-estimate.ts` through the AI Gateway (it spends real money, well under $1, so it isn't part of `pnpm test`: `node --env-file=../../apps/worker/.dev.vars --experimental-transform-types scripts/measure-estimate.ts`). Each call is the curator's first step (the whole Source in context, cached, and the understanding note written back) on the cheap model of each tokenizer family and on Claude's tiers. Token estimates are within 10% and cost estimates within 9% of what the gateway billed (the bar is 30%), and the price table reproduces the gateway's billed cost within 2%. Re-run it when a model, price or tokenizer changes.

The build estimate's step shapes (tool steps per Concept and View, output per step, the writers' batches) are design figures from spec §5.2 and the seeding prototype, not yet measured: no build runs until WP-3.5b. Re-fit `STEP` against real builds then.

## Allowed dependencies

@seply/domain. See the dependency rule in the root CLAUDE.md; `pnpm check:deps` enforces it.
