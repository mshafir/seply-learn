// What the setup page shows (spec §6.4): the agents, each one's install and
// sign-in steps for this server, the first prompts, and whether an agent has
// connected since the page opened. Pure; connect-screen.tsx lays it out.
// Commands were checked against each agent's docs on 2026-10-12.
import type { AgentsOverview, Instance } from "@/lib/api.ts"

export type AgentId =
  "claude-code" | "claude-apps" | "codex" | "cursor" | "other"

export const AGENTS: { id: AgentId; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-apps", label: "Claude apps" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
  { id: "other", label: "Other" },
]

export type InstallItem =
  | { kind: "command"; label: string; value: string }
  | { kind: "text"; text: string }
  | { kind: "link"; label: string; href: string }
  /** The form that makes an API token (agents that can't sign in). */
  | { kind: "token" }

/** The name agents know this server by. */
const NAME = "seply-learn"

const text = (t: string): InstallItem => ({ kind: "text", text: t })
const command = (label: string, value: string): InstallItem => ({
  kind: "command",
  label,
  value,
})

/** Cursor's one-click install link for this server. */
export function cursorInstallLink(origin: string): string {
  const config = btoa(JSON.stringify({ url: `${origin}/mcp` }))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${encodeURIComponent(config)}`
}

/** What to run or click to add this server to an agent. */
export function installSteps(
  agent: AgentId,
  origin: string,
  instance: Instance
): InstallItem[] {
  const mcp = `${origin}/mcp`
  switch (agent) {
    case "claude-code": {
      const plugin = [
        command(
          "add the marketplace",
          "claude plugin marketplace add mshafir/seply-learn"
        ),
        command("install the plugin", "claude plugin install seply-learn@seply"),
      ]
      if (instance.hosted)
        return [
          text(
            "Run these in a terminal. The plugin adds this server and the skill that teaches Claude how to work here."
          ),
          ...plugin,
        ]
      return [
        text(
          "Run these in a terminal. The plugin adds the skill that teaches Claude how to work here."
        ),
        ...plugin,
        text("When Claude Code asks for the server address, enter this one:"),
        command("server address for the plugin", origin),
        text("Or add this server without the plugin:"),
        command(
          "add without the plugin",
          `claude mcp add --transport http ${NAME} ${mcp}`
        ),
      ]
    }
    case "claude-apps":
      return [
        text(
          "In Claude, on the desktop or at claude.ai, open Settings, then Connectors, and choose Add custom connector. Name it Seply Learn and paste this address:"
        ),
        command("server address", mcp),
        ...(instance.hosted
          ? []
          : [
              text(
                "Claude connects from its own servers, so this server must be reachable from the internet over https."
              ),
            ]),
      ]
    case "codex":
      return [
        text("Run this in a terminal:"),
        command("add the server", `codex mcp add ${NAME} --url ${mcp}`),
      ]
    case "cursor":
      return [
        { kind: "link", label: "Add to Cursor", href: cursorInstallLink(origin) },
        text("Or add this to ~/.cursor/mcp.json yourself:"),
        command(
          "mcp.json",
          JSON.stringify({ mcpServers: { [NAME]: { url: mcp } } })
        ),
      ]
    case "other":
      return [
        text(
          "Any agent that speaks MCP over HTTP can connect. Give it this address:"
        ),
        command("server address", mcp),
        text(
          "If it can't sign in through the browser, make a token and send it as the Authorization header."
        ),
        { kind: "token" },
      ]
  }
}

/** What to do in the agent so it asks to connect. */
export function signInSteps(agent: AgentId): string[] {
  switch (agent) {
    case "claude-code":
      return [
        "Start Claude Code, or restart it if it was open.",
        "Type /mcp, choose seply-learn, then Authenticate.",
        "Your browser opens here. Choose what the agent may do, then allow it.",
      ]
    case "claude-apps":
      return [
        "Choose Connect on the new connector.",
        "Your browser opens here. Choose what the agent may do, then allow it.",
      ]
    case "codex":
      return [
        "Run codex mcp login seply-learn in a terminal.",
        "Your browser opens here. Choose what the agent may do, then allow it.",
      ]
    case "cursor":
      return [
        "In Cursor's MCP settings, choose Connect next to seply-learn.",
        "Your browser opens here. Choose what the agent may do, then allow it.",
      ]
    case "other":
      return [
        "Start your agent with the address, and the token if you made one.",
        "This step is done when the agent makes its first call.",
      ]
  }
}

export type FirstPrompt = {
  /** When to use it. */
  label: string
  prompt: string
  /** What happens next, and where to look. */
  then: string
}

/** A title that sits inside a one-line prompt. */
const inline = (title: string) =>
  title.replace(/\s+/g, " ").trim().replace(/"/g, "'") || "Untitled"

/**
 * What to say to the agent first: about the Expedition the reader came from
 * (one they can suggest on), or else to create one.
 */
export function firstPrompts(
  expedition: { title: string } | null
): FirstPrompt[] {
  if (expedition)
    return [
      {
        label: "Grow this Expedition",
        prompt: `Read my Seply Learn Expedition “${inline(expedition.title)}” and suggest what's missing.`,
        then: "What it suggests waits in this Expedition's Suggestions until you accept it.",
      },
    ]
  const then = "The new Expedition appears in your Library when the agent is done."
  return [
    {
      label: "In a chat you want to keep",
      prompt: "Make a Seply Learn Expedition from this conversation.",
      then,
    },
    {
      label: "Starting from a subject",
      prompt:
        "Make a Seply Learn Expedition about <what you want to understand>.",
      then,
    },
  ]
}

/**
 * The agent that connected between two readings of Connected agents: one
 * that signed in, or a token used for the first time. Null when none did.
 */
export function newAgent(
  before: AgentsOverview,
  now: AgentsOverview
): string | null {
  const known = new Set(before.grants.map((g) => g.clientId))
  const grant = now.grants.find((g) => !known.has(g.clientId))
  if (grant) return grant.name
  const used = new Set(
    before.tokens.filter((t) => t.lastUsedAt).map((t) => t.id)
  )
  const token = now.tokens.find((t) => t.lastUsedAt && !used.has(t.id))
  return token ? token.name : null
}
