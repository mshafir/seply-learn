---
id: 13
title: AI SDK and pluggable harnesses
labels: [wayfinder:research]
status: closed
assignee: claude-research-agent
blocked_by: []
---

## Question

What does the **newest Vercel AI SDK** offer for Umbel Learn's in-app AI, especially its **pluggable harness support**? Find out, with versions and links:

- What "harness" means in the current AI SDK: the API, which harnesses exist (e.g. provider agent SDKs or coding-agent harnesses), and how to plug one in or write one.
- Agents and tool loops, structured output (objects and streaming partial objects), and how progress streams to a client UI (UI message streams, data parts, resumable streams).
- **Bring-your-own-key:** passing a user's provider key per request, provider coverage, and a gateway vs direct providers.
- **Runtimes:** running in a Cloudflare Worker (limits on CPU and duration), in Workflows/Queues or Durable Objects for long jobs, in Node/Bun (self-host), and in Electron's main process (local-first desktop).
- Fit for our two jobs: the **build pipeline** (Sources → Concepts → Views → articles; long-running, many calls, per-View progress, retry) and **Grow** (interactive chat that returns Proposals as structured data).
- Anything that overlaps with our MCP server (MCP client support in the SDK).

Write findings to `research/ai-sdk-harness.md`.

## Resolution

Findings: [research/ai-sdk-harness.md](../research/ai-sdk-harness.md).

- "Pluggable harness support" is real. It is the AI SDK 7 **harness layer**: `HarnessAgent` in `@ai-sdk/harness` (1.0.124, still labelled experimental) plus `HarnessV1` adapters for Claude Code, Codex, Pi, Cline, Cursor, Copilot, Grok Build, OpenCode, Deep Agents, fx and any ACP agent. Its streams work with `useChat` unchanged. `ai` is at 7.0.114.
- Harnesses are coding-agent runtimes that always run in a sandbox (Vercel Sandbox, or in-process just-bash for host-driven Pi/Cline). They need Node ≥22, and there is no Cloudflare sandbox provider.
- The build pipeline and Grow should use core AI SDK 7: `streamText`/`ToolLoopAgent` with `Output.object`/`Output.array`, and `data-*` UI parts with id-based updates for per-View progress. The build runs in CF Workflows + the Expedition DO on CF and behind our own job interface on Node.
- BYOK: direct provider factories with a per-request `apiKey`. AI Gateway per-request `byok` exists but may fall back to our credentials, so it is opt-in only.
- Keep a `HarnessAgent` seam as an optional "agent mode" (the user's own Claude Code/Codex/Pi subscription) on desktop and Node self-host. Not in v1 on CF.
- `@ai-sdk/mcp` is client-only. Our `/mcp` server stays on the MCP TS SDK, and tool definitions are shared in-process with Grow.

**Confirmed by the user (2026-09-25):** core AI SDK 7 for v1; harnesses later as an optional agent mode.
