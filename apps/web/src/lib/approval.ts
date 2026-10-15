// Hosted access approval on the client (spec §2.6, §3.12; WP-7.3). Sign-up
// and creating are open; approval only decides who may use this server's AI
// key. GET /me's `access` says whether the signed-in account may, and the
// request dialog (components/server-ai.tsx) asks for it.
import { useSession } from "@/lib/session.ts"
import type { AccessState } from "@/lib/api.ts"

/** The dialog's and Settings' words. */
export const SERVER_AI_COPY =
  "An admin turns on this server's AI for each account. Until then you can create, edit and share Expeditions, use your own AI key, and use your own agent over MCP."

/**
 * The signed-in account's access state when it may ask to use this server's
 * AI (approval is on and it isn't approved yet); else null.
 */
export function useServerAiRequest(): AccessState | null {
  const { session } = useSession()
  if (session.status !== "signed-in") return null
  const access = session.user.access
  return access?.approvalRequired && !access.approved ? access : null
}
