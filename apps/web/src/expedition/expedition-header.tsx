// The Expedition screen's header (spec §3.6): the way back to the Library,
// the title (editors rename it in place, through the sync client), sync
// status, search inside the Expedition and the account menu. The Views bar
// (views-bar.tsx) sits under it.
// While a build runs, the activity indicator sits before the search. The
// presence avatars (presence-avatars.tsx) sit before the account menu.
// Share, Suggestions and History arrive with their work packages.
import * as React from "react"
import { CloudOffIcon, LoaderCircleIcon } from "lucide-react"
import { Link } from "wouter"

import { SeplyGlyph } from "@seply/ui/components/brand"
import { Button, buttonVariants } from "@seply/ui/components/button"
import { Input } from "@seply/ui/components/input"

import { AccountMenu } from "@/components/account-menu.tsx"
import type { SyncHealth } from "@/lib/sync.ts"

export function ExpeditionHeader({
  title,
  canEdit,
  onRename,
  health,
  signInHref,
  search,
  activity,
  presence,
}: {
  title: string
  canEdit: boolean
  onRename?: (title: string) => void
  health?: SyncHealth
  /** Signed out (reading a public or unlisted link): where "Sign in" goes. */
  signInHref?: string | null
  /** Search inside the Expedition, before the sync status. */
  search?: React.ReactNode
  /** The build activity indicator (build-activity.tsx), when building. */
  activity?: React.ReactNode
  /** Who else is here (presence-avatars.tsx). */
  presence?: React.ReactNode
}) {
  const [editing, setEditing] = React.useState(false)
  const shown = title || "Untitled Expedition"

  const commit = (value: string) => {
    setEditing(false)
    const next = value.trim()
    if (next && next !== title) onRename?.(next)
  }

  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-card px-3 sm:px-4">
      <Link
        href="/"
        aria-label="Library"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <SeplyGlyph className="size-6" />
      </Link>
      <span aria-hidden className="text-muted-foreground">
        /
      </span>
      {editing ? (
        <Input
          autoFocus
          aria-label="Expedition title"
          defaultValue={title}
          className="h-8 max-w-md text-base font-semibold"
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget.value)
            if (e.key === "Escape") setEditing(false)
          }}
        />
      ) : canEdit ? (
        <Button
          variant="ghost"
          className="min-w-0 px-2 text-base font-semibold"
          aria-label={`Rename the Expedition: ${shown}`}
          onClick={() => setEditing(true)}
        >
          <h1 className="truncate">{shown}</h1>
        </Button>
      ) : (
        <h1 className="truncate px-2 text-base font-semibold">{shown}</h1>
      )}
      <div className="flex-1" />
      {activity}
      {search}
      {health && health.pending > 0 && (
        <span
          role="status"
          data-testid="sync-status"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          {health.offline ? (
            <>
              <CloudOffIcon className="size-4" />
              Offline ·{" "}
              {health.pending === 1 ? "1 edit" : `${health.pending} edits`}{" "}
              waiting
            </>
          ) : (
            <>
              <LoaderCircleIcon className="size-4 animate-spin" />
              Saving
            </>
          )}
        </span>
      )}
      {presence}
      {signInHref && (
        <Link
          href={signInHref}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Sign in
        </Link>
      )}
      <AccountMenu />
    </header>
  )
}
