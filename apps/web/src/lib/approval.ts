// Hosted access approval on the client (spec §3.12; WP-7.3): whether the
// signed-in account waits for approval (GET /me's `access`), and the gate that
// makes Create, Import and Fork explain instead of failing. The banner and the
// dialog are components/waiting-list.tsx.
import * as React from "react"

import { getMe, isApprovalRequired, type AccessState } from "@/lib/api.ts"
import { useSession } from "@/lib/session.ts"

/** Spec 3.12's words, on the banner and in the dialog. */
export const WAITING_COPY =
  "Your account is on the waiting list. You can read anything shared with you now, and you can create your own Expeditions once you're approved."

/** The signed-in account's access state while it waits for approval; else null. */
export function useWaiting(): AccessState | null {
  const { session } = useSession()
  if (session.status !== "signed-in") return null
  const access = session.user.access
  return access?.approvalRequired && !access.approved ? access : null
}

/**
 * Gates Create, Import and Fork. While the account waits for approval,
 * `gate(run)` opens the waiting-list dialog instead of running, and
 * `explain()` opens it. `refused(e)` opens it when the server refuses with
 * `approval_required` anyway (a stale session), after catching the session
 * up. Render `<WaitingListDialog {...dialog} />` once in the screen.
 */
export function useApprovalGate() {
  const waiting = useWaiting() !== null
  const { setAccess } = useSession()
  const [open, setOpen] = React.useState(false)
  const gate = React.useCallback(
    (run: () => unknown) => {
      if (waiting) setOpen(true)
      else void run()
    },
    [waiting]
  )
  const explain = React.useCallback(() => setOpen(true), [])
  const refused = React.useCallback(
    (e: unknown) => {
      if (!isApprovalRequired(e)) return false
      getMe().then(
        (me) => {
          if (me?.access) setAccess(me.access)
          setOpen(true)
        },
        () => {}
      )
      return true
    },
    [setAccess]
  )
  return {
    waiting,
    gate,
    explain,
    refused,
    dialog: { open, onOpenChange: setOpen },
  }
}
