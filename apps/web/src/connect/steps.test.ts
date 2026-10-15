import { describe, expect, it } from "vitest"

import type { AgentsOverview, AgentGrant, ApiToken } from "@/lib/api.ts"
import {
  AGENTS,
  cursorInstallLink,
  firstPrompts,
  FROM_CONVERSATION,
  hasAgent,
  installSteps,
  newAgent,
  requestAbout,
  signInSteps,
  type InstallItem,
} from "./steps.ts"

const HOSTED = "https://learn.seply.app"
const HOME = "http://nas.local:3000"

const commands = (items: InstallItem[]) =>
  items.flatMap((i) => (i.kind === "command" ? [i.value] : []))
const texts = (items: InstallItem[]) =>
  items.flatMap((i) => (i.kind === "text" ? [i.text] : [])).join(" ")

describe("installSteps", () => {
  it("lists the five agents in order", () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      "claude-code",
      "claude-apps",
      "codex",
      "cursor",
      "other",
    ])
  })

  it("gives Claude Code the two plugin commands on the hosted server", () => {
    expect(
      commands(installSteps("claude-code", HOSTED, { hosted: true }))
    ).toEqual([
      "claude plugin marketplace add mshafir/seply-learn",
      "claude plugin install seply-learn@seply",
    ])
  })

  it("adds the address to enter, and the command without the plugin, on a self-hosted server", () => {
    const items = installSteps("claude-code", HOME, { hosted: false })
    expect(commands(items)).toEqual([
      "claude plugin marketplace add mshafir/seply-learn",
      "claude plugin install seply-learn@seply",
      HOME,
      `claude mcp add --transport http seply-learn ${HOME}/mcp`,
    ])
    expect(texts(items)).toContain("asks for the server address")
  })

  it("gives the Claude apps the address to paste, with a note when self-hosted", () => {
    const hosted = installSteps("claude-apps", HOSTED, { hosted: true })
    expect(commands(hosted)).toEqual([`${HOSTED}/mcp`])
    expect(texts(hosted)).not.toContain("reach")
    const home = installSteps("claude-apps", HOME, { hosted: false })
    expect(commands(home)).toEqual([`${HOME}/mcp`])
    expect(texts(home)).toContain("from the internet over https")
  })

  it("gives Codex one command, with the origin unchanged", () => {
    expect(commands(installSteps("codex", HOME, { hosted: false }))).toEqual([
      `codex mcp add seply-learn --url ${HOME}/mcp`,
    ])
  })

  it("gives Cursor an install link and the snippet to paste", () => {
    const items = installSteps("cursor", HOME, { hosted: false })
    const link = items.find((i) => i.kind === "link")
    expect(link).toMatchObject({ href: cursorInstallLink(HOME) })
    expect(JSON.parse(commands(items)[0]!)).toEqual({
      mcpServers: { "seply-learn": { url: `${HOME}/mcp` } },
    })
  })

  it("gives any other agent the address and a token", () => {
    const items = installSteps("other", HOSTED, { hosted: true })
    expect(commands(items)).toEqual([`${HOSTED}/mcp`])
    expect(items.some((i) => i.kind === "token")).toBe(true)
  })
})

describe("cursorInstallLink", () => {
  it("carries the server's address, base64-encoded", () => {
    const url = new URL(cursorInstallLink(HOME))
    expect(url.protocol).toBe("cursor:")
    expect(url.searchParams.get("name")).toBe("seply-learn")
    expect(JSON.parse(atob(url.searchParams.get("config")!))).toEqual({
      url: `${HOME}/mcp`,
    })
  })
})

describe("signInSteps", () => {
  it("says what to do in each agent", () => {
    for (const a of AGENTS) expect(signInSteps(a.id).length).toBeGreaterThan(0)
    expect(signInSteps("claude-code").join(" ")).toContain("/mcp")
    expect(signInSteps("codex").join(" ")).toContain(
      "codex mcp login seply-learn"
    )
  })
})

