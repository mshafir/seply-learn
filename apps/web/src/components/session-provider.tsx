import * as React from "react"

import { ApiError, getMe, signOut as apiSignOut, type User } from "@/lib/api.ts"
import { SessionContext, type Session } from "@/lib/session.ts"

// The last signed-in user, so a reload without a connection still knows
// whose pending edits to load (they are scoped by user). Cleared on sign-out.
const USER_KEY = "umbel-user"

function cachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}
function cacheUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    // Storage blocked: offline reloads just can't resume.
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session>({ status: "loading" })

  React.useEffect(() => {
    let cancelled = false
    getMe().then(
      (user) => {
        if (cancelled) return
        cacheUser(user)
        setSession(
          user ? { status: "signed-in", user } : { status: "signed-out" }
        )
      },
      (error: Error) => {
        if (cancelled) return
        const offlineUser =
          error instanceof ApiError && error.status === 0 ? cachedUser() : null
        setSession(
          offlineUser
            ? { status: "signed-in", user: offlineUser }
            : { status: "error", error }
        )
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  const signOut = React.useCallback(async () => {
    await apiSignOut()
    cacheUser(null)
    setSession({ status: "signed-out" })
  }, [])

  const value = React.useMemo(() => ({ session, signOut }), [session, signOut])
  return <SessionContext value={value}>{children}</SessionContext>
}
