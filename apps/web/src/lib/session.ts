// Who is signed in, in context. <SessionProvider> (components/) fills it
// from GET /api/me once on load.
import * as React from "react"

import type { User } from "@/lib/api.ts"

export type Session =
  | { status: "loading" }
  | { status: "signed-in"; user: User }
  | { status: "signed-out" }
  | { status: "error"; error: Error }

export type SessionContextValue = {
  session: Session
  signOut: () => Promise<void>
}

export const SessionContext = React.createContext<
  SessionContextValue | undefined
>(undefined)

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>")
  return ctx
}

/** The signed-in user; only for screens behind <RequireUser>. */
export function useUser(): User {
  const { session } = useSession()
  if (session.status !== "signed-in")
    throw new Error("useUser needs a signed-in session")
  return session.user
}
