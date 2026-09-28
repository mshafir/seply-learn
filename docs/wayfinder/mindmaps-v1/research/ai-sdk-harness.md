# AI SDK 7 and its pluggable harness layer

Research for [ticket 13](../tickets/13-ai-sdk-harness-research.md). Checked 2026-09-25 against npm, the `vercel/ai` repo, ai-sdk.dev and the Vercel changelog.

## Summary answer

- **"Pluggable harness support" is a real, named feature.** In AI SDK 7 it is called the **AI SDK harness layer**. It is the `HarnessAgent` class in `@ai-sdk/harness`, built on a `HarnessV1` adapter spec. You plug in a finished agent runtime (Claude Code, Codex, Pi, Cline, Cursor, GitHub Copilot, Grok Build, OpenCode, Deep Agents, fx, or any ACP agent) the same way you swap a model. Its `generate()` and `stream()` return normal AI SDK results, so `useChat` and UI message streams work unchanged.
- **Versions:** `ai` 7.0.0 shipped 2026-06-25 and is now at **7.0.114** (2026-09-24). `@ai-sdk/harness` is at **1.0.124**, but its README still says **experimental** and warns of breaking changes between releases. The feature was announced on the canary channel on 2026-06-12.
- **What it is for:** coding-agent runtimes that need a **sandbox** (a filesystem, a shell, often a network port). Every harness runs inside one. The supported sandboxes today are **Vercel Sandbox** (`@ai-sdk/sandbox-vercel`) and **just-bash** (`@ai-sdk/sandbox-just-bash`, in-process and virtual, with no ports).
- **Fit:** Umbel Learn's two jobs (the build pipeline and Grow) are model calls that return structured data. They are not coding-agent sessions. The right core for them is plain AI SDK 7: `generateText`/`streamText` with `Output.object`/`Output.array`, `ToolLoopAgent`, UI message streams with `data-*` parts, and per-request BYOK providers. All of this runs on CF Workers, Node/Bun and Electron. Use the harness layer as an **optional plug point**, for example "run this with my Claude Code or Codex subscription" on desktop or self-host. It should not be the default engine: it is experimental, needs Node 22+ and a sandbox, and on CF it would need a sandbox provider that doesn't exist yet.

## 1. What "harness" means in AI SDK 7

**Definition.** The docs say: "A harness is a complete agent runtime, such as Claude Code, Codex, or Pi". A harness owns more than a model call: workspace access, built-in coding tools, native session state, compaction, permission flows, skills and sub-agents ([overview](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview)).

**API** (`@ai-sdk/harness/agent`, [HarnessAgent docs](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)):

```ts
const agent = new HarnessAgent({
  harness: claudeCode,                        // the plug point
  model: 'claude-sonnet-4-6',                 // optional, harness-specific
  sandbox: createVercelSandbox({ runtime: 'node24', ports: [4000] }),
  instructions: '…',
  tools: { /* AI SDK tools, executed on the host */ },
  output: Output.object({ schema }),          // typed output per turn
});
const session = await agent.createSession();
const res = await agent.stream({ session, prompt: '…' }); // StreamTextResult-compatible
```

- **Options:** `tools`, `activeTools`/`inactiveTools`, `permissionMode`, `toolApproval`, `skills`, `stopWhen`, `callOptionsSchema` + `prepareCall` (per-turn settings), `sandboxConfig` (`workDir`, `onBootstrap`, `onSession`, `bootstrapHash`), lifecycle callbacks (`onStepStart`, `onToolExecutionStart`, …), `telemetry`.
- **Sessions hold state.** You create one with `createSession()`. `session.detach()` parks the runtime and returns resume state. `session.stop()` saves state and stops the sandbox. `session.destroy()` throws the session away. `createSession({ resumeFrom })` reopens a session, and `continueStream({ session })` resumes an interrupted turn.
- **Structured output** needs a JSON Schema. `Output.json()` with no schema throws `HarnessCapabilityUnsupportedError`. `stream()` also exposes `partialOutputStream`.
- **Guidance:** "Construct the agent at module scope." The `headers` option can't carry `authorization` or `x-api-key`.

