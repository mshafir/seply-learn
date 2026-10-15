// Where the signed-in account's AI comes from (spec §3.2, §3.3): its own
// key, this server's AI, or its own agent over MCP. The Library's "No AI
// connected yet" bar and the create screen's "Building needs AI" panel read
// it from GET /api/ai and GET /api/agents.
import * as React from "react"

import { hasAgent } from "@/connect/steps.ts"
import { getAgents, getAi, type AiOverview } from "@/lib/api.ts"

export type AiSetup = {
  /** Null while loading, or when the server couldn't say. */
  ai: AiOverview | null
  /** Whether an agent is connected; null while loading or unknown. */
  agentConnected: boolean | null
}

/** Reads the AI overview and whether an agent is connected, once. */
export function useAiSetup(): AiSetup {
  const [setup, setSetup] = React.useState<AiSetup>({
    ai: null,
    agentConnected: null,
  })
  React.useEffect(() => {
    let live = true
    getAi().then(
      (ai) => live && setSetup((s) => ({ ...s, ai })),
      () => {
        // Unknown: nothing about AI setup is shown.
      }
    )
    getAgents().then(
      (o) => live && setSetup((s) => ({ ...s, agentConnected: hasAgent(o) })),
      () => {
        // Unknown: treated as not connected only where it's shown.
      }
    )
    return () => {
      live = false
    }
  }, [])
  return setup
}

/**
 * The account has no AI it may use, and it can fix that with a key of its
 * own (`no-key`: bring-your-own-key mode; `needs-key`: both mode, and this
 * server's AI isn't on for it).
 */
export function needsKey(ai: AiOverview | null): boolean {
  return (
    !!ai &&
    !ai.ready &&
    (ai.unavailable === "no-key" || ai.unavailable === "needs-key")
  )
}

/**
 * Whether "Ask to use this server's AI" applies: both mode, the server has
 * AI of its own, and it isn't on for the account. (The request itself also
 * needs access approval on: `useServerAiRequest`.)
 */
export function serverAiAskable(ai: AiOverview | null): boolean {
  return (
    !!ai &&
    ai.mode === "both" &&
    !!ai.serverAi?.configured &&
    !ai.serverAi.enabled
  )
}
