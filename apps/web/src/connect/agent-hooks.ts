// The setup page's and the welcome step's state (spec §6.4): the chosen
// agent (remembered on this device), what this server is, and whether an
// agent has connected since the page opened.
import * as React from "react"

import { AGENTS, newAgent, type AgentId } from "@/connect/steps.ts"
import {
  getAgents,
  getInstance,
  type AgentsOverview,
  type Instance,
} from "@/lib/api.ts"

const AGENT_KEY = "seply-connect-agent"
const POLL_MS = 3000

function rememberedAgent(): AgentId {
  try {
    const saved = localStorage.getItem(AGENT_KEY)
    if (AGENTS.some((a) => a.id === saved)) return saved as AgentId
  } catch {
    // No storage: the first agent.
  }
  return "claude-code"
}

/** The chosen agent, remembered on this device. */
export function useAgentChoice() {
  const [agent, setAgent] = React.useState<AgentId>(rememberedAgent)
  const choose = React.useCallback((id: AgentId) => {
    setAgent(id)
    try {
      localStorage.setItem(AGENT_KEY, id)
    } catch {
      // Not remembered; nothing else changes.
    }
  }, [])
  const label = AGENTS.find((a) => a.id === agent)!.label
  return { agent, label, choose }
}

/** What this server is; null while it loads. */
export function useInstance(): Instance | null {
  const [instance, setInstance] = React.useState<Instance | null>(null)
  React.useEffect(() => {
    let live = true
    void getInstance().then((i) => live && setInstance(i))
    return () => {
      live = false
    }
  }, [])
  return instance
}

/**
 * The reader's connected agents, re-read every few seconds while the page is
 * visible, until one connects: the first reading, and the new agent's name.
 */
export function useNewAgent() {
  const [first, setFirst] = React.useState<AgentsOverview | null>(null)
  const [connected, setConnected] = React.useState<string | null>(null)
  const baseline = React.useRef<AgentsOverview | null>(null)
  React.useEffect(() => {
    if (connected) return
    let live = true
    const read = () => {
      if (document.visibilityState !== "visible") return
      getAgents().then(
        (now) => {
          if (!live) return
          if (!baseline.current) {
            baseline.current = now
            setFirst(now)
            return
          }
          const name = newAgent(baseline.current, now)
          if (name) setConnected(name)
        },
        () => {
          // Offline, or a hiccup: the next reading tries again.
        }
      )
    }
    read()
    const timer = window.setInterval(read, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [connected])
  return { overview: first, connected }
}