describe("firstPrompts", () => {
  it("offers to create an Expedition when there is none in hand", () => {
    const prompts = firstPrompts(null)
    expect(prompts.map((p) => p.prompt)).toEqual([
      "Make a Seply Learn Expedition from this conversation.",
      "Make a Seply Learn Expedition about <what you want to understand>.",
    ])
    expect(prompts[0]!.then).toContain("Library")
  })

  it("asks for suggestions on the Expedition it came from", () => {
    const [p] = firstPrompts({ title: "KV caching" })
    expect(p!.prompt).toBe(
      "Read my Seply Learn Expedition “KV caching” and suggest what's missing."
    )
    expect(p!.then).toContain("Suggestions")
  })

  it("keeps the prompt on one line whatever the title holds", () => {
    const [p] = firstPrompts({ title: '  The "KV"\n cache\t' })
    expect(p!.prompt).toBe(
      "Read my Seply Learn Expedition “The 'KV' cache” and suggest what's missing."
    )
    expect(firstPrompts({ title: "  " })[0]!.prompt).toContain("“Untitled”")
  })
})

const grant = (clientId: string, name: string): AgentGrant => ({
  clientId,
  name,
  uri: null,
  icon: null,
  scopes: ["expeditions:read"],
  expeditions: null,
  createdAt: null,
})
const token = (id: string, lastUsedAt: string | null): ApiToken => ({
  id,
  name: `Token ${id}`,
  start: "sl_",
  scopes: ["expeditions:read"],
  expeditions: null,
  createdAt: "2026-10-12T00:00:00Z",
  lastUsedAt,
  expiresAt: null,
})
const overview = (
  grants: AgentGrant[],
  tokens: ApiToken[] = []
): AgentsOverview => ({ grants, tokens, scopes: [] })

describe("newAgent", () => {
  it("names an agent that signed in since the page opened", () => {
    expect(
      newAgent(
        overview([grant("a", "Cursor")]),
        overview([grant("a", "Cursor"), grant("b", "Claude Code")])
      )
    ).toBe("Claude Code")
  })

  it("ignores agents that were already connected", () => {
    const before = overview([grant("a", "Cursor")], [token("t", "2026-10-01")])
    expect(newAgent(before, before)).toBeNull()
    expect(
      newAgent(
        before,
        overview([grant("a", "Cursor")], [token("t", "2026-10-12")])
      )
    ).toBeNull()
  })

  it("names a token once it is first used", () => {
    const before = overview([], [token("t", null)])
    expect(newAgent(before, before)).toBeNull()
    expect(newAgent(before, overview([], [token("t", "2026-10-12")]))).toBe(
      "Token t"
    )
    // Made after the page opened, then used.
    expect(newAgent(overview([]), overview([], [token("n", null)]))).toBeNull()
    expect(
      newAgent(overview([]), overview([], [token("n", "2026-10-12")]))
    ).toBe("Token n")
  })
})

describe("hasAgent", () => {
  it("is true with a signed-in agent or a used token", () => {
    expect(hasAgent(overview([]))).toBe(false)
    expect(hasAgent(overview([], [token("t", null)]))).toBe(false)
    expect(hasAgent(overview([], [token("t", "2026-10-12")]))).toBe(true)
    expect(hasAgent(overview([grant("a", "Cursor")]))).toBe(true)
  })
})

describe("the requests the create screen builds", () => {
  it("asks about the question, on one line", () => {
    expect(requestAbout("  How do heat pumps\nwork? ")).toBe(
      "Make a Seply Learn Expedition about: How do heat pumps work?"
    )
    expect(requestAbout("")).toBe(
      "Make a Seply Learn Expedition about: <what you want to understand>"
    )
  })

  it("is the first prompt for a chat", () => {
    expect(firstPrompts(null)[0]!.prompt).toBe(FROM_CONVERSATION)
  })
})