**Harness adapters** (all `@ai-sdk/harness-*`, found in the repo's `packages/` directory):

| Adapter | Shape | Notes |
|---|---|---|
| `harness-claude-code` | bridge in sandbox | Wraps `@anthropic-ai/claude-agent-sdk`. Needs a sandbox with a port. |
| `harness-codex` | bridge | Codex app-server over JSON-RPC |
| `harness-pi` | **host-driven** | Pi runs in the host Node process. The sandbox is only a remote FS and shell, so just-bash works. |
| `harness-cline` | **host-driven** | Wraps `@cline/agents`. No port needed. |
| `harness-opencode`, `harness-deepagents` | bridge | Added 2026-06-25 |
| `harness-cursor`, `harness-github-copilot`, `harness-grok-build`, `harness-fx` | bridge via ACP | fx added 2026-08-31 |
| `harness-acp` | bridge, meta-adapter | Runs any Agent Client Protocol v1 agent (1.0.0 on npm 2026-08-07; changelog 2026-08-13) |

There is also `@ai-sdk/workflow-harness`. It runs a `HarnessAgent` as a durable Workflow DevKit workflow, in time slices (to survive the roughly 800 s Fluid Compute recycle) or one agent step at a time.

**Writing your own harness.** Implement `HarnessV1` (a `harnessId`, built-in tool metadata, an optional bootstrap recipe and lifecycle-state schema, and `doStart()`) and `HarnessV1Session` (prompt turns, continue, compaction, suspend, detach, stop, destroy). The adapter must work on the sandbox session that `HarnessAgent` passes in. The preferred shape is **host-driven**. The bridge-backed shape (an in-sandbox process connected over WebSocket) is only for runtimes that need local access. Output is mapped to `HarnessV1StreamPart`. A new **sandbox** means implementing `HarnessV1SandboxProvider`/`HarnessV1NetworkSandboxSession`. A narrower `Experimental_SandboxSession` also works. See [harness-abstraction.md](https://github.com/vercel/ai/blob/main/architecture/harness-abstraction.md) and [sandbox-abstraction.md](https://github.com/vercel/ai/blob/main/architecture/sandbox-abstraction.md). The narrative docs say little about adapter authoring; the architecture docs are the real guide.

**Beware the name clash.** Cloudflare's Agents docs also say "harnesses", meaning `AIChatAgent` and **Think** (`@cloudflare/think`). These are Durable Object chat frameworks that support `ai@^6` and `ai@^7`. They are a different thing from the AI SDK harness layer ([Think](https://developers.cloudflare.com/agents/harnesses/think/)).

## 2. Agents, tool loops, structured output, streaming to the UI

- **Agents:** the agent classes are `ToolLoopAgent` (the in-memory tool loop), `WorkflowAgent` (`@ai-sdk/workflow`, durable) and `HarnessAgent`. All three implement the same `Agent` interface. Loop control uses `stopWhen` (`isStepCount(n)`, …) and `prepareStep`. AI SDK 7 adds typed `runtimeContext`, a typed per-tool context (`contextSchema`, useful for passing secrets to tools), tool approvals (`user-approval` and HMAC-signed), and first-class timeouts (`totalMs`, `stepMs`, `chunkMs`, `toolMs`) ([AI SDK 7 blog](https://vercel.com/blog/ai-sdk-7), [agents](https://ai-sdk.dev/docs/agents/overview)).
- **Structured output:** use `generateText`/`streamText` with `output: Output.object({ schema })`, `Output.array()` (whose `elementStream` emits each finished element) or `Output.choice()`. `partialOutputStream` gives partial objects as they stream. The v7 docs no longer show `generateObject`/`streamObject`, and `output` can be mixed with tool calls in the same request. Producing the output counts as a step for `stopWhen` ([structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)).
- **Progress to the UI:** `createUIMessageStream({ execute({ writer }) })`. `writer.write({ type: 'data-viewStatus', id, data })` sends typed data parts. Writing again with the same `id` **updates that part in place**, which suits per-View progress. `transient: true` parts reach only `useChat`'s `onData` and never enter history. `writer.merge(result.toUIMessageStream())` interleaves model text ([streaming data](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)).
- **Resumable streams:** use `useChat({ resume: true })` on the client. The server needs a `consumeSseStream` hook, the `resumable-stream` package (v2.2.13, Redis-backed) and a GET `/api/chat/[id]/stream` route. A client abort counts as a disconnect, so stopping a generation needs its own stop endpoint ([resume streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)). `WorkflowAgent` has its own `WorkflowChatTransport`, which reconnects via `x-workflow-run-id`.

## 3. Bring-your-own-key

- **Direct providers:** every provider factory takes `apiKey`, so you build one per request: `createAnthropic({ apiKey: userKey })('claude-…')`. The repo holds about 40 provider packages (OpenAI, Anthropic, Google, Vertex, Bedrock, Azure, Mistral, xAI, Groq, DeepSeek, Together, Fireworks, Cerebras, OpenRouter via `openai-compatible`, …). `@ai-sdk/openai-compatible` covers Ollama, LM Studio and other local servers, which matters for Electron.
- **AI Gateway:** `@ai-sdk/gateway` 4.0.92 uses plain `'provider/model'` strings. Per-request BYOK goes in `providerOptions.gateway.byok` (e.g. `{ anthropic: [{ apiKey }] }`). The docs say a request "may still fall back to system credentials" if the user's key fails, which would bill our account ([BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)). The Gateway is also a Vercel-hosted dependency that self-hosters may not want.
- **Harness BYOK is harder.** Credentials are set when the **harness is constructed** (`createClaudeCode({ auth: { ANTHROPIC_API_KEY } })`), with modes `auto` | `direct` | `ai-gateway`. The docs don't show a per-session key. Serving many users' keys would mean building a harness and agent per user, which goes against the "module scope" guidance (**unverified whether this is safe**). Credential brokering keeps real keys out of the sandbox only when the sandbox supports `addRequestTransformations()` (Vercel Sandbox). Otherwise keys are forwarded into the sandbox. Since 2026-09-14, harnesses can also use the host's **native subscription** (a Claude/Codex/Copilot login found on the machine) ([changelog](https://vercel.com/changelog/ai-sdk-harness-native-subscription-authentication)). That is useful on a user's own desktop and meaningless on our servers.

## 4. Runtimes

- **Cloudflare Worker:** core `ai` and the providers are web-standard and run on Workers (Cloudflare's own Agents SDK is built on them). Limits: CPU defaults to 30 s on Paid and can be raised to 5 min, but LLM waiting is wall time, not CPU. HTTP wall time is unlimited while the client stays connected. Memory is 128 MB per isolate. Paid plans allow 10,000 subrequests per invocation ([limits](https://developers.cloudflare.com/workers/platform/limits/)). The **harness packages declare `engines.node >= 22`**, and host-driven adapters run whole agent runtimes (Pi, Cline) in the host process. Running `HarnessAgent` inside a Worker is **unverified and unlikely to work well**. There is also no Cloudflare sandbox provider. One could be written against `@cloudflare/sandbox` or Containers, but that is custom work.
- **Workflows / Queues / Durable Objects:** Queue consumers and DO alarms get up to 15 min of wall time. CF Workflows (GA) give retried, persisted steps, which fits "one step per View". Durable Objects fit progress fan-out and resumable chat: we already have a DO per Expedition, and `AIChatAgent`/Think do resumable streams natively. `WorkflowAgent` and `workflow-harness` need the **Workflow DevKit** (`workflow` 4.8.9; 5.0 in beta). Its official Worlds are Local, Vercel and Postgres (`@workflow/world-postgres` 4.3.7). A Cloudflare World exists only as an experimental community fork, so don't make it the cross-runtime job layer.
- **Node/Bun (self-host):** every feature works here, including `HarnessAgent`, `WorkflowAgent` with the Postgres World, and `resumable-stream` (needs Redis, or a Postgres-backed replacement). Bun isn't named in the engines field. **Bun support for harness packages is unverified.**
- **Electron main process:** this is ordinary Node. Recent Electron releases bundle Node 22+, which covers `engines >= 22` (**check the exact Electron version when building**). Core AI SDK with the user's key held locally works as is. The harness layer is most interesting here: native-subscription auth plus host-driven adapters (Pi, Cline) on a just-bash sandbox run fully locally. Claude Code and Codex need a port-capable sandbox, which today means a cloud Vercel Sandbox or writing a local (process or Docker) `HarnessV1SandboxProvider`.

## 5. MCP overlap

`@ai-sdk/mcp` (2.0.58) is **client-only**. It provides `createMCPClient` with HTTP (recommended), SSE and stdio transports, plus tools, resources, experimental prompts, completions, elicitation, OAuth, and tool-drift detection (`fingerprintTools`, `detectToolDrift`). AI SDK 7 also adds **MCP Apps** (`experimental_MCPAppRenderer`, app-only tools with sandboxed UI) ([MCP docs](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)). The SDK has no server helper, so our `/mcp` route stays on the MCP TS SDK as already decided. There are two points of overlap. (a) In-app Grow could share the MCP server's tool definitions: define them once and expose them both as AI SDK `tool()`s and as MCP tools. Don't call our own server over HTTP. (b) Users of harnesses such as Claude Code could reach Umbel Learn through our MCP server. That path is the MCP ticket's concern, not in-app AI.

## Fit for Umbel Learn

**Build pipeline** (Sources → Concepts → Views → articles; long, many calls, per-View progress, retry):
- Each stage is a `generateText`/`streamText` call with `Output.object`, or `Output.array` for Concept lists (stream elements into reserved slots). A small `ToolLoopAgent` handles anything that needs lookups. No harness is needed. The work is extraction and synthesis, not file-system work.
- On CF, a **Workflow** per build runs `readSources` → `findConcepts`, then one step per View with its own retries, then article steps. Each step writes status to the Expedition's DO, which pushes `data-viewStatus` updates (keyed by View id) to connected clients. That covers "leave it building" and per-View Retry. On Node, the same step functions run behind a small job interface (Workflow DevKit Postgres World, or pg-boss). **Recommendation:** own this interface rather than binding to `WorkflowAgent`.
- Cost limits on the user's key: v7 timeouts, per-step `usage` and `onEnd` telemetry make a per-build token budget straightforward.

**Grow** (interactive chat that returns Proposals as structured data):
- Run `streamText` or `ToolLoopAgent` with tools such as `proposeConcepts`/`proposeRelationships`, whose Zod inputs *are* the Proposal shape. Alternatively, emit `data-proposal` parts with ids so they draw dashed on the canvas as they stream. Use `useChat` on the client.
- Tool approvals map naturally onto "accept / dismiss". Resumable streams go through the DO on CF and `resumable-stream` on Node.

**BYOK:** create direct providers per request from the reader's stored (encrypted) key. Offer the Gateway only as an opt-in for our hosted instance, because of its credential-fallback behaviour. Electron keeps keys local and can add local models via `openai-compatible`.

**Where the harness layer fits:** keep a `HarnessAgent`-shaped seam for an **"agent mode"** on desktop and Node self-host. In that mode a user points their own Claude Code, Codex or Pi subscription at a Grow or build task, and our Proposal tools are passed in as host-executed `tools`. It returns the same stream types, so the UI doesn't change. Don't ship it in v1 on CF.

## Open risks

- **Experimental API.** Harness packages are 1.0.x on npm but labelled experimental, and they release almost daily (versions over 120 in 3 months). Pin exact versions.
- **Sandbox dependency.** Bridge adapters need Vercel Sandbox, a paid Vercel dependency, or a custom sandbox provider. No official CF, Docker or local-process provider exists.
- **Per-user keys in harnesses** aren't documented per session, and without brokering the credentials enter the sandbox.
- **AI Gateway BYOK fallback** to system credentials could bill us for users' traffic. Check whether it can be disabled before offering the Gateway.
- **Workflow DevKit on Cloudflare** has no official World, and `resumable-stream` assumes Redis. Both need CF-specific substitutes (Workflows, DOs).
- **Worker memory (128 MB)** can be tight for large Sources such as PDFs. Parse them in the Node container or a Container if needed.
- **Unverified:** `HarnessAgent` inside Workers, Bun compatibility of the harness packages, and the Node version of the Electron release we target.

## Sources

- AI SDK 7 release blog (2026-06-25): https://vercel.com/blog/ai-sdk-7
- Changelog, HarnessAgent announcement (2026-06-12): https://vercel.com/changelog/program-agent-harnesses-with-ai-sdk
- Changelog, Deep Agents + OpenCode (2026-06-25): https://vercel.com/changelog/deepagents-and-opencode-harness-adapters
- Changelog, ACP harnesses (2026-08-13): https://vercel.com/changelog/use-acp-compatible-harnesses-with-the-ai-sdk-harness-layer
- Changelog, fx adapter (2026-08-31): https://vercel.com/changelog/fx-ai-sdk-harness-adapter
- Changelog, native subscription auth (2026-09-14): https://vercel.com/changelog/ai-sdk-harness-native-subscription-authentication
- Harness docs: https://ai-sdk.dev/docs/ai-sdk-harnesses/overview · https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent · https://ai-sdk.dev/providers/ai-sdk-harnesses · https://ai-sdk.dev/providers/ai-sdk-harnesses/claude-code
- Repo: https://github.com/vercel/ai (`packages/harness*`, `packages/sandbox-*`, `packages/workflow-harness`), architecture/harness-abstraction.md, architecture/sandbox-abstraction.md
- npm dist-tags checked 2026-09-25: `ai` 7.0.114, `@ai-sdk/harness` 1.0.124, `@ai-sdk/harness-claude-code` 1.0.128, `@ai-sdk/harness-acp` 1.0.62, `@ai-sdk/workflow` 2.0.45, `@ai-sdk/mcp` 2.0.58, `@ai-sdk/gateway` 4.0.92, `@ai-sdk/react` 4.0.117, `workflow` 4.8.9
- Agents: https://ai-sdk.dev/docs/agents/overview · WorkflowAgent: https://ai-sdk.dev/docs/agents/workflow-agent
- Structured data: https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
- UI streaming data: https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data · Resumable streams: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams
- MCP: https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
- AI Gateway BYOK: https://vercel.com/docs/ai-gateway/authentication-and-byok/byok
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/ · Think: https://developers.cloudflare.com/agents/harnesses/think/ · Workflows: https://developers.cloudflare.com/workflows/
- Workflow DevKit deploying/Worlds: https://workflow-sdk.dev/docs/deploying
